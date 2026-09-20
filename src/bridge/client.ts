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
  Attachment,
  ConfigView,
  Envelope,
  FsListResult,
  FsReadResult,
  InitResult,
  McpServer,
  McpState,
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

/** Abre una URL en el navegador del sistema (o en una pestaña, en el navegador). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

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
          onboarding: {
            needed:
              typeof location !== "undefined" &&
              new URLSearchParams(location.search).has("onboarding"),
            providers: MOCK_CONFIG.providers,
          },
          metrics: this.metrics("demo"),
        } as unknown as T;
      case "session.new": {
        const id = "demo-" + Math.random().toString(36).slice(2, 7);
        this.sessions.set(id, { model: "deepseek/deepseek-v4.1-flash", provider: "openrouter" });
        return { sessionId: id } as unknown as T;
      }
      case "session.list":
        return { sessions: MOCK_SESSIONS } as unknown as T;
      case "session.delete": {
        const id = String(p.id);
        const idx = MOCK_SESSIONS.findIndex((x) => x.id === id);
        if (idx >= 0) MOCK_SESSIONS.splice(idx, 1);
        return { ok: true, id } as unknown as T;
      }
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
      case "fs.cwd":
        return { cwd: MOCK_CWD } as unknown as T;
      case "fs.list": {
        const path = String(p.path ?? MOCK_CWD);
        const raw = MOCK_FS[path] ?? [];
        const entries = raw
          .map((e) => ({
            ...e,
            hidden: e.hidden ?? e.name.startsWith("."),
            mtime: Math.floor(Date.now() / 1000),
          }))
          .sort(
            (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
          );
        const parent = path.split("/").slice(0, -1).join("/") || null;
        return { path, parent, entries, truncated: false } as unknown as T;
      }
      case "fs.setCwd":
        MOCK_CWD = String(p.path);
        return { cwd: MOCK_CWD } as unknown as T;
      case "fs.read": {
        const path = String(p.path);
        const text = MOCK_FILES[path];
        if (text === undefined) throw new Error(`no es un archivo: ${path}`);
        return {
          path,
          binary: false,
          text,
          size: text.length,
          truncated: false,
        } as unknown as T;
      }
      case "fs.write":
        MOCK_FILES[String(p.path)] = String(p.text ?? "");
        return { ok: true, path: p.path } as unknown as T;
      case "mcp.get":
        return MOCK_MCP as unknown as T;
      case "attachment.list":
        return { attachments: MOCK_ATTACHMENTS } as unknown as T;
      case "attachment.push": {
        const name = String(p.name ?? "archivo");
        const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
        const allowed: Record<string, string[]> = {
          image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
          audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
          video: ["mp4", "webm", "mov", "mkv", "avi"],
          document: ["pdf"],
        };
        // Igual que el engine: rechaza tipos no soportados.
        const kind = Object.keys(allowed).find((k) => allowed[k].includes(ext));
        if (p.data && !kind) throw new Error(`Unsupported file type '.${ext}'.`);
        MOCK_ATTACHMENTS = [
          ...MOCK_ATTACHMENTS,
          { path: `/home/me/.phoson/attachments/${name}`, name, kind: kind ?? "file" },
        ];
        return { ok: true, attachments: MOCK_ATTACHMENTS } as unknown as T;
      }
      case "attachment.remove":
        MOCK_ATTACHMENTS = MOCK_ATTACHMENTS.filter((a) => a.path !== String(p.path));
        return { ok: true, attachments: MOCK_ATTACHMENTS } as unknown as T;
      case "mcp.save": {
        const name = String(p.name);
        const incoming = (p.server ?? {}) as Record<string, unknown>;
        const prev = MOCK_MCP.servers.find((s) => s.name === name);
        const env = (incoming.env ?? {}) as Record<string, string>;
        const next: McpServer = {
          name,
          transport: String(incoming.transport ?? prev?.transport ?? "stdio"),
          command: String(incoming.command ?? prev?.command ?? ""),
          args: (incoming.args as string[]) ?? prev?.args ?? [],
          url: String(incoming.url ?? prev?.url ?? ""),
          enabled: Boolean(incoming.enabled ?? prev?.enabled ?? true),
          envKeys: Object.keys(env).length
            ? [...new Set([...(prev?.envKeys ?? []), ...Object.keys(env)])]
            : (prev?.envKeys ?? []),
        };
        MOCK_MCP = {
          ...MOCK_MCP,
          servers: [...MOCK_MCP.servers.filter((s) => s.name !== name), next],
        };
        return { ok: true, mcp: MOCK_MCP } as unknown as T;
      }
      case "mcp.remove":
        MOCK_MCP = {
          ...MOCK_MCP,
          servers: MOCK_MCP.servers.filter((s) => s.name !== String(p.name)),
        };
        return { ok: true, mcp: MOCK_MCP } as unknown as T;
      case "config.set": {
        const patch = (p.patch ?? {}) as Record<string, unknown>;
        // El backend usa snake_case en el patch; el mock normaliza a su vista.
        if ("provider" in patch) MOCK_CONFIG.provider = String(patch.provider);
        if ("model" in patch) MOCK_CONFIG.model = String(patch.model);
        if ("subagent_model" in patch) MOCK_CONFIG.subagentModel = String(patch.subagent_model);
        if ("safe_mode" in patch) MOCK_CONFIG.safeMode = Boolean(patch.safe_mode);
        if ("reasoning_effort" in patch)
          MOCK_CONFIG.reasoningEffort = patch.reasoning_effort as string | null;
        const secrets = (p.secrets ?? {}) as Record<string, string>;
        const urls = (p.base_urls ?? {}) as Record<string, string>;
        if (Object.keys(secrets).length || Object.keys(urls).length) {
          MOCK_CONFIG.providers = MOCK_CONFIG.providers.map((pr) => {
            if (secrets[pr.id]) return { ...pr, hasKey: true, source: "file" as const };
            if (urls[pr.id] !== undefined) return { ...pr, baseUrl: urls[pr.id] };
            return pr;
          });
        }
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
    const total = words.length;
    // Secuencia de tools INTERCALADA con el texto, como hace el engine real
    // (iteraciones del bucle ReAct): permite verificar el orden en el thread.
    const marks = [
      { at: Math.floor(total * 0.1), kind: "start", id: "call_mock_1", name: "bash", args: { command: "uname -a" } },
      { at: Math.floor(total * 0.16), kind: "done", id: "call_mock_1", name: "bash", result: "Linux phoson 6.11.0 #1 SMP x86_64 GNU/Linux" },
      { at: Math.floor(total * 0.5), kind: "start", id: "call_mock_2", name: "bash", args: { command: "df -h /" } },
      { at: Math.floor(total * 0.56), kind: "done", id: "call_mock_2", name: "bash", result: "/dev/nvme0n1 233G 187G 34G 85%" },
    ] as const;

    let t = 220;
    words.forEach((word, i) => {
      t += 14 + Math.random() * 26;
      setTimeout(() => ev({ type: "AgentTokenEvent", timestamp: now(), content: word }), t);
      for (const mark of marks.filter((m) => m.at === i)) {
        setTimeout(() => {
          if (mark.kind === "start") {
            ev({
              type: "AgentToolStartEvent",
              timestamp: now(),
              tool_call_id: mark.id,
              tool_name: mark.name,
              args: mark.args,
            });
          } else {
            ev({
              type: "AgentToolDoneEvent",
              timestamp: now(),
              tool_call_id: mark.id,
              tool_name: mark.name,
              result: mark.result,
              error: null,
            });
          }
        }, t);
      }
    });
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

/** FS virtual para el explorador en modo demo (navegador, sin sidecar). */
const MOCK_FS: Record<string, Array<{ name: string; dir: boolean; size?: number; hidden?: boolean }>> = {
  "/home/me": [
    { name: "proyecto", dir: true },
    { name: ".phoson", dir: true, hidden: true },
    { name: "notas.md", dir: false, size: 1204 },
  ],
  "/home/me/proyecto": [
    { name: "src", dir: true },
    { name: "public", dir: true },
    { name: "README.md", dir: false, size: 8421 },
    { name: "package.json", dir: false, size: 932 },
    { name: "vite.config.ts", dir: false, size: 665 },
  ],
  "/home/me/proyecto/src": [
    { name: "features", dir: true },
    { name: "components", dir: true },
    { name: "App.tsx", dir: false, size: 7820 },
    { name: "main.tsx", dir: false, size: 274 },
  ],
  "/home/me/proyecto/public": [{ name: "icon.svg", dir: false, size: 2379 }],
  "/home/me/.phoson": [
    { name: "sessions", dir: true },
    { name: "config.toml", dir: false, size: 410 },
  ],
};
let MOCK_ATTACHMENTS: Attachment[] = [];

