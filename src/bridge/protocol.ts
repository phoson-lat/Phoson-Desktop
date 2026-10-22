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
  /**
   * Qué pide la interacción: `bash` (confirmación de comando) · `questions`
   * (tool `questions` del plugin, 1–4 preguntas de opción múltiple) ·
   * `select`/`form` (fallback de los primitivos del `PluginUiService`).
   */
  kind: "bash" | "questions" | "select" | "form";
  /** kind `bash`. */
  command?: string;
  actions?: Array<"yes" | "always" | "no">;
  /** kinds `questions` | `select` | `form`. */
  title?: string;
  message?: string;
  questions?: Question[];
  choices?: Choice[];
  fields?: FormField[];
}

/** Opción de una pregunta (`QuestionOption` del engine serializada). */
export interface QuestionOption {
  id: string;
  label: string;
  description?: string | null;
}

/** Pregunta de opción múltiple (`Question` del engine serializada). */
export interface Question {
  id: string;
  header: string;
  question: string;
  options: QuestionOption[];
  /** true = se puede elegir más de una opción. */
  multi_select?: boolean;
  /** true = se ofrece respuesta libre ("Otro"). */
  allow_other?: boolean;
}

/** Elección de un `select` (`Choice` del engine serializada). */
export interface Choice {
  id: string;
  label: string;
  detail?: string | null;
}

/** Campo de un `form` (`FormField` del engine serializado). */
export interface FormField {
  id: string;
  label: string;
  kind?: "text" | "password" | "integer";
  required?: boolean;
  default?: string | null;
  help?: string | null;
}

/** Item de un `TodoListBlock` de plugin (`TodoItem` del engine serializado). */
export interface PluginTodoItem {
  id: string;
  title: string;
  completed?: boolean;
  detail?: string | null;
}

/**
 * Bloque de UI publicado por un plugin (`UiBlock` del engine serializado, con
 * `type` = nombre de la dataclass). La UI los pinta como bloque nativo y se
 * actualizan en sitio (`replace`) o desaparecen (`plugin.block.remove`).
 */
export type PluginBlock =
  | { type: "NoticeBlock"; id: string; kind: "info" | "warn" | "error"; message: string }
  | { type: "KeyValueBlock"; id: string; title: string; items: Array<[string, string]> }
  | { type: "TodoListBlock"; id: string; title: string; items: PluginTodoItem[] }
  | {
      type: "ProgressBlock";
      id: string;
      label: string;
      completed?: number | null;
      total?: number | null;
      detail?: string | null;
    };

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
  tools: ToolCatalog;
  commands: Array<{ names: string[]; help: string }>;
  /** Presente cuando el sidecar sabe si hay proveedor configurado. */
  onboarding?: {
    needed: boolean;
    providers: ProviderStatus[];
    /** false = no existe ~/.phoson/config.toml: el onboarding es forzoso. */
    configExists?: boolean;
  };
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
  /**
   * Proveedor de suscripción (OAuth, sin API key): el login vive en
   * `~/.phoson/auth*.json`, no en config.toml.
   */
  auth?: boolean;
  loggedIn?: boolean;
  /** Cuenta del login OAuth (email), si el proveedor la expone. */
  account?: string | null;
  /** Plan de la suscripción (p.ej. Plus), si el proveedor lo expone. */
  plan?: string | null;
  expiresAt?: number | null;
}

export interface AuthProviderStatus {
  provider: string;
  loggedIn: boolean;
  email?: string | null;
  plan?: string | null;
  expiresAt?: number | null;
  error?: string;
}

export interface AuthStatusResult {
  providers: AuthProviderStatus[];
}

