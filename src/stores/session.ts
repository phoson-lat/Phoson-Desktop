/**
 * Store multi-sesión (zustand). Traduce las notificaciones del bridge a estado de
 * UI, enrutando por `sessionId` (decisión #5: N sesiones concurrentes, cada una
 * con su propio `PhosonRepl` en el sidecar).
 *
 * Nota: `AgentTokenEvent` llega a alta frecuencia; se acumula por sesión y se
 * hace flush por rAF para no re-renderizar por token.
 */

import { create } from "zustand";

import { phoson } from "../bridge/client";
import type {
  AgentEvent,
  Attachment,
  InitResult,
  ConfirmRequest,
  NotifyMessage,
  RunMetrics,
} from "../bridge/protocol";

export interface ToolCard {
  id: string;
  name: string;
  args?: unknown;
  result?: string;
  error?: string | null;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  tools: ToolCard[];
  status: "streaming" | "done" | "error" | "cancelled";
}

export interface SessionView {
  key: string;
  engineId?: string;
  messages: ChatMessage[];
  metrics: RunMetrics | null;
  confirmations: ConfirmRequest[];
  notifications: NotifyMessage[];
  attachments: Attachment[];
  sending: boolean;
}

interface SessionState {
  ready: boolean;
  activeKey: string | null;
  order: string[];
  sessions: Record<string, SessionView>;
  init: () => Promise<void>;
  send: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  newSession: () => Promise<void>;
  openSession: (engineId: string) => Promise<void>;
  closeSession: (key: string) => Promise<void>;
  setActive: (key: string) => void;
  respondConfirm: (requestId: string, decision: "yes" | "always" | "no") => Promise<void>;
  /** Adjuntos: pegar, arrastrar o elegir archivos. */
  loadAttachments: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  removeAttachment: (path: string) => Promise<void>;
  /** Primer arranque sin proveedor configurado. */
  onboardingNeeded: boolean;
  /** Error de arranque (si `initialize` falló tras los reintentos). */
  bootError: string | null;
  finishOnboarding: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const emptyView = (key: string): SessionView => ({
  key,
  messages: [],
  metrics: null,
  confirmations: [],
  notifications: [],
  attachments: [],
  sending: false,
});

/** Convierte un File a base64 (sin el prefijo data:). */
const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Texto plano de un `Message` del engine (string o lista de bloques). */
function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as { text?: string; content?: string };
        return typeof b?.text === "string" ? b.text : typeof b?.content === "string" ? b.content : "";
      })
      .join("");
  }
  return "";
}

/** Reconstruye el historial que llega al cargar una sesión (`print_history`). */
function historyToMessages(payload: { messages?: unknown[] }): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const raw of payload.messages ?? []) {
    const m = raw as { role?: string; content?: unknown };
    const role: ChatMessage["role"] = m.role === "user" ? "user" : "assistant";
    const text = blocksToText(m.content);
    if (!text.trim()) continue; // ignora turnos solo-tool
    out.push({ id: uid(), role, text, tools: [], status: "done" });
  }
  return out;
}

// Buffer de tokens por sesión + flush por rAF.
const tokenBuffer = new Map<string, string>();
let rafHandle: number | null = null;

