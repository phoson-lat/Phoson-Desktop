/**
 * Tipos del protocolo del bridge, alineados con lo VERIFICADO en
 * `bridge/phoson_bridge/` el 2026-09-19. Ver PLAN.md §3 y §9.
 */

export type Json = unknown;

/** Sobre de notificación reenviado por Rust en el evento `phoson://message`. */
export interface Envelope<T = Json> {
  method: string;
  params: T & { sessionId?: string };
}

/** `AgentEvent` serializado: discriminado por `type` (nombre de dataclass). */
export interface AgentEvent {
  type: string;
  timestamp?: number;
  /** AgentTokenEvent | AgentReasoningEvent */
  content?: string;
  /** AgentToolStartEvent | AgentToolDoneEvent */
  tool_name?: string;
  tool_call_id?: string;
  index?: number;
  /** AgentToolStartEvent */
  args?: unknown;
  /** AgentToolDoneEvent */
  result?: string;
  error?: string | null;
  duration_ms?: number;
  /** AgentDoneEvent / AgentErrorEvent */
  message?: string;
  [key: string]: unknown;
}

export interface RunMetrics {
  sessionId: string;
  costUsd: number;
  credits: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  contextTokens: number;
  contextWindow: number;
  model: string;
  provider: string;
  isRunning: boolean;
}

export interface SessionMeta {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
  total_cost: number;
  last_model: string;
  cwd: string;
  status: string;
}

export interface ConfirmRequest {
  sessionId: string;
  requestId: string;
  kind: "bash";
  command: string;
  actions: Array<"yes" | "always" | "no">;
}

export interface NotifyMessage {
  sessionId: string;
  kind: "info" | "warn" | "error";
  message: string;
}

export interface InitResult {
  config: {
    model: string;
    provider: string;
    theme: string;
    sessionsDir: string;
    safeMode: boolean;
  };
  tools: { visible: string[]; maskedCount: number };
  commands: Array<{ names: string[]; help: string }>;
  /** Presente cuando el sidecar sabe si hay proveedor configurado. */
  onboarding?: { needed: boolean; providers: ProviderStatus[] };
  defaultSessionId: string;
  /** cwd del sidecar por defecto (su workspace). */
  cwd?: string;
  metrics: RunMetrics;
}

/** `ModelOption` del CLI (`phoson_cli/models.py`) serializada. */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  description?: string;
  context_length?: number | null;
  pricing?: string;
  agentic_index?: number | null;
}

export interface ModelsListResult {
  current: { model: string; provider: string };
  models: ModelOption[];
  error?: string;
}

/** Procedencia de una clave: archivo, entorno o sin configurar. */
export interface ProviderStatus {
  id: string;
  hasKey: boolean;
  source: "file" | "env" | "default";
  /** El proveedor admite API key (p.ej. Ollama no). */
  supportsKey?: boolean;
  /** El proveedor admite `base_url` (vLLM, Ollama, LM Studio, OmniRoute…). */
  supportsBaseUrl?: boolean;
  /** Valor actual de la base_url (no es secreta). */
  baseUrl?: string;
}

export interface ConfigView {
  provider: string;
  model: string;
  subagentModel: string;
  reasoningEffort: string | null;
  theme: string;
  safeMode: boolean;
  /** "off" | "bell" | "desktop" (el engine lo guarda como string). */
  notifyOnCompletion: string;
  sessionsDir: string;
  enabledProviders: string[];
  providers: ProviderStatus[];
  hasProvider: boolean;
  /** MCP habilitado en el engine (plugin `phoson_plugin_mcp`). */
  enableMcp?: boolean;
  mcpConfigFile?: string;
}

/** Archivo no nativo subido al workspace (se referencia en el prompt). */
export interface UploadedFile {
  ok?: boolean;
  /** Ruta absoluta en el workspace. */
  path: string;
  /** Ruta relativa al workspace (la que se menciona en el prompt). */
  relative: string;
  name: string;
  size: number;
}

/** Progreso de una subtarea (subagente) — `SubagentProgress` serializado. */
export interface SubagentTask {
  index: number;
  task: string;
  /** running | done | error … (valor del enum del engine). */
  status?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  done?: boolean;
}

/** Adjunto pendiente (materializado por el sidecar). */
export interface Attachment {
  path: string;
  name: string;
  /** image | audio | video | document | file */
  kind: string;
}

/** Estado del dictado por voz del sidecar (motor STT del engine). */
export interface SttStatus {
  supported: boolean;
  listening: boolean;
  language: string | null;
  /** Códigos de idioma admitidos por el motor. */
  languages: string[];
  /** Motivo accionable cuando `supported` es false. */
  reason?: string | null;
}

/** Resultado de `stt.start`. */
export interface SttStartResult {
  ok: boolean;
  supported: boolean;
  language?: string;
  reason?: string | null;
}

/** Entrada del explorador de archivos. */
export interface FsEntry {
  name: string;
  dir: boolean;
  hidden?: boolean;
  size?: number | null;
  mtime?: number | null;
}

export interface FsListResult {
  path: string;
  /** Directorio padre, o null si es la raíz. */
  parent: string | null;
  entries: FsEntry[];
  truncated?: boolean;
}

export interface FsReadResult {
  path: string;
  binary: boolean;
  text: string;
  size: number;
  truncated?: boolean;
}

/** Servidor MCP (los valores de `env` nunca salen del sidecar). */
export interface McpServer {
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  envKeys: string[];
}

export interface McpState {
  enabled: boolean;
  configPath: string;
  /** El paquete `mcp` está instalado en el entorno del engine. */
  sdkAvailable: boolean;
  servers: McpServer[];
}

/** Patch de campos seguros que `config.set` persiste. */export interface ConfigPatch {
  provider?: string;
  model?: string;
  subagentModel?: string;
  reasoning_effort?: string | null;
  safe_mode?: boolean;
  theme?: string;
  notify_on_completion?: boolean;
}
