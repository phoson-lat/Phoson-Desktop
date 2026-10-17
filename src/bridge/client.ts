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

import { record } from "@/lib/perf";
import { logEvent } from "@/lib/log";
import { basenameOf } from "@/lib/files";
import i18n from "@/lib/i18n";

import type {
  Attachment,
  UploadedFile,
  ConfigView,
  Envelope,
  FsListResult,
  FsReadResult,
  InitResult,
  McpServer,
  McpState,
  PluginEntry,
  PluginsState,
  PluginsSetResult,
  PluginsInstallResult,
  RunMetrics,
  SessionMeta,
  ModelsListResult,
  SttStatus,
  SttStartResult,
  SttConfigSetResult,
  SttDownloadResult,
  Json,
} from "./protocol";
import { demoAssistant, demoUser } from "../lib/demo-content";

export interface Bridge {
  rpc<T = Json>(method: string, params?: Json, workspace?: string | null): Promise<T>;
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

/** Abre una ruta local en el visor/aplicación por defecto del sistema. */
export async function openPath(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_path", { path });
}

// ── Implementación real (Tauri) ───────────────────────────────────────────
class TauriBridge implements Bridge {
  async rpc<T = Json>(method: string, params?: Json, workspace?: string | null): Promise<T> {
    // Punto único de paso de todas las acciones del frontend al sidecar: aquí
    // se mide “tiempo de cada acción” y se registra cada RPC para analizar
    // calidad (latencia, errores). `phosonPerf.summary()` lo agrega.
    const start = performance.now();
    const p = (params ?? {}) as Record<string, unknown>;
    const sessionId =
      (p.sessionId as string | undefined) ?? (p.session_id as string | undefined) ?? null;
    try {
      const out = await invoke<T>("rpc", {
        method,
        params: params ?? {},
        workspace: workspace ?? null,
      });
      logEvent(
        "rpc",
        {
          method,
          workspace: workspace ?? null,
          sessionId,
          ms: Math.round(performance.now() - start),
          ok: true,
          params: p,
        },
        "info",
        "rpc",
      );
      return out;
    } catch (error) {
      logEvent(
        "rpc",
        {
          method,
          workspace: workspace ?? null,
          sessionId,
          ms: Math.round(performance.now() - start),
          ok: false,
          params: p,
          error: error instanceof Error ? error.message : String(error),
        },
        "error",
        "rpc",
      );
      throw error;
    } finally {
      record(`rpc:${method}`, performance.now() - start);
    }
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
          tools: this.toolCatalog(),
          commands: [
            { names: ["/model"], help: i18n.t("welcome:commands.model") },
            { names: ["/sessions"], help: i18n.t("welcome:commands.sessions") },
            { names: ["/compact"], help: i18n.t("welcome:commands.compact") },
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
        // Con métricas desde ya (como el sidecar): el chip de modelo del
        // composer sale de aquí y no espera al primer turno.
        return { sessionId: id, metrics: this.metrics(id) } as unknown as T;
      }
      case "session.open": {
        // El sidecar abre una sesión nueva para el historial pedido.
        const id = "demo-" + Math.random().toString(36).slice(2, 7);
        this.sessions.set(id, { model: "deepseek/deepseek-v4.1-flash", provider: "openrouter" });
        return {
          sessionId: id,
          cwd: "",
          cwdMissing: false,
          metrics: this.metrics(id),
        } as unknown as T;
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
        const entry = MOCK_FILES[path];
        if (entry === undefined) throw new Error(i18n.t("welcome:demo.notAFile", { path }));
        // Las entradas perezosas (prosa de UI) se resuelven aquí, con el idioma
        // activo en el momento de leer: al importar el módulo i18next todavía no
        // tiene idioma y saldría la clave cruda.
        const text = typeof entry === "function" ? entry() : entry;
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
      case "fs.readImage": {
        // Modo demo: no hay sistema de archivos, se devuelve un SVG generado
        // (así las previsualizaciones tienen algo que pintar).
        const path = String(p.path);
        // El nombre por defecto se pinta dentro del SVG: es texto de UI.
        const fallback = i18n.t("system:images.defaultName");
        const name = (path.split(/[\\/]/).pop() ?? fallback).replace(/[^\x20-\x7E]/g, "?");
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">` +
          `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#22d3ee"/>` +
          `</linearGradient></defs><rect width="320" height="240" fill="url(#g)"/>` +
          `<text x="16" y="224" font-family="sans-serif" font-size="14" fill="#fff">${name}</text></svg>`;
        return {
          path,
          mediaType: "image/svg+xml",
          size: svg.length,
          base64: btoa(svg),
        } as unknown as T;
      }
      case "upload.file": {
        // Modo demo: simula la subida al workspace.
        const name = String(p.name ?? "archivo");
        const relative = `uploads/${name}`;
        return {
          ok: true,
          path: `${MOCK_CWD}/${relative}`,
          relative,
          name,
          size: 1024,
        } as unknown as T;
      }
      case "stt.status":
        // El navegador no puede capturar audio en modo demo: la UI recurre a la
        // Web Speech API si existe, o deshabilita el botón.
        return {
          supported: false,
          listening: false,
          language: null,
          languages: [],
          reason: i18n.t("welcome:demo.sttUnavailable"),
        } as unknown as T;
      case "stt.start":
        return { ok: false, supported: false, reason: i18n.t("welcome:demo.sttUnavailable") } as unknown as T;
      case "stt.stop":
        return { ok: true } as unknown as T;
      case "stt.config.set":
        // En modo demo no hay sidecar: el dictado no tiene ajustes que mover.
        return {
          ok: false,
          reason: i18n.t("welcome:demo.sttUnavailable"),
        } as unknown as T;
      case "stt.download":
        return { ok: false, reason: i18n.t("welcome:demo.sttUnavailable") } as unknown as T;
      case "mcp.get":
        return MOCK_MCP as unknown as T;
      case "attachment.list":
        return { attachments: MOCK_ATTACHMENTS } as unknown as T;
      case "attachment.add": {
        // El mock guarda los adjuntos ya normalizados (como `attachment.push`);
        // el cliente acepta ambas formas, así que aquí basta con añadirlo.
        const path = String(p.path ?? "");
        if (!MOCK_ATTACHMENTS.some((a) => a.path === path)) {
          const name = basenameOf(path);
          MOCK_ATTACHMENTS = [
            ...MOCK_ATTACHMENTS,
            { path, name, kind: attachmentKindOf(name) ?? "file" },
          ];
        }
        return { attachments: MOCK_ATTACHMENTS } as unknown as T;
      }
      case "attachment.push": {
        const name = String(p.name ?? "archivo");
        // Igual que el engine: rechaza tipos no soportados.
        const kind = attachmentKindOf(name);
        if (p.data && !kind) throw new Error(`Unsupported file type '.${name.split(".").pop()}'.`);
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
      case "plugins.get":
        // En la demo sí se ofrece instalar (el sidecar empacado no puede): así el
        // flujo completo —confirmar origen, instalar, ver la entrada nueva— se
        // puede probar en el navegador sin Tauri ni Python.
        return {
          plugins: MOCK_PLUGINS,
          canInstall: true,
          installBlocked: "",
          configPath: "~/.phoson/config.toml",
        } as unknown as T;
      case "plugins.set": {
        const id = String(p.id);
        const entry = MOCK_PLUGINS.find((e) => e.id === id);
        if (!entry) return { ok: false, reason: "unknown", detail: id } as unknown as T;
        if (entry.locked) {
          return { ok: false, reason: "locked", detail: entry.lockReason } as unknown as T;
        }
        MOCK_PLUGINS = MOCK_PLUGINS.map((e) =>
          e.id === id ? { ...e, enabled: Boolean(p.enabled) } : e,
        );
        return {
          ok: true,
          path: "~/.phoson/config.toml",
          fields: entry.flag ? [entry.flag] : ["plugins", "disabled_plugins"],
          plugins: MOCK_PLUGINS,
          // Como el sidecar: tras recargar los engines, el catálogo de tools al
          // día (es lo que refresca los selectores de tools en la UI).
          tools: this.toolCatalog(),
        } as unknown as T;
      }
      case "plugins.install": {
        // Nombre derivado del origen, como haría el entry point del paquete.
        const slug =
          String(p.source ?? "")
            .replace(/\.git$/, "")
            .split(/[\\/]/)
            .filter(Boolean)
            .pop() ?? "plugin";
        const name = `entrypoint:${slug.replace(/[^A-Za-z0-9_.-]+/g, "-")}`;
        if (!MOCK_PLUGINS.some((e) => e.id === name)) {
          MOCK_PLUGINS = [
            ...MOCK_PLUGINS,
            {
              id: name,
              name: slug,
              description: "",
              enabled: true,
              mechanism: "list",
              flag: "",
              listed: true,
              official: false,
              locked: false,
              lockReason: "",
              missingExtra: "",
            },
          ];
        }
        return { ok: true, name, plugins: MOCK_PLUGINS, tools: this.toolCatalog() } as unknown as T;
      }
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

  /** Tools base de la demo (las que no vienen de ningún plugin del mock). */
  private static readonly MOCK_BASE_TOOLS = [
    "discover", "read_file", "write_file", "patch_file", "list_dir",
    "bash", "grep", "glob", "web_search", "web_fetch",
  ];

  /**
   * Herramientas que aporta cada plugin del mock, para que activar o
   * desactivar en la demo se refleje en los selectores de tools igual que en el
   * sidecar real (que reconstruye los engines y devuelve el catálogo nuevo).
   */
  private static readonly MOCK_PLUGIN_TOOLS: Record<string, string[]> = {
    "phoson-plugin-monitor": ["monitor_start", "monitor_list", "monitor_stop"],
    "phoson-plugin-swarm": ["swarm_create"],
    "phoson-plugin-memory": ["memory_search", "memory_save"],
    "phoson-plugin-checkpoint": ["checkpoint_save", "checkpoint_restore"],
  };

  /** Catálogo de tools coherente con los plugins activos del mock. */
  private toolCatalog() {
    const visible = [...MockBridge.MOCK_BASE_TOOLS];
    for (const entry of MOCK_PLUGINS) {
      if (!entry.enabled) continue;
      visible.push(...(MockBridge.MOCK_PLUGIN_TOOLS[entry.id] ?? []));
    }
    return { visible, maskedCount: 70 };
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
   * demo (o menciona "demo"), streamea el markdown de `demoAssistant()` completo.
   */
  private simulateTurn(sessionId: string, text: string) {
    const normalized = text.trim().toLowerCase();
    const isDemo =
      normalized === demoUser().toLowerCase() || normalized.includes("demo");
    const reply = isDemo ? demoAssistant() : i18n.t("welcome:demo.genericReply");

    const ev = (event: Record<string, unknown>) =>
      this.emit("agent.event", { sessionId, event });
    const now = () => Date.now();

    this.emit("session.turn.started", { sessionId, task: text });
    setTimeout(() => ev({ type: "AgentStartEvent", timestamp: now(), tool_count: 10 }), 120);

    // Razonamiento simulado (solo en la demo): hace visible el bloque "Reasoning"
    // y su indicador de "Pensando…" antes de que empiece el texto.
    const thoughts = isDemo ? i18n.t("welcome:demo.reasoning") : "";
    let reasoningAt = 140;
    if (thoughts) {
      for (const chunk of thoughts.match(/.{1,18}/g) ?? []) {
        reasoningAt += 45;
        setTimeout(
          () => ev({ type: "AgentReasoningEvent", timestamp: now(), content: chunk }),
          reasoningAt,
        );
      }
    }

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

    let t = (thoughts ? reasoningAt : 0) + 220;
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

/** Extensiones que el engine acepta como adjunto nativo, por tipo. */
const MOCK_ATTACHMENT_EXTS: Record<string, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
  audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac"],
  video: ["mp4", "webm", "mov", "mkv", "avi"],
  document: ["pdf"],
};

/** Tipo de adjunto de un archivo por su extensión (`null` si no es nativo). */
const attachmentKindOf = (name: string): string | null => {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return Object.keys(MOCK_ATTACHMENT_EXTS).find((k) => MOCK_ATTACHMENT_EXTS[k].includes(ext)) ?? null;
};

let MOCK_CWD = "/home/me/proyecto";

/**
 * Contenido de archivos para el visor en modo demo.
 *
 * Una entrada puede ser una función: se resuelve **al leer** el archivo, con el
 * idioma activo en ese momento. Hace falta para la prosa de UI (el README), que
 * no puede resolverse al importar el módulo: i18next todavía no tiene idioma y
 * lo que se guardaría es la clave cruda.
 */
const MOCK_FILES: Record<string, string | (() => string)> = {
  "/home/me/proyecto/package.json":
    '{\n  "name": "proyecto",\n  "version": "1.0.0",\n  "private": true\n}\n',
  // El README lo pinta el visor de código, así que su prosa es UI traducible.
  "/home/me/proyecto/README.md": () => i18n.t("welcome:demo.readme"),
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

/**
 * Plugins del engine en modo demo: el catálogo real (`phoson_cli.labels`) con
 * estados variados — activo por lista, activo por flag, apagado, bloqueado y con
 * extra ausente — para poder ver todos los casos de la sección de Ajustes.
 */
let MOCK_PLUGINS: PluginEntry[] = [
  {
    id: "phoson-plugin-monitor",
    name: "Background Monitor",
    description: "Wake the agent on file changes, intervals or command output",
    enabled: true,
    mechanism: "flag",
    flag: "enable_monitors",
    listed: false,
    official: true,
    locked: false,
    lockReason: "",
    missingExtra: "",
  },
  {
    id: "phoson-plugin-checkpoint",
    name: "Checkpoints",
    description: "Snapshot and restore state around risky steps",
    enabled: true,
    mechanism: "list",
    flag: "",
    listed: true,
    official: true,
    locked: false,
    lockReason: "",
    missingExtra: "",
  },
  {
    id: "phoson-plugin-memory",
    name: "Long-term Memory",
    description: "Persistent memory across sessions (Redis / Postgres / Qdrant)",
    enabled: false,
    mechanism: "list",
    flag: "",
    listed: false,
    official: true,
    locked: false,
    lockReason: "",
    missingExtra: "redis",
  },
  {
    id: "phoson-plugin-swarm",
    name: "Agent Swarm",
    description: "Fan a task out to parallel sub-agents",
    enabled: false,
    mechanism: "flag",
    flag: "enable_swarm",
    listed: false,
    official: true,
    locked: false,
    lockReason: "",
    missingExtra: "",
  },
  {
    id: "phoson-plugin-ssh",
    name: "SSH",
    description: "Run commands on remote hosts over SSH",
    enabled: true,
    mechanism: "list",
    flag: "enable_ssh",
    listed: false,
    official: true,
    locked: true,
    lockReason: "file:enable_ssh",
    missingExtra: "ssh",
  },
  {
    id: "phoson-plugin-stt",
    name: "Speech-to-Text",
    description: "Transcribe microphone input offline (Moonshine, multilingual)",
    enabled: true,
    mechanism: "list",
    flag: "",
    listed: false,
    official: true,
    locked: true,
    lockReason: "dictation",
    missingExtra: "",
  },
];

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

// ── Enrutado por workspace ────────────────────────────────────────────────
// Cada proyecto (workspace) tiene su propio sidecar, con su propio `cwd` de
// proceso: así varios proyectos conviven a la vez sin pisarse. El frontend
// registra aquí a qué workspace pertenece cada sesión; `call` deduce el
// workspace de `params.sessionId` (o usa el "actual" para las llamadas sin
// sesión). Las llamadas existentes no cambian: el enrutado es transparente.
const sessionWorkspace = new Map<string, string>();
let currentWorkspace: string | null = null;

/**
 * Asocia una sesión a la **clave de workspace que se usó para enrutarla** (no al
 * `cwd` que el sidecar reporta). `""` es válido y significa "sidecar por
 * defecto"; hay que conservarlo, o las llamadas de esa sesión caerían al
 * `currentWorkspace` actual y acabarían en OTRO sidecar (sesión desconocida).
 */
export const bindSessionWorkspace = (sessionId: string, workspace: string) => {
  sessionWorkspace.set(sessionId, workspace);
};

/** Desasocia una sesión (al cerrarla). */
export const unbindSessionWorkspace = (sessionId: string) => {
  sessionWorkspace.delete(sessionId);
};

/** Workspace activo para las llamadas sin `sessionId`. */
export const setCurrentWorkspace = (workspace: string | null) => {
  currentWorkspace = workspace;
};

export const getCurrentWorkspace = () => currentWorkspace;

/** Cierra (mata) el sidecar de un workspace: se respawnea al volver a usarlo. */
export const killSidecar = async (workspace?: string | null): Promise<boolean> => {
  if (!isTauri()) return false;
  return invoke<boolean>("kill_sidecar", { workspace: workspace ?? null });
};

/**
 * Aviso de que un sidecar terminó (evento `phoson://terminated` de Rust).
 * `idle: true` = expulsión programada por inactividad: no es un fallo, el
 * sidecar se respawnea al volver a usarlo (la UI lo trata en silencio).
 * Fuera de Tauri no hay proceso que pueda morir: no-op.
 */
export const onTerminated = (
  handler: (payload: { workspace: string; code: number | null; idle?: boolean }) => void,
): Promise<UnlistenFn> => {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<{ workspace: string; code: number | null; idle?: boolean }>(
    "phoson://terminated",
    (e) => handler(e.payload),
  );
};

const call = <T = Json,>(method: string, params?: Json): Promise<T> => {
  const sid = (params as { sessionId?: string } | undefined)?.sessionId;
  const workspace = (sid ? sessionWorkspace.get(sid) : undefined) ?? currentWorkspace;
  return bridge.rpc<T>(method, params, workspace);
};

const callIn = <T = Json,>(workspace: string | null, method: string, params?: Json): Promise<T> =>
  bridge.rpc<T>(method, params, workspace);

// ── Adjuntos ──────────────────────────────────────────────────────────────

/**
 * Adjunto del engine sin normalizar: `attachment.add` responde con el
 * dataclass tal cual (`{ path, block }`), sin nombre ni tipo.
 */
export interface RawAttachment {
  path?: unknown;
  block?: { type?: unknown } | null;
  /** Presentes solo si el sidecar ya lo normalizó (`attachment.list`). */
  name?: string;
  kind?: string;
}

/**
 * Normaliza un adjunto a la vista que consume la UI.
 *
 * El tipo se deduce del nombre del bloque (`ImageBlock` → `image`), igual que
 * hace `_attachment_payload` en el sidecar; si ya viene normalizado se respeta.
 */
export function normalizeAttachment(raw: RawAttachment): Attachment {
  const path = String(raw.path ?? "");
  const blockType = typeof raw.block?.type === "string" ? raw.block.type : "";
  const derived = blockType ? blockType.replace(/Block$/, "").toLowerCase() : "file";
  return { path, name: raw.name || basenameOf(path), kind: raw.kind || derived };
}

// ── Atajos tipados (lo que consume el store) ──────────────────────────────
export const phoson = {
  rpc: call,
  onNotify: (handler: (envelope: Envelope) => void) => bridge.onNotify(handler),
  initialize: (workspace?: string | null) => callIn<InitResult>(workspace ?? currentWorkspace, "initialize"),
  newSession: (workspace?: string | null) =>
    callIn<{ sessionId: string; cwd?: string; metrics?: RunMetrics }>(
      workspace ?? currentWorkspace,
      "session.new",
    ),
  openSession: (engineId: string, workspace?: string | null) =>
    callIn<{ sessionId: string; cwd?: string; cwdMissing?: boolean; metrics?: RunMetrics }>(
      workspace ?? currentWorkspace,
      "session.open",
      { id: engineId },
    ),
  closeSession: (sessionId: string) => call("session.close", { sessionId }),
  /** Deshace el último turno de usuario (el engine mueve el cursor atrás). */
  sessionUndo: (sessionId: string) =>
    call<{ ok: boolean; message: string; history?: unknown[] | null }>("session.undo", { sessionId }),
  /** Salta el cursor a un turno de usuario previo. */
  sessionRewind: (sessionId: string, userNodeId: string) =>
    call<{ ok: boolean; message: string; history?: unknown[] | null }>("session.rewind", {
      sessionId,
      userNodeId,
    }),
  sessionJumpCandidates: (sessionId: string) =>
    call<{ candidates: Array<{ userNodeId: string; preview: string }> }>("session.jumpCandidates", {
      sessionId,
    }),
  /** Compacta el contexto (resumen del historial intermedio). */
  sessionCompact: (sessionId: string, profile?: string) =>
    call<{ ok: boolean; before: number; after: number; history?: unknown[] | null }>(
      "session.compact",
      profile ? { sessionId, profile } : { sessionId },
    ),
  /** Historial completo (todas las sesiones, de cualquier workspace). */
  listSessions: () => callIn<{ sessions: SessionMeta[] }>(null, "session.list"),
  /** Uso de recursos del sidecar (RSS/CPU), para medir rendimiento. */
  perf: () =>
    callIn<{
      pid: number;
      rssBytes: number;
      cpuUserSec: number;
      cpuSystemSec: number;
      uptimeSec: number;
    }>(null, "perf"),
  deleteSession: (id: string) => callIn<{ ok: boolean; id: string }>(null, "session.delete", { id }),
  listModels: (sessionId: string) =>
    call<ModelsListResult>("models.list", { sessionId }),
  setModel: (sessionId: string, model: string, provider?: string) =>
    call("model.set", { sessionId, model, provider }),
  getConfig: (sessionId: string) => call<ConfigView>("config.get", { sessionId }),
  setConfig: (sessionId: string, patch: Json, secrets?: Json, baseUrls?: Json) =>
    call("config.set", { sessionId, patch, secrets, base_urls: baseUrls }),
  fsCwd: (workspace?: string | null) =>
    callIn<{ cwd: string }>(workspace ?? currentWorkspace, "fs.cwd"),
  fsList: (path?: string) =>
    call<FsListResult>("fs.list", path ? { path } : {}),
  fsSetCwd: (path: string) => call<{ cwd: string }>("fs.setCwd", { path }),
  fsRead: (path: string) => call<FsReadResult>("fs.read", { path }),
  /** Lee una imagen local como base64 (data URL) para previsualizarla. */
  fsReadImage: (path: string) =>
    call<{ path: string; mediaType: string; size: number; base64: string }>("fs.readImage", {
      path,
    }),
  fsWrite: (path: string, text: string) =>
    call<{ ok: boolean; path: string }>("fs.write", { path, text }),
  // Dictado por voz (motor STT del engine; sustituto de la Web Speech API en
  // WebKitGTK/WKWebView).
  sttStatus: () => call<SttStatus>("stt.status"),
  sttStart: (sessionId: string, language?: string) =>
    call<SttStartResult>("stt.start", language ? { sessionId, language } : { sessionId }),
  sttStop: (sessionId: string) => call<{ ok: boolean }>("stt.stop", { sessionId }),
  /**
   * Ajustes del dictado (Ajustes → Dictado): idioma/modelo persistentes en la
   * sección del plugin stt de config.toml. `null` en un campo lo borra (vuelve
   * al default de la librería; el idioma vuelve a seguir al de la interfaz).
   */
  sttConfigSet: (
    sessionId: string,
    patch: { modelArch?: string | null; language?: string | null },
  ) => {
    const params: Record<string, unknown> = { sessionId };
    if ("modelArch" in patch) params.modelArch = patch.modelArch ?? null;
    if ("language" in patch) params.language = patch.language ?? null;
    return call<SttConfigSetResult>("stt.config.set", params);
  },
  /** Pre-descarga del modelo de dictado (progreso por `stt.progress`). */
  sttDownload: (sessionId: string, language?: string | null) =>
    call<SttDownloadResult>(
      "stt.download",
      language ? { sessionId, language } : { sessionId },
    ),
  mcpGet: (sessionId: string) => call<McpState>("mcp.get", { sessionId }),
  mcpSave: (sessionId: string, name: string, server: Json) =>
    call<{ ok: boolean; mcp: McpState }>("mcp.save", { sessionId, name, server }),
  mcpRemove: (sessionId: string, name: string) =>
    call<{ ok: boolean; mcp: McpState }>("mcp.remove", { sessionId, name }),
  // Plugins del engine (Ajustes → Plugins). Activar/desactivar escribe en
  // `config.toml` (flags `enable_*` o las listas de specs) y reconstruye el
  // engine; instalar es código nuevo en el entorno del sidecar y el backend
  // exige `confirmed`, así que solo se llama desde el diálogo de confirmación
  // (el flag del RPC es el cerrojo del sidecar, no la confirmación del usuario).
  pluginsGet: (sessionId: string) => call<PluginsState>("plugins.get", { sessionId }),
  pluginsSet: (sessionId: string, id: string, enabled: boolean) =>
    call<PluginsSetResult>("plugins.set", { sessionId, id, enabled }),
  pluginsInstall: (sessionId: string, source: string) =>
    call<PluginsInstallResult>("plugins.install", { sessionId, source, confirmed: true }),
  attachmentList: (sessionId: string) =>
    call<{ attachments: Attachment[] }>("attachment.list", { sessionId }),
  /** Sube al workspace un archivo no adjuntable de forma nativa. */
  uploadFile: (sessionId: string, name: string, data: string) =>
    call<UploadedFile>("upload.file", { sessionId, name, data }),
  attachmentPush: (sessionId: string, name: string, data: string) =>
    call<{ ok: boolean; attachments: Attachment[] }>("attachment.push", {
      sessionId,
      name,
      data,
    }),
  attachmentRemove: (sessionId: string, path: string) =>
    call<{ ok: boolean; attachments: Attachment[] }>("attachment.remove", {
      sessionId,
      path,
    }),
  /**
   * Adjunta al turno pendiente una ruta que ya existe en disco (sin reenviar
   * bytes). Se usa al regenerar: el engine consume los adjuntos al enviar el
   * turno, así que hay que volver a añadirlos antes del siguiente.
   *
   * Devuelve el adjunto recién añadido (el último de la lista pendiente), o
   * `null` si el engine no devolvió ninguno.
   */
  attachmentAdd: (sessionId: string, path: string) =>
    call<{ attachments: RawAttachment[] }>("attachment.add", { sessionId, path }).then((res) => {
      const list = Array.isArray(res.attachments) ? res.attachments : [];
      return list.length > 0 ? normalizeAttachment(list[list.length - 1]) : null;
    }),
  runTurn: (sessionId: string, text: string) =>
    call("turn.run", { sessionId, text }),
  cancelTurn: (sessionId: string) =>
    call<{ cancelled: boolean }>("turn.cancel", { sessionId }),
  respondConfirm: (sessionId: string, requestId: string, decision: "yes" | "always" | "no") =>
    call("confirm.respond", { sessionId, requestId, decision }),
  /**
   * Responde una interacción de plugin (`questions`/`select`/`form`): el payload
   * va tal cual al Future que espera `GuiConfirmation` (p. ej. `{ selections,
   * other }` para questions, `{ choice }` para select, `{ values }` para form).
   */
  respondInteraction: (
    sessionId: string,
    requestId: string,
    payload: Record<string, Json>,
  ) => call("confirm.respond", { sessionId, requestId, ...payload }),
};