export const useSession = create<SessionState>((set, get) => {
  const patchView = (key: string, patch: (v: SessionView) => SessionView) => {
    set((state) => {
      const view = state.sessions[key];
      if (!view) return state;
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

  const flushTokens = () => {
    rafHandle = null;
    for (const [key, chunk] of tokenBuffer) {
      if (!chunk) continue;
      tokenBuffer.set(key, "");
      patchLastAssistant(key, (m) => ({ ...m, text: m.text + chunk }));
    }
  };

  const scheduleFlush = () => {
    if (rafHandle === null) rafHandle = requestAnimationFrame(flushTokens);
  };

  const handleEvent = (key: string, event: AgentEvent) => {
    switch (event.type) {
      case "AgentTokenEvent":
        tokenBuffer.set(key, (tokenBuffer.get(key) ?? "") + String(event.content ?? ""));
        scheduleFlush();
        break;
      case "AgentReasoningEvent":
        patchLastAssistant(key, (m) => ({
          ...m,
          reasoning: (m.reasoning ?? "") + String(event.content ?? ""),
        }));
        break;
      case "AgentToolStartEvent": {
        const card: ToolCard = {
          id: String(event.tool_call_id ?? uid()),
          name: String(event.tool_name ?? "tool"),
          args: event.args,
          status: "running",
        };
        patchLastAssistant(key, (m) => ({ ...m, tools: [...m.tools, card] }));
        break;
      }
      case "AgentToolDoneEvent":
        patchLastAssistant(key, (m) => ({
          ...m,
          tools: m.tools.map((t) =>
            t.id === String(event.tool_call_id)
              ? { ...t, result: event.result, error: event.error, status: event.error ? "error" : "done" }
              : t,
          ),
        }));
        break;
      case "AgentErrorEvent":
        patchLastAssistant(key, (m) => ({
          ...m,
          status: "error",
          text: m.text || String(event.message ?? "Error"),
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
    attached = true;
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
        case "session.info":
          if (key)
            patchView(key, (v) => ({ ...v, engineId: params.engineSessionId as string }));
          break;
        case "session.assistant.done": {
          if (!key) break;
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
        default:
          break;
      }
    });
  };

  let bootPromise: Promise<void> | null = null;

  return {
    ready: false,
    activeKey: null,
    order: [],
    sessions: {},
    onboardingNeeded: false,
    bootError: null,

    init: () => {
      bootPromise ??= (async () => {
        await attach();
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
          bootPromise = null; // permite reintentar
          return;
        }
        const key = info.defaultSessionId;
        const dismissed =
          typeof localStorage !== "undefined" &&
          localStorage.getItem("phoson.onboarded") === "1";
        set((s) => ({
          ready: true,
          bootError: null,
          activeKey: key,
          order: [key],
          onboardingNeeded: Boolean(info.onboarding?.needed) && !dismissed,
          sessions: { ...s.sessions, [key]: { ...emptyView(key), metrics: info.metrics } },
        }));
      })();
      return bootPromise;
    },

    send: async (text: string) => {
      const key = get().activeKey;
      if (!key) return;
      patchView(key, (v) => ({
        ...v,
        sending: true,
        messages: [
          ...v.messages,
          { id: uid(), role: "user", text, tools: [], status: "done" },
          { id: uid(), role: "assistant", text: "", tools: [], status: "streaming" },
        ],
      }));
      await phoson.runTurn(key, text);
    },

    cancel: async () => {
      const key = get().activeKey;
      if (key) await phoson.cancelTurn(key);
    },

    newSession: async () => {
      const { sessionId } = await phoson.newSession();
      set((s) => ({
        activeKey: sessionId,
        order: [...s.order, sessionId],
        sessions: { ...s.sessions, [sessionId]: emptyView(sessionId) },
      }));
    },

    openSession: async (engineId: string) => {
      const { sessionId } = await phoson.openSession(engineId);
      set((s) => ({
        activeKey: sessionId,
        order: [...s.order, sessionId],
        sessions: { ...s.sessions, [sessionId]: emptyView(sessionId) },
      }));
    },

    closeSession: async (key: string) => {
      await phoson.closeSession(key);
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

    setActive: (key: string) => set({ activeKey: key }),

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
      for (const file of files) {
        try {
          const data = await fileToBase64(file);
          const res = await phoson.attachmentPush(key, file.name, data);
          patchView(key, (v) => ({ ...v, attachments: res.attachments ?? [] }));
        } catch (e) {
          const message = String(e).replace(/^Error:\s*/, "");
          set((s) => {
            const view = s.sessions[key];
            if (!view) return s;
            return {
              sessions: {
                ...s.sessions,
                [key]: {
                  ...view,
                  notifications: [
                    ...view.notifications,
                    { sessionId: key, kind: "warn", message: `${file.name}: ${message}` },
                  ],
                },
              },
            };
          });
        }
      }
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