export interface AuthLoginResult {
  ok: boolean;
  provider: string;
  status: AuthProviderStatus;
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
  /** Nombres en inglés de cada idioma (es → "Spanish"), para Ajustes. */
  languageNames?: Record<string, string>;
  /** Arquitecturas de modelo aceptadas (opciones del selector de Ajustes). */
  arches?: string[];
  /**
   * Idioma fijado en config.toml/PHOSON_STT_LANGUAGE (Ajustes): con uno
   * fijado, el compositor no manda el suyo. `null` = sigue al de la interfaz.
   */
  configuredLanguage?: string | null;
  /** Dónde salió el idioma/modelo configurado (config.toml o variable de entorno). */
  languageSource?: string | null;
  archSource?: string | null;
  /**
   * Arquitectura del modelo de Moonshine (entero de la librería); `null` = la
   * de la librería para el idioma. Viene de `config.toml`/`PHOSON_STT_MODEL_ARCH`.
   */
  modelArch?: number | null;
  /** Nombre legible del modelo (`medium_streaming`); `null` si es el default. */
  modelName?: string | null;
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

/** Resultado de `stt.config.set` (idioma/modelo del dictado, desde Ajustes). */
export interface SttConfigSetResult {
  ok: boolean;
  /** Ruta del config.toml persistido (cuando `ok`). */
  path?: string;
  /** Estado nuevo del dictado (cuando `ok`). */
  status?: SttStatus;
  /** Motivo accionable cuando `ok` es false (valor rechazado, plugin ausente…). */
  reason?: string | null;
}

/** Resultado de `stt.download` (pre-descarga del modelo desde Ajustes). */
export interface SttDownloadResult {
  ok: boolean;
  /** "downloaded" (hubo descarga) o "cached" (ya estaba en caché). */
  result?: "downloaded" | "cached";
  /** Idioma cuya descarga se comprobó. */
  language?: string;
  /** Motivo accionable cuando `ok` es false (sin runtime, red, idioma…). */
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

/** Entrada del catálogo de plugins del engine (`plugins.get`).
 *
 * `enabled` es el estado real (la lista de specs **o** el flag del builder) y
 * `locked` marca las entradas que Ajustes solo muestra: el dictado, los pares y
 * los flags que el motor lee del archivo/entorno pero no persiste al guardar.
 * `lockReason` es un **código** (`dictation` | `peerName` | `file:<campo>` |
 * `env:<VAR>`), no una frase: el texto lo pone la UI en su idioma.
 */
export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Mecanismo con el que se activa desde aquí: el flag del config o la lista. */
  mechanism: "flag" | "list";
  /** Campo del config (`enable_monitors`…); vacío si el plugin no tiene flag. */
  flag: string;
  /** La spec está en `[defaults].plugins` (activa por lista). */
  listed: boolean;
  /** Plugin del propio engine (`phoson_cli.labels`) y no de la comunidad. */
  official: boolean;
  locked: boolean;
  lockReason: string;
  /** Extra opcional que falta en el entorno (`asyncssh`, `redis`…); `""` si está. */
  missingExtra: string;
}

/** Resultado de `plugins.get`. */
export interface PluginsState {
  plugins: PluginEntry[];
  /** El sidecar puede instalar plugins (necesita intérprete real y `uv`). */
  canInstall: boolean;
  /** Motivo accionable cuando `canInstall` es false (`frozen` | `noUv`). */
  installBlocked: string;
  /**
   * El sidecar puede instalar **extras** del engine (las dependencias
   * opcionales de un plugin: `[stt]`, `[computeruse]`…): necesita un
   * intérprete con `pip`, no el `uv` del gestor de plugins.
   */
  canInstallExtras: boolean;
  /** Motivo accionable cuando `canInstallExtras` es false (`noPip`). */
  installExtrasBlocked: string;
  /** Ruta del config.toml que se escribe. */
  configPath: string;
}

/**
 * Catálogo de tools que ve el engine: los nombres visibles y cuántas quedaron
 * enmascaradas (si >0, la lista está recortada).
 */
export interface ToolCatalog {
  visible: string[];
  maskedCount: number;
}

/** Resultado de `plugins.set`: `{ok:true,…}` o el bloqueo con su motivo. */
export interface PluginsSetResult {
  ok: boolean;
  path?: string;
  /** Campos del config que se tocaron (para avisar al motor). */
  fields?: string[];
  /** `"locked"` cuando el estado lo fija otra fuente. */
  reason?: string;
  /** Código del bloqueo (mismos valores que `PluginEntry.lockReason`). */
  detail?: string;
  /** Catálogo ya actualizado (cuando `ok`). */
  plugins?: PluginEntry[];
  /**
   * Catálogo de tools tras recargar los engines (cuando `ok` y la sesión ya
   * estaba construida). El sidecar reconstruye *todas* las sesiones vivas, así
   * que esto es lo que hay que mostrar en los selectores de tools.
   */
  tools?: ToolCatalog;
}

/** Resultado de `plugins.install`. */
export interface PluginsInstallResult {
  ok: boolean;
  /** Nombre del entry point instalado (cuando `ok`). */
  name?: string;
  /** `"frozen"` | `"noUv"` cuando el sidecar no puede instalar. */
  reason?: string;
  plugins?: PluginEntry[];
  /** Catálogo de tools tras recargar los engines (mismo contrato que `set`). */
  tools?: ToolCatalog;
}

/** Resultado de `plugins.installExtra` (instalar una dependencia opcional). */
export interface PluginsInstallExtraResult {
  ok: boolean;
  /** Extra instalado (`stt`, `computeruse`…). */
  extra?: string;
  /** Carpeta donde se instaló (`~/.phoson/extras/<extra>`). */
  dir?: string;
  /** Requisitos instalados (los pines del engine). */
  installed?: string[];
  /** Salida del instalador (para diagnóstico). */
  output?: string;
  /**
   * Motivo del fallo: `noPip` (no hay intérprete con `pip`), `unknownExtra`,
   * `installFailed`, `timeout` o `notImportable`.
   */
  reason?: string;
  /** Detalle del fallo (salida del instalador). */
  error?: string;
  plugins?: PluginEntry[];
  /** Catálogo de tools tras recargar los engines (mismo contrato que `set`). */
  tools?: ToolCatalog;
}

/** Patch de campos seguros que `config.set` persiste. */
export interface ConfigPatch {
  provider?: string;
  model?: string;
  subagentModel?: string;
  reasoning_effort?: string | null;
  safe_mode?: boolean;
  theme?: string;
  /** `"off" | "bell" | "desktop"` (string, como lo guarda el engine). */
  notify_on_completion?: string;
}
