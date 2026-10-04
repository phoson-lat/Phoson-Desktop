/**
 * Store multi-sesión (zustand). Traduce las notificaciones del bridge a estado de
 * UI, enrutando por `sessionId` (decisión #5: N sesiones concurrentes, cada una
 * con su propio `PhosonRepl` en el sidecar).
 *
 * Nota: `AgentTokenEvent` llega a alta frecuencia; se acumula por sesión y se
 * hace flush por rAF para no re-renderizar por token.
 */

import { create } from "zustand";

import { phoson, bindSessionWorkspace, unbindSessionWorkspace, setCurrentWorkspace, getCurrentWorkspace } from "../bridge/client";
import { isImageFile } from "../lib/files";
import type {
  AgentEvent,
  Attachment,
  InitResult,
  ConfirmRequest,
  NotifyMessage,
  RunMetrics,
  SubagentTask,
  UploadedFile,
} from "../bridge/protocol";

export interface ToolCard {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  error?: string | null;
  status: "running" | "done" | "error";
}

/**
 * Parte de un mensaje del agente, **en orden de llegada**: el engine emite
 * texto y tools intercalados (iteraciones del ReAct), y hay que respetarlo.
 */
export type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolCard };

/**
 * Une bloques de texto **adyacentes** en uno solo (nunca a través de una tool).
 *
 * El engine/el replay pueden emitir varios `TextBlock` seguidos para un mismo
 * turno; sin fusionarlos, cada uno se renderiza como su propio bloque markdown
 * (párrafos cortados, y solo el último en modo stream). Es puramente cosmético:
 * no altera el orden respecto a las tool calls.
 */
export function mergeTextParts(parts: MessagePart[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (part.kind === "text" && prev?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: prev.text + part.text };
    } else {
      out.push(part);
    }
  }
  return out;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Texto del turno del usuario (el agente usa `parts`). */
  text: string;
  /** Contenido del agente en orden: texto y tool calls intercalados. */
  parts: MessagePart[];
  reasoning?: string;
  /** Archivos subidos al workspace referenciados en este turno (mensajes de usuario). */
  uploads?: UploadedFile[];
  status: "streaming" | "done" | "error" | "cancelled";
}

/** Texto plano de un mensaje (usado para títulos y previews). */
export const messageText = (m: ChatMessage): string =>
  m.role === "user" ? m.text : m.parts.filter((p) => p.kind === "text").map((p) => p.text).join("");

export interface SessionView {
  key: string;
  /** Título de la sesión (heurístico al primer mensaje y, luego, del modelo). */
  title?: string;
  engineId?: string;
  messages: ChatMessage[];
  metrics: RunMetrics | null;
  confirmations: ConfirmRequest[];
  notifications: NotifyMessage[];
  attachments: Attachment[];
  sending: boolean;
  /** Workspace (cwd del sidecar) al que pertenece esta sesión. */
  workspace: string;
  /** Subtareas (subagentes) en curso o finalizadas de este turno. */
  subagents: SubagentTask[];
  /** Archivos no nativos subidos al workspace (se referencian en el prompt). */
  uploads: UploadedFile[];
}