let MOCK_CWD = "/home/me/proyecto";

/** Contenido de archivos para el visor en modo demo. */
const MOCK_FILES: Record<string, string> = {
  "/home/me/proyecto/package.json":
    '{\n  "name": "proyecto",\n  "version": "1.0.0",\n  "private": true\n}\n',
  "/home/me/proyecto/README.md":
    "# Proyecto\n\nDemo del **visor** de código.\n\n- resaltado con shiki\n- modo edición\n",
  "/home/me/proyecto/vite.config.ts":
    'import { defineConfig } from "vite";\n\nexport default defineConfig({\n  server: { port: 1420 },\n});\n',
  "/home/me/proyecto/src/App.tsx":
    "export default function App() {\n  return <div className=\"app\">hola</div>;\n}\n",
  "/home/me/proyecto/src/main.tsx":
    'import { createRoot } from "react-dom/client";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  "/home/me/proyecto/public/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" />\n',
  "/home/me/.phoson/config.toml": '[defaults]\nmodel = "deepseek/deepseek-v4.1-flash"\n',
};

let MOCK_MCP: McpState = {
  enabled: true,
  configPath: "~/.phoson/mcps.json",
  sdkAvailable: true,
  servers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      enabled: true,
      envKeys: [],
    },
    {
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      enabled: true,
      envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    },
  ],
};

