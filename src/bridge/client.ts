/**
 * `PhosonClient` — única puerta del frontend hacia el sidecar.
 *
 *  - `rpc()`       -> `invoke('rpc')` (Rust escribe al stdin del sidecar y casa
 *                     la respuesta por `id`).
 *  - `onNotify()`  -> `listen('phoson://message')` (streaming).
 *
 * MODO MOCK: fuera de Tauri (p.ej. `pnpm dev` en un navegador) se usa un bridge
 * simulado para poder ver la UI sin compilar Tauri ni arrancar Python. Con el
 * mismo contrato de notificaciones que el sidecar real.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  ConfigView,
  Envelope,
  InitResult,
  SessionMeta,
  ModelsListResult,
  Json,
} from "./protocol";
import { DEMO_ASSISTANT, DEMO_USER } from "../lib/demo-content";

const GENERIC_REPLY =
  "Estás en **modo demo** (sin backend).\n\n" +
  "Envía `Muéstrame una demo de todo lo que sabes renderizar.` para ver " +
  "markdown, código, LaTeX, mermaid y artifacts HTML.";

export interface Bridge {
  rpc<T = Json>(method: string, params?: Json): Promise<T>;
  onNotify(handler: (envelope: Envelope) => void): Promise<UnlistenFn>;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ── Implementación real (Tauri) ───────────────────────────────────────────
class TauriBridge implements Bridge {
  async rpc<T = Json>(method: string, params?: Json): Promise<T> {
    return invoke<T>("rpc", { method, params: params ?? {} });
  }
  async onNotify(handler: (envelope: Envelope) => void): Promise<UnlistenFn> {
    return listen<Envelope>("phoson://message", (event) => handler(event.payload));
  }
}

// ── Implementación mock (navegador, sin backend) ──────────────────────────
class MockBridge implements Bridge {
  private handlers = new Set<(envelope: Envelope) => void>();
  private sessions = new Map<string, { model: string; provider: string }>();

  async rpc<T = Json>(method: string, params?: Json): Promise<T> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "initialize":
        return {
          config: {
            model: "deepseek/deepseek-v4.1-flash",
            provider: "openrouter",
            theme: "dark",
            sessionsDir: "~/.phoson/sessions",
            safeMode: false,
          },
          tools: {
            visible: [
              "discover", "read_file", "write_file", "patch_file", "list_dir",
              "bash", "grep", "glob", "web_search", "web_fetch",
            ],
            maskedCount: 70,
          },
          commands: [
            { names: ["/model"], help: "Elegir modelo" },
            { names: ["/sessions"], help: "Listar sesiones" },
            { names: ["/compact"], help: "Compactar contexto" },
          ],
          defaultSessionId: "demo",
          metrics: this.metrics("demo"),
        } as unknown as T;
      case "session.new": {
        const id = "demo-" + Math.random().toString(36).slice(2, 7);
        this.sessions.set(id, { model: "deepseek/deepseek-v4.1-flash", provider: "openrouter" });
        return { sessionId: id } as unknown as T;
      }
      case "session.list":
        return { sessions: MOCK_SESSIONS } as unknown as T;
      case "models.list":
        return {
          current: { model: "deepseek/deepseek-v4.1-flash", provider: "openrouter" },
          models: MOCK_MODELS,
        } as unknown as T;
      case "model.set": {
        const sid = String(p.sessionId);
        this.sessions.set(sid, { model: String(p.model), provider: String(p.provider) });
        setTimeout(
          () =>
            this.emit("session.metrics", {
              ...this.metrics(sid),
              model: String(p.model),
              provider: String(p.provider),
            }),
          120,
        );
        return { ok: true, model: p.model } as unknown as T;
      }
      case "config.get":
        return MOCK_CONFIG as unknown as T;
      case "config.set": {
        const patch = (p.patch ?? {}) as Record<string, unknown>;
        Object.assign(MOCK_CONFIG, patch);
        if (p.provider) MOCK_CONFIG.provider = String(p.provider);
        return { ok: true, path: "~/.phoson/config.toml", config: MOCK_CONFIG } as unknown as T;
      }
      case "turn.run":
        this.simulateTurn(String(p.sessionId), String(p.text));
        return { status: "done" } as unknown as T;
      default:
        return { ok: true } as unknown as T;
    }
  }

  async onNotify(handler: (envelope: Envelope) => void): Promise<UnlistenFn> {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(method: string, params: Record<string, unknown>) {
    const env = { method, params } as Envelope;
    for (const h of this.handlers) h(env);
  }

  private metrics(sessionId: string) {
    return {
      sessionId,
      costUsd: 0.0042,
      credits: 0,
      tokens: 1536,
      inputTokens: 1180,
      outputTokens: 356,
      steps: 2,
      contextTokens: 4210,
      contextWindow: 128000,
      model: "deepseek/deepseek-v4.1-flash",
      provider: "openrouter",
      isRunning: false,
    };
  }

  /**
   * Emula un turno streamando token a token. Si el prompt es el detonante de la
   * demo (o menciona "demo"), streamea `DEMO_ASSISTANT` completo.
   */
  private simulateTurn(sessionId: string, text: string) {
    const normalized = text.trim().toLowerCase();
    const isDemo =
      normalized === DEMO_USER.toLowerCase() || normalized.includes("demo");
    const reply = isDemo ? DEMO_ASSISTANT : GENERIC_REPLY;

    const ev = (event: Record<string, unknown>) =>
      this.emit("agent.event", { sessionId, event });
    const now = () => Date.now();

    this.emit("session.turn.started", { sessionId, task: text });
    setTimeout(() => ev({ type: "AgentStartEvent", timestamp: now(), tool_count: 10 }), 120);

    const words = reply.split(/(\s+)/);
    let t = 220;
    for (const w of words) {
      t += 14 + Math.random() * 26;
      setTimeout(() => ev({ type: "AgentTokenEvent", timestamp: now(), content: w }), t);
    }
    setTimeout(() => {
      ev({ type: "AgentDoneEvent", timestamp: now() });
      this.emit("session.metrics", { ...this.metrics(sessionId), isRunning: false });
      this.emit("session.assistant.done", {
        sessionId,
        status: "done",
        errorCode: null,
        finalContent: reply,
      });
    }, t + 200);
  }
}