interface SessionState {
  ready: boolean;
  activeKey: string | null;
  order: string[];
  sessions: Record<string, SessionView>;
  /** Nombres de las tools que el engine ofrece (de `initialize`), sin duplicados. */
  availableTools: string[];
  /** Cuántas tools quedaron enmascaradas: si >0, `availableTools` está recortada. */
  maskedTools: number;
  init: () => Promise<void>;
  send: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  /** Repite el último turno de usuario (undo en el engine + reenvío). */
  regenerate: () => Promise<void>;
  /** Deshace el último turno de usuario. Devuelve `true` si se hizo. */
  undoLastTurn: () => Promise<boolean>;
  /** Salta a un turno de usuario previo (rewind). */
  jumpToTurn: (userNodeId: string) => Promise<boolean>;
  /** Compacta el contexto; devuelve before/after (o null si falló). */
  compactContext: (profile?: string) => Promise<{ before: number; after: number } | null>;
  newSession: (workspace?: string | null) => Promise<void>;
  openSession: (engineId: string, workspace?: string | null) => Promise<void>;
  closeSession: (key: string) => Promise<void>;
  setActive: (key: string) => void;
  respondConfirm: (requestId: string, decision: "yes" | "always" | "no") => Promise<void>;
  /** Adjuntos: pegar, arrastrar o elegir archivos. */
  loadAttachments: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  removeAttachment: (path: string) => Promise<void>;
  /** Quita de la lista un archivo subido al workspace. */
  removeUpload: (path: string) => void;
  /** Primer arranque sin proveedor configurado. */
  onboardingNeeded: boolean;
  /** Vuelve a abrir el onboarding (limpia el flag de "ya visto"). */
  startOnboarding: () => void;
  /** Error de arranque (si `initialize` falló tras los reintentos). */
  bootError: string | null;
  /** Workspace del agente activo (cwd del sidecar de esa sesión). */
  cwd: string;
  /** Refresca el workspace del sidecar activo. */
  loadCwd: () => Promise<void>;
  /** Fija el workspace activo y abre una sesión nueva en él. */
  setWorkspace: (path: string) => Promise<string>;
  finishOnboarding: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Recuerda el último workspace para reabrirlo al arrancar. */
const rememberWorkspace = (path: string) => {
  if (!path) return;
  try {
    localStorage.setItem("phoson.workspace", path);
  } catch {
    /* almacenamiento no disponible */
  }
};

const emptyView = (key: string): SessionView => ({
  key,
  title: "",
  messages: [],
  metrics: null,
  confirmations: [],
  notifications: [],
  attachments: [],
  sending: false,
  workspace: "",
  subagents: [],
  uploads: [],
});

/** Convierte un File a base64 (sin el prefijo data:). */
const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Reconstruye el historial del replay (`print_history`) **respetando el orden**:
 * texto y tool calls intercalados, y los `ToolResultBlock` (que el engine manda
 * en mensajes de usuario) se enganchan a su tool por `tool_call_id`.
 */
function historyToMessages(payload: { messages?: unknown[] }): ChatMessage[] {
  const out: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;

  const flush = () => {
    if (assistant && assistant.parts.length > 0)
      out.push({ ...assistant, parts: mergeTextParts(assistant.parts) });
    assistant = null;
  };
  const blocksOf = (content: unknown): Record<string, unknown>[] => {
    if (typeof content === "string") return [{ type: "TextBlock", text: content }];
    return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
  };

  for (const raw of payload.messages ?? []) {
    const m = raw as { role?: string; content?: unknown };
    const blocks = blocksOf(m.content);

    if (m.role === "user") {
      // Tool results llegan como mensajes de usuario: se adjuntan a su tool.
      for (const b of blocks) {
        if (b.type !== "ToolResultBlock") continue;
        const id = String(b.tool_call_id ?? "");
        const result = typeof b.content === "string" ? b.content : "";
        const target = out[out.length - 1];
        if (!target) continue;
        target.parts = target.parts.map((part) =>
          part.kind === "tool" && part.tool.id === id
            ? { kind: "tool", tool: { ...part.tool, result, status: "done" } }
            : part,
        );
      }
      const text = blocks
        .filter((b) => b.type === "TextBlock" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      if (text.trim()) {
        flush();
        out.push({ id: uid(), role: "user", text, parts: [], status: "done" });
      }
      continue;
    }

    if (!assistant) {
      assistant = { id: uid(), role: "assistant", text: "", parts: [], status: "done" };
    }
    for (const b of blocks) {
      if (b.type === "TextBlock" && typeof b.text === "string" && b.text) {
        assistant.parts.push({ kind: "text", text: b.text });
      } else if (b.type === "ToolUseBlock") {
        assistant.parts.push({
          kind: "tool",
          tool: {
            id: String(b.id ?? uid()),
            name: String(b.name ?? "tool"),
            args: b.input,
            status: "done",
          },
        });
      }
    }
  }
  flush();
  return out;
}

// Buffer de streaming por sesión (texto + razonamiento) + flush coalescido.
interface PendingChunk {
  text: string;
  reasoning: string;
}
const pending = new Map<string, PendingChunk>();
/**
 * Ventana de coalescido del streaming. Antes se hacía flush por rAF (hasta 60/s);
 * agrupar en ~32 ms (≈30 fps de UI) mantiene el texto fluido y reduce a la mitad
 * los re-render del árbol durante una respuesta larga.
 */
const FLUSH_MS = 32;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Apende texto a las partes sin cruzar tool calls. */
const appendTextToParts = (parts: MessagePart[], chunk: string): MessagePart[] => {
  const out = [...parts];
  const last = out[out.length - 1];
  if (last?.kind === "text") out[out.length - 1] = { kind: "text", text: last.text + chunk };
  else out.push({ kind: "text", text: chunk });
  return out;
};

/** Aplica un chunk acumulado al último mensaje del asistente de esa vista. */
const applyChunk = (view: SessionView, chunk: PendingChunk): SessionView => {
  if (!chunk.text && !chunk.reasoning) return view;
  const messages = [...view.messages];
  const idx = messages.length - 1;
  if (idx < 0 || messages[idx].role !== "assistant") return view;
  const m = messages[idx];
  messages[idx] = {
    ...m,
    reasoning: chunk.reasoning ? (m.reasoning ?? "") + chunk.reasoning : m.reasoning,
    parts: chunk.text ? appendTextToParts(m.parts, chunk.text) : m.parts,
  };
  return { ...view, messages };
};

export const useSession = create<SessionState>((set, get) => {
  const patchView = (key: string, patch: (v: SessionView) => SessionView) => {
    set((state) => {
      // Upsert: algunas notificaciones (p. ej. `session.history` al cargar una
      // sesión) llegan ANTES de que exista la vista, porque el sidecar las emite
      // durante la propia llamada RPC.
      const view = state.sessions[key] ?? emptyView(key);
      return { sessions: { ...state.sessions, [key]: patch(view) } };
    });
  };

  const patchLastAssistant = (key: string, patch: (m: ChatMessage) => ChatMessage) => {
    patchView(key, (v) => {
      const messages = [...v.messages];
      const idx = messages.length - 1;
      if (idx < 0 || messages[idx].role !== "assistant") return v;
      messages[idx] = patch(messages[idx]);
      return { ...v, messages };
    });
  };

  /**
   * Reemplaza los mensajes de la vista con el historial que el sidecar devuelve
   * en la respuesta RPC tras mutar el árbol (undo/rewind/compact). Aplicarlo al
   * resolver la llamada evita la carrera con un envío inmediato que tendría una
   * notificación asíncrona.
   */
  const applyHistory = (key: string, history: unknown) => {
    if (!Array.isArray(history)) return;
    patchView(key, (v) => ({ ...v, messages: historyToMessages({ messages: history }) }));
  };

  /** Buffer pendiente de una sesión (creándolo si hace falta). */
  const chunkOf = (key: string): PendingChunk => {
    let chunk = pending.get(key);
    if (!chunk) {
      chunk = { text: "", reasoning: "" };
      pending.set(key, chunk);
    }
    return chunk;
  };

  /**
   * Descarga YA el buffer de una sesión.
   *
   * Los eventos que NO son streaming (tools, error, done) se aplican de forma
   * síncrona; hay que volcar antes lo recibido o el texto acabaría renderizado
   * DESPUÉS de un evento que en realidad llegó más tarde (rompe el orden real
   * texto↔tools cuando ambos caen en el mismo frame del rAF).
   */
  const drainPending = (key: string) => {
    const chunk = pending.get(key);
    if (!chunk || (!chunk.text && !chunk.reasoning)) return;
    pending.set(key, { text: "", reasoning: "" });
    patchView(key, (v) => applyChunk(v, chunk));
  };

  const flushPending = () => {
    const affected: Array<[string, PendingChunk]> = [];
    for (const [key, chunk] of pending) {
      if (!chunk.text && !chunk.reasoning) continue;
      // Sesión cerrada: descarta el buffer huérfano en vez de resucitar la vista.
      if (!get().sessions[key]) {
        pending.delete(key);
        continue;
      }
      affected.push([key, chunk]);
      pending.set(key, { text: "", reasoning: "" });
    }
    if (affected.length === 0) return;
    // UN solo `set` para todas las sesiones con chunk nuevo (antes: uno por sesión).
    set((state) => {
      const sessions = { ...state.sessions };
      for (const [key, chunk] of affected) {
        const view = sessions[key];
        if (view) sessions[key] = applyChunk(view, chunk);
      }
      return { sessions };
    });
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, FLUSH_MS);
  };

  const handleEvent = (key: string, event: AgentEvent) => {
    // Todo evento que no sea streaming va precedido por el volcado del buffer,
    // para preservar el orden real de llegada.
    if (event.type !== "AgentTokenEvent" && event.type !== "AgentReasoningEvent") {
      drainPending(key);
    }
    switch (event.type) {
      case "AgentTokenEvent":
        chunkOf(key).text += String(event.content ?? "");
        scheduleFlush();
        break;
      case "AgentReasoningEvent":
        // El razonamiento también va por el buffer: durante un "thinking" largo
        // no re-renderizamos por cada token.
        chunkOf(key).reasoning += String(event.content ?? "");
        scheduleFlush();
        break;
      case "AgentToolStartEvent": {
        const card: ToolCard = {
          id: String(event.tool_call_id ?? uid()),
          name: String(event.tool_name ?? "tool"),
          args: event.args,
          status: "running",
        };
        // Se añade como parte: mantiene el orden respecto al texto del stream.
        patchLastAssistant(key, (m) => ({ ...m, parts: [...m.parts, { kind: "tool", tool: card }] }));
        break;
      }
      case "AgentToolDoneEvent":
        patchLastAssistant(key, (m) => ({
          ...m,
          parts: m.parts.map((part) =>
            part.kind === "tool" && part.tool.id === String(event.tool_call_id)
              ? {
                  kind: "tool" as const,
                  tool: {
                    ...part.tool,
                    result: event.result,
                    error: event.error,
                    status: event.error ? ("error" as const) : ("done" as const),
                  },
                }
              : part,
          ),
        }));
        break;
      case "AgentErrorEvent":
        patchLastAssistant(key, (m) => ({
          ...m,
          status: "error",
          parts: mergeTextParts([...m.parts, { kind: "text", text: String(event.message ?? "Error") }]),
        }));
        break;
      default:
        break;
    }
  };

  // React StrictMode monta dos veces: sin este guard habría dos suscripciones
  // y cada notificación se aplicaría por duplicado (texto repetido, tools x2).
  let attached = false;
  const attach = async () => {
    if (attached) return;
    await phoson.onNotify((envelope) => {
      const params = envelope.params as Record<string, unknown>;
      const key = params.sessionId as string | undefined;
      switch (envelope.method) {
        case "agent.event":
          if (key) handleEvent(key, params.event as AgentEvent);
          break;
        case "session.metrics":
          if (key) patchView(key, (v) => ({ ...v, metrics: envelope.params as RunMetrics }));
          break;
        case "session.info": {
          if (key && typeof params.engineSessionId === "string")
            patchView(key, (v) => ({ ...v, engineId: params.engineSessionId as string }));
          // El sidecar emite aquí el cwd del workspace al que pertenece la sesión.
          if (key && typeof params.cwd === "string" && params.cwd) {
            const workspace = params.cwd as string;
            bindSessionWorkspace(key, workspace);
            patchView(key, (v) => ({ ...v, workspace }));
            if (get().activeKey === key) {
              setCurrentWorkspace(workspace);
              rememberWorkspace(workspace);
              set({ cwd: workspace });
            }
          }
          break;
        }
        case "session.title": {
          // Título generado por el engine (heurístico tras el primer turno y,
          // en background, del modelo) — mismo comportamiento que el CLI.
          if (key && typeof params.title === "string" && params.title.trim()) {
            patchView(key, (v) => ({ ...v, title: (params.title as string).trim() }));
          }
          break;
        }
        case "session.assistant.done": {
          if (!key) break;
          // Vuelca el streaming pendiente antes de cerrar el mensaje.
          drainPending(key);
          const status = String(params.status);
          patchLastAssistant(key, (m) => ({
            ...m,
            status:
              status === "done" ? "done" : status === "cancelled" ? "cancelled" : "error",
          }));
          patchView(key, (v) => ({ ...v, sending: false }));
          break;
        }
        case "session.history":
          // Replay al cargar una sesión previa.
          if (key) patchView(key, (v) => ({ ...v, messages: historyToMessages(params) }));
          break;
        case "attachments.changed":
          // El controller los volcó en el turno: ya no están pendientes.
          if (key) patchView(key, (v) => ({ ...v, attachments: [] }));
          break;
        case "notify":
          if (key)
            patchView(key, (v) => ({
              ...v,
              notifications: [...v.notifications, envelope.params as NotifyMessage],
            }));
          break;
        case "confirm.request":
          if (key)
            patchView(key, (v) => ({
              ...v,
              confirmations: [...v.confirmations, envelope.params as ConfirmRequest],
            }));
          break;
        case "subagent.progress": {
          if (!key) break;
          // El sidecar manda `null` al terminar; `tasks` vacío limpia el panel.
          const progress = params.progress as { tasks?: SubagentTask[] } | null;
          patchView(key, (v) => ({ ...v, subagents: progress?.tasks ?? [] }));
          break;
        }
        default:
          break;
      }
    });
    // Solo tras suscribirnos con éxito: si `onNotify` rechaza, un reintento de
    // `init` debe poder volver a intentarlo (si no, `attached` bloquearía el retry).
    attached = true;
  };

  let bootPromise: Promise<void> | null = null;

  return {
    ready: false,
    activeKey: null,
    order: [],
    sessions: {},
    availableTools: [],
    maskedTools: 0,
    onboardingNeeded: false,
    bootError: null,
    cwd: "",

    init: () => {
      bootPromise ??= (async () => {
        try {
          await attach();
          // Reabre el último workspace usado (su propio sidecar). Si ya no existe,
          // el sidecar cae al cwd por defecto y `info.cwd` corrige el estado.
          try {
            const saved = localStorage.getItem("phoson.workspace");
            if (saved) setCurrentWorkspace(saved);
          } catch {
            /* almacenamiento no disponible */
          }
          // El sidecar puede estar construyendo el engine (MCP tarda): reintenta.
          let info: InitResult | null = null;
          let lastError = "";
          for (let attempt = 0; attempt < 4 && !info; attempt++) {
            try {
              info = await phoson.initialize();
            } catch (e) {
              lastError = String(e);
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            }
          }
          if (!info) {
            set({ ready: false, bootError: lastError || "no se pudo inicializar el engine" });
            return;
          }
          const key = info.defaultSessionId;
          const workspace = info.cwd ?? "";
          const dismissed =
            typeof localStorage !== "undefined" &&
            localStorage.getItem("phoson.onboarded") === "1";
          if (workspace) {
            setCurrentWorkspace(workspace);
            bindSessionWorkspace(key, workspace);
            rememberWorkspace(workspace);
          }
          set((s) => ({
            ready: true,
            bootError: null,
            activeKey: key,
            order: [key],
            cwd: workspace || s.cwd,
            availableTools: info.tools?.visible ?? s.availableTools,
            maskedTools: info.tools?.maskedCount ?? s.maskedTools,
            onboardingNeeded: Boolean(info.onboarding?.needed) && !dismissed,
            sessions: {
              ...s.sessions,
              [key]: { ...emptyView(key), metrics: info.metrics, workspace },
            },
          }));
        } catch (e) {
          // Cualquier fallo (p. ej. `attach` rechazando) deja el estado listo
          // para reintentar, en vez de una promesa rechazada sin manejar.
          set({ ready: false, bootError: String(e) });
        } finally {
          if (!get().ready) bootPromise = null;
        }
      })();
      return bootPromise;
    },

    send: async (text: string) => {
      const key = get().activeKey;
      if (!key) return;
      const view = get().sessions[key];
      const uploads = view?.uploads ?? [];
      // El agente recibe una nota (en inglés) con las rutas; la UI muestra el
      // texto limpio + un componente con los archivos subidos.
      const reference = uploads.length
        ? `\n\n[Files uploaded to the workspace: ${uploads
            .map((u) => u.relative)
            .join(", ")} — read them with read_file or glob.]`
        : "";
      const outgoing = text + reference;
      patchView(key, (v) => ({
        ...v,
        sending: true,
        uploads: [], // ya van referenciados en este turno
        messages: [
          ...v.messages,
          { id: uid(), role: "user", text, parts: [], status: "done", uploads },
          { id: uid(), role: "assistant", text: "", parts: [], status: "streaming" },
        ],
      }));
      try {
        await phoson.runTurn(key, outgoing);
      } catch (e) {
        // Si la RPC falla (sidecar caído, error del bridge) no podemos dejar la
        // sesión "enviando" y el mensaje "streaming" para siempre.
        const message = String(e).replace(/^Error:\s*/, "");
        patchLastAssistant(key, (m) => ({
          ...m,
          status: "error",
          parts: mergeTextParts([...m.parts, { kind: "text", text: `Error: ${message}` }]),
        }));
        patchView(key, (v) => ({
          ...v,
          sending: false,
          notifications: [
            ...v.notifications,
            { sessionId: key, kind: "error" as const, message },
          ],
        }));
      }
    },

    cancel: async () => {
      const key = get().activeKey;
      if (key) await phoson.cancelTurn(key);
    },

    undoLastTurn: async () => {
      const key = get().activeKey;
      if (!key) return false;
      try {
        const res = await phoson.sessionUndo(key);
        if (!res.ok) return false;
        // El sidecar devuelve el camino activo ya recortado.
        applyHistory(key, res.history);
        return true;
      } catch {
        return false;
      }
    },

    jumpToTurn: async (userNodeId) => {
      const key = get().activeKey;
      if (!key) return false;
      try {
        const res = await phoson.sessionRewind(key, userNodeId);
        if (!res.ok) return false;
        applyHistory(key, res.history);
        return true;
      } catch {
        return false;
      }
    },

    compactContext: async (profile) => {
      const key = get().activeKey;
      if (!key) return null;
      try {
        const res = await phoson.sessionCompact(key, profile);
        if (!res.ok) return null;
        // El historial compactado reemplaza al original en la vista.
        applyHistory(key, res.history);
        return { before: res.before, after: res.after };
      } catch {
        return null;
      }
    },

    regenerate: async () => {
      const key = get().activeKey;
      if (!key) return;
      const view = get().sessions[key];
      const lastUser = view
        ? [...view.messages].reverse().find((m) => m.role === "user")
        : undefined;
      if (!lastUser) return;
      if (!(await get().undoLastTurn())) {
        patchView(key, (v) => ({
          ...v,
          notifications: [
            ...v.notifications,
            { sessionId: key, kind: "warn" as const, message: "No se pudo deshacer el último turno." },
          ],
        }));
        return;
      }
      await get().send(lastUser.text);
    },

    newSession: async (workspace) => {
      const target = workspace ?? undefined;
      // Clave con la que se ENRUTA (no el cwd reportado): el sidecar reporta su
      // `os.getcwd()`, que puede no coincidir con la clave del mapa (p. ej. `""`
      // para el sidecar por defecto) y dejaría la sesión inalcanzable.
      const routeKey = target ?? getCurrentWorkspace() ?? "";
      const { sessionId, cwd } = await phoson.newSession(routeKey);
      bindSessionWorkspace(sessionId, routeKey);
      const effective = cwd || target || get().cwd;
      if (effective) {
        setCurrentWorkspace(effective);
        rememberWorkspace(effective);
      }
      set((s) => ({
        activeKey: sessionId,
        order: s.order.includes(sessionId) ? s.order : [...s.order, sessionId],
        cwd: effective || s.cwd,
        // La vista puede existir ya si llegó `session.history` antes que la respuesta.
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...(s.sessions[sessionId] ?? emptyView(sessionId)),
            workspace: effective || s.sessions[sessionId]?.workspace || "",
          },
        },
      }));
    },

    openSession: async (engineId, workspace) => {
      const target = workspace ?? undefined;
      const routeKey = target ?? getCurrentWorkspace() ?? "";
      const { sessionId, cwd, cwdMissing } = await phoson.openSession(engineId, routeKey);
      bindSessionWorkspace(sessionId, routeKey);
      const effective = cwd || target || get().cwd;
      if (effective) {
        setCurrentWorkspace(effective);
        rememberWorkspace(effective);
      }
      set((s) => {
        const base = s.sessions[sessionId] ?? emptyView(sessionId);
        return {
          activeKey: sessionId,
          order: s.order.includes(sessionId) ? s.order : [...s.order, sessionId],
          cwd: effective || s.cwd,
          sessions: {
            ...s.sessions,
            [sessionId]: cwdMissing
              ? {
                  ...base,
                  workspace: effective || base.workspace,
                  notifications: [
                    ...base.notifications,
                    {
                      sessionId,
                      kind: "warn" as const,
                      message:
                        "La carpeta original de esta sesión ya no existe: se usa el workspace actual.",
                    },
                  ],
                }
              : { ...base, workspace: effective || base.workspace },
          },
        };
      });
    },

    closeSession: async (key: string) => {
      await phoson.closeSession(key);
      unbindSessionWorkspace(key);
      // Sin esto, un flush pendiente resucitaría la vista cerrada (upsert).
      pending.delete(key);
      set((s) => {
        const sessions = { ...s.sessions };
        delete sessions[key];
        const order = s.order.filter((k) => k !== key);
        return {
          sessions,
          order,
          activeKey: s.activeKey === key ? (order[order.length - 1] ?? null) : s.activeKey,
        };
      });
      // Nunca dejar la app sin sesión: el backend también garantiza una.
      if (get().order.length === 0) await get().newSession();
    },

    setActive: (key) =>
      set((s) => ({
        activeKey: key,
        // El `cwd` mostrado es el del sidecar de la sesión **activa**, no el
        // último usado: al cambiar de sesión entre workspaces, la etiqueta debe
        // seguirla (si no, muestra un proyecto distinto al que realmente corre).
        cwd: s.sessions[key]?.workspace || s.cwd,
      })),

    respondConfirm: async (requestId, decision) => {
      const key = get().activeKey;
      if (!key) return;
      patchView(key, (v) => ({
        ...v,
        confirmations: v.confirmations.filter((c) => c.requestId !== requestId),
      }));
      await phoson.respondConfirm(key, requestId, decision);
    },

    loadAttachments: async () => {
      const key = get().activeKey;
      if (!key) return;
      try {
        const res = await phoson.attachmentList(key);
        patchView(key, (v) => ({ ...v, attachments: res.attachments ?? [] }));
      } catch {
        /* sin adjuntos */
      }
    },

    addFiles: async (files) => {
      const key = get().activeKey;
      if (!key || files.length === 0) return;
      const notify = (message: string, kind: "warn" | "error" = "warn") =>
        patchView(key, (v) => ({
          ...v,
          notifications: [...v.notifications, { sessionId: key, kind, message }],
        }));

      for (const file of files) {
        let data: string;
        try {
          data = await fileToBase64(file);
        } catch (e) {
          notify(`${file.name}: ${String(e).replace(/^Error:\s*/, "")}`, "error");
          continue;
        }
        // Solo las IMÁGENES van como adjunto nativo (el modelo puede verlas).
        if (isImageFile(file.name)) {
          try {
            const res = await phoson.attachmentPush(key, file.name, data);
            patchView(key, (v) => ({ ...v, attachments: res.attachments ?? [] }));
            continue;
          } catch {
            /* el engine lo rechazó → se sube al workspace */
          }
        }
        // PDF, vídeo, audio y cualquier otro archivo: se suben al workspace y se
        // referencian en el prompt para que el agente los lea con `read_file`.
        try {
          const up = await phoson.uploadFile(key, file.name, data);
          patchView(key, (v) => ({ ...v, uploads: [...v.uploads, up] }));
        } catch (e) {
          notify(`${file.name}: ${String(e).replace(/^Error:\s*/, "")}`, "error");
        }
      }
    },

    removeUpload: (path) => {
      const key = get().activeKey;
      if (!key) return;
      // Solo quita la referencia (el archivo ya está en el workspace).
      patchView(key, (v) => ({ ...v, uploads: v.uploads.filter((u) => u.path !== path) }));
    },

    removeAttachment: async (path) => {
      const key = get().activeKey;
      if (!key) return;
      try {
        const res = await phoson.attachmentRemove(key, path);
        patchView(key, (v) => ({ ...v, attachments: res.attachments ?? [] }));
      } catch {
        /* ignorar */
      }
    },

    loadCwd: async () => {
      try {
        const res = await phoson.fsCwd();
        set({ cwd: res.cwd });
      } catch {
        /* sin workspace todavía */
      }
    },

    setWorkspace: async (path) => {
      // Un workspace nuevo = su propio sidecar (su propio cwd de proceso).
      // Abrimos una sesión ahí para dejarlo activo sin pisar las demás.
      setCurrentWorkspace(path);
      rememberWorkspace(path);
      set({ cwd: path });
      await get().newSession(path);
      return path;
    },

    startOnboarding: () => {
      try {
        localStorage.removeItem("phoson.onboarded");
      } catch {
        /* almacenamiento no disponible */
      }
      set({ onboardingNeeded: true });
    },

    finishOnboarding: () => {
      try {
        localStorage.setItem("phoson.onboarded", "1");
      } catch {
        /* almacenamiento no disponible */
      }
      set({ onboardingNeeded: false });
    },
  };
});
