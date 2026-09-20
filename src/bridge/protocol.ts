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
  defaultSessionId: string;
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
}

/** Patch de campos seguros que `config.set` persiste. */
export interface ConfigPatch {
  provider?: string;
  model?: string;
  subagentModel?: string;
  reasoning_effort?: string | null;
  safe_mode?: boolean;
  theme?: string;
  notify_on_completion?: boolean;
}