const MOCK_CONFIG: ConfigView = {
  provider: "openrouter",
  model: "deepseek/deepseek-v4.1-flash",
  subagentModel: "deepseek/deepseek-v4.1-flash",
  reasoningEffort: "medium",
  theme: "dark",
  safeMode: false,
  notifyOnCompletion: "desktop",
  sessionsDir: "~/.phoson/sessions",
  enabledProviders: ["openrouter", "anthropic", "openai"],
  providers: [
    { id: "openrouter", hasKey: true, source: "file" },
    { id: "anthropic", hasKey: false, source: "default" },
    { id: "openai", hasKey: true, source: "env" },
    { id: "gemini", hasKey: false, source: "default" },
    { id: "groq", hasKey: false, source: "default" },
  ],
  hasProvider: true,
};

const MOCK_MODELS = [
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "openrouter", context_length: 128000, pricing: "$0.14/M in · $0.28/M out" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", provider: "openrouter", context_length: 200000, pricing: "$3/M in · $15/M out" },
  { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex", provider: "openrouter", context_length: 400000, pricing: "$1.25/M in · $10/M out" },
  { id: "google/gemini-3-pro", label: "Gemini 3 Pro", provider: "openrouter", context_length: 1000000, pricing: "$1.25/M in · $5/M out" },
  { id: "meta-llama/llama-4-70b", label: "Llama 4 70B", provider: "openrouter", context_length: 131072 },
];

const MOCK_SESSIONS: SessionMeta[] = [  { id: "a1b2c3", title: "Arquitectura del engine", updated_at: "2026-09-19T18:20:00", message_count: 12, total_cost: 0.041, last_model: "deepseek-v4.1-flash", cwd: "~/Phoson", status: "active" },
  { id: "d4e5f6", title: "Bridge JSON-RPC", updated_at: "2026-09-19T16:02:00", message_count: 8, total_cost: 0.018, last_model: "deepseek-v4.1-flash", cwd: "~/Phoson", status: "completed" },
  { id: "g7h8i9", title: "Port design system", updated_at: "2026-09-18T11:45:00", message_count: 21, total_cost: 0.077, last_model: "claude-sonnet", cwd: "~/Phoson", status: "completed" },
];

export const bridge: Bridge = isTauri() ? new TauriBridge() : new MockBridge();

// ── Atajos tipados (lo que consume el store) ──────────────────────────────
export const phoson = {
  rpc: <T = Json,>(method: string, params?: Json) => bridge.rpc<T>(method, params),
  onNotify: (handler: (envelope: Envelope) => void) => bridge.onNotify(handler),
  initialize: () => bridge.rpc<InitResult>("initialize"),
  newSession: () => bridge.rpc<{ sessionId: string }>("session.new"),
  openSession: (engineId: string) =>
    bridge.rpc<{ sessionId: string }>("session.open", { id: engineId }),
  closeSession: (sessionId: string) => bridge.rpc("session.close", { sessionId }),
  listSessions: () => bridge.rpc<{ sessions: SessionMeta[] }>("session.list"),
  listModels: (sessionId: string) =>
    bridge.rpc<ModelsListResult>("models.list", { sessionId }),
  setModel: (sessionId: string, model: string, provider?: string) =>
    bridge.rpc("model.set", { sessionId, model, provider }),
  getConfig: (sessionId: string) => bridge.rpc<ConfigView>("config.get", { sessionId }),
  setConfig: (sessionId: string, patch: Json, secrets?: Json) =>
    bridge.rpc("config.set", { sessionId, patch, secrets }),
  runTurn: (sessionId: string, text: string) =>
    bridge.rpc("turn.run", { sessionId, text }),
  cancelTurn: (sessionId: string) =>
    bridge.rpc<{ cancelled: boolean }>("turn.cancel", { sessionId }),
  respondConfirm: (sessionId: string, requestId: string, decision: "yes" | "always" | "no") =>
    bridge.rpc("confirm.respond", { sessionId, requestId, decision }),
};
