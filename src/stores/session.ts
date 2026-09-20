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
}

const uid = () => Math.random().toString(36).slice(2, 10);

const emptyView = (key: string): SessionView => ({
  key,
  messages: [],
  metrics: null,
  confirmations: [],
  notifications: [],
  sending: false,
});

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

    init: () => {
      bootPromise ??= (async () => {
        await attach();
        const info = await phoson.initialize();
        const key = info.defaultSessionId;
        set((s) => ({
          ready: true,
          activeKey: key,
          order: [key],
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
  };
});