const MOCK_CONFIG: ConfigView = {  provider: "openrouter",
  model: "deepseek/deepseek-v4.1-flash",
  subagentModel: "deepseek/deepseek-v4.1-flash",
  reasoningEffort: "medium",
  theme: "dark",
  safeMode: false,
  notifyOnCompletion: "desktop",
  sessionsDir: "~/.phoson/sessions",
  enabledProviders: ["openrouter", "anthropic", "openai"],
  providers: [
    { id: "openrouter", hasKey: true, source: "file", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "openai", hasKey: true, source: "env", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "anthropic", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "ollama", hasKey: false, source: "default", supportsKey: false, supportsBaseUrl: true, baseUrl: "http://localhost:11434" },
    { id: "github", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "nvidia", hasKey: true, source: "file", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "xai", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "groq", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "deepseek", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "together", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "perplexity", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "lmstudio", hasKey: false, source: "default", supportsKey: false, supportsBaseUrl: true, baseUrl: "" },
    { id: "vllm", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: true, baseUrl: "" },
    { id: "azure", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "gemini", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "mistral", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "bedrock", hasKey: false, source: "default", supportsKey: false, supportsBaseUrl: false, baseUrl: "" },
    { id: "fireworks", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "cohere", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: false, baseUrl: "" },
    { id: "omniroute", hasKey: false, source: "default", supportsKey: true, supportsBaseUrl: true, baseUrl: "" },
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
    bridge.rpc<{ sessionId: string; cwd?: string; cwdMissing?: boolean }>("session.open", { id: engineId }),
  closeSession: (sessionId: string) => bridge.rpc("session.close", { sessionId }),
  listSessions: () => bridge.rpc<{ sessions: SessionMeta[] }>("session.list"),
  deleteSession: (id: string) =>
    bridge.rpc<{ ok: boolean; id: string }>("session.delete", { id }),
  listModels: (sessionId: string) =>
    bridge.rpc<ModelsListResult>("models.list", { sessionId }),
  setModel: (sessionId: string, model: string, provider?: string) =>
    bridge.rpc("model.set", { sessionId, model, provider }),
  getConfig: (sessionId: string) => bridge.rpc<ConfigView>("config.get", { sessionId }),
  setConfig: (sessionId: string, patch: Json, secrets?: Json, baseUrls?: Json) =>
    bridge.rpc("config.set", { sessionId, patch, secrets, base_urls: baseUrls }),
  fsCwd: () => bridge.rpc<{ cwd: string }>("fs.cwd"),
  fsList: (path?: string) =>
    bridge.rpc<FsListResult>("fs.list", path ? { path } : {}),
  fsSetCwd: (path: string) => bridge.rpc<{ cwd: string }>("fs.setCwd", { path }),
  fsRead: (path: string) => bridge.rpc<FsReadResult>("fs.read", { path }),
  fsWrite: (path: string, text: string) =>
    bridge.rpc<{ ok: boolean; path: string }>("fs.write", { path, text }),
  mcpGet: (sessionId: string) => bridge.rpc<McpState>("mcp.get", { sessionId }),
  mcpSave: (sessionId: string, name: string, server: Json) =>
    bridge.rpc<{ ok: boolean; mcp: McpState }>("mcp.save", { sessionId, name, server }),
  mcpRemove: (sessionId: string, name: string) =>
    bridge.rpc<{ ok: boolean; mcp: McpState }>("mcp.remove", { sessionId, name }),
  attachmentList: (sessionId: string) =>
    bridge.rpc<{ attachments: Attachment[] }>("attachment.list", { sessionId }),
  attachmentPush: (sessionId: string, name: string, data: string) =>
    bridge.rpc<{ ok: boolean; attachments: Attachment[] }>("attachment.push", {
      sessionId,
      name,
      data,
    }),
  attachmentRemove: (sessionId: string, path: string) =>
    bridge.rpc<{ ok: boolean; attachments: Attachment[] }>("attachment.remove", {
      sessionId,
      path,
    }),
  runTurn: (sessionId: string, text: string) =>
    bridge.rpc("turn.run", { sessionId, text }),
  cancelTurn: (sessionId: string) =>
    bridge.rpc<{ cancelled: boolean }>("turn.cancel", { sessionId }),
  respondConfirm: (sessionId: string, requestId: string, decision: "yes" | "always" | "no") =>
    bridge.rpc("confirm.respond", { sessionId, requestId, decision }),
};
