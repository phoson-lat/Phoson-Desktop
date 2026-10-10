/**
 * Registro de **acciones** (telemetría local) para analizar la calidad de la app.
 *
 * Qué captura:
 *  - Eventos explícitos de la app (`logAction`) — turnos, sesiones, ajustes…
 *  - Cada RPC al sidecar (método, duración, ok/error) desde `bridge/client.ts`.
 *  - **Interacción del usuario** (clicks y teclas) vía listeners en captura.
 *  - Errores globales (`window.onerror`, promesas rechazadas).
 *
 * Dónde va: un buffer en memoria (para DevTools) + volcado **JSONL rotativo a
 * disco** vía el comando Rust `log_append` (ver `src-tauri/src/logging.rs`).
 * Fuera de Tauri (modo demo en navegador) solo se queda en memoria y consola.
 *
 * API desde la consola:
 *     phosonLog.tail()        // últimos N eventos
 *     phosonLog.summary()     // conteo por evento
 *     phosonLog.flush()       // fuerza el volcado a disco
 *     phosonLog.path()        // ruta del archivo de log
 *     phosonLog.openFolder()  // abre la carpeta de logs
 *     phosonLog.download()    // descarga el JSONL (útil en modo navegador)
 *     phosonLog.clear()       // vacía memoria y disco-lote pendiente
 */

import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Origen del evento: ayuda a filtrar el ruido al analizar. */
export type LogSource = "app" | "ui" | "dom" | "rpc" | "engine" | "error";

export interface LogEvent {
  /** Epoch ms (ordenable). */
  ts: number;
  /** ISO 8601 (legible). */
  iso: string;
  level: LogLevel;
  src: LogSource;
  /** Nombre corto y estable del evento, p. ej. `turn.send`, `rpc`. */
  event: string;
  /** ms desde el arranque de la webview. */
  up: number;
  /** Sesión activa en el momento del evento (si se conoce). */
  session?: string | null;
  /** Workspace/sesión de trabajo (si se conoce). */
  workspace?: string | null;
  data?: Record<string, unknown>;
}

/** Contexto global que se adjunta a cada evento. */
const context: {
  session: string | null;
  workspace: string | null;
  version: string;
  platform: string;
} = {
  session: null,
  workspace: null,
  version: "unknown",
  platform: typeof navigator !== "undefined" ? navigator.platform || "web" : "web",
};

const MAX_MEMORY = 2000; // eventos retenidos en memoria para DevTools
const FLUSH_INTERVAL_MS = 1500;
const MAX_BATCH = 40;
const TRUNC = 240;

let started = false;
let flushing = false;

const memory: LogEvent[] = [];
/** Líneas JSONL pendientes de escribir a disco. */
let pending: string[] = [];

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Recorta texto largo y evita claves sensibles obvias. */
export function trunc(value: unknown, max = TRUNC): unknown {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}…(+${value.length - max})` : value;
  }
  return value;
}

/** Saneo superficial de un objeto (recursivo, con límite de profundidad). */
function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return trunc(value);
  if (typeof value !== "object") return value;
  if (depth >= 3) return "[…]";
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((v) => sanitize(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

/** Actualiza el contexto adjunto a los eventos (sesión/workspace/versión). */
export function setLogContext(patch: Partial<typeof context>): void {
  Object.assign(context, patch);
}

/** Emite un evento de log. Es la única función que escribe al buffer. */
export function logEvent(
  event: string,
  data?: Record<string, unknown>,
  level: LogLevel = "info",
  src: LogSource = "app",
): void {
  if (typeof window === "undefined") return;
  const ev: LogEvent = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    level,
    src,
    event,
    up: Math.round(now()),
    session: context.session,
    workspace: context.workspace,
    ...(data ? { data: sanitize(data) as Record<string, unknown> } : {}),
  };

  memory.push(ev);
  if (memory.length > MAX_MEMORY) memory.splice(0, memory.length - MAX_MEMORY);

  pending.push(JSON.stringify(ev));

  // Errores: se reflejan en consola y se vuelcan cuanto antes.
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.warn(`[phoson:${src}] ${event}`, data ?? "");
    void flush();
    return;
  }
  scheduleFlush();
}

/** Atajo para acciones de la app. */
export const logAction = (event: string, data?: Record<string, unknown>): void =>
  logEvent(event, data, "info", "app");

/** Atajo para errores. */
export const logError = (
  event: string,
  error: unknown,
  data?: Record<string, unknown>,
): void =>
  logEvent(
    event,
    { ...data, error: error instanceof Error ? error.message : String(error) },
    "error",
    "error",
  );

function scheduleFlush(): void {
  if (pending.length >= MAX_BATCH) {
    void flush();
    return;
  }
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/** Vuelca el lote pendiente al archivo de log (o lo deja en memoria si no hay Tauri). */
export async function flush(): Promise<void> {
  if (flushing || pending.length === 0) return;
  if (!isTauri()) {
    // Sin backend nativo (modo navegador) no hay disco: el buffer en memoria
    // es el único destino. Se vacía para no crecer sin límite.
    pending = [];
    return;
  }
  flushing = true;
  const batch = pending;
  pending = [];
  try {
    await invoke("log_append", { lines: batch });
  } catch (e) {
    // No reencolamos para no crecer sin límite si el comando no existe aún.
    // eslint-disable-next-line no-console
    console.warn("[phoson:log] no se pudo volcar a disco", e);
  } finally {
    flushing = false;
  }
}

/* ── Captura automática de interacción ─────────────────────────────────── */

/** Describe un elemento de forma compacta y estable para el log. */
function describe(el: Element | null): string | undefined {
  if (!el) return undefined;
  const html = el as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof html.className === "string" && html.className
      ? `.${html.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  const aria = el.getAttribute("aria-label");
  const role = el.getAttribute("role");
  const text = trunc((el.textContent ?? "").trim(), 60);
  return [
    `${tag}${id}${cls}`,
    role ? `role=${role}` : "",
    aria ? `aria=${aria}` : "",
    text && tag !== "input" ? `“${String(text)}”` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function onClickCapture(e: MouseEvent): void {
  const target = e.target as Element | null;
  const el = target?.closest?.(
    "button,a,[role=button],[data-log],input,label,li,[role=tab]",
  ) as Element | null;
  logEvent(
    "ui.click",
    {
      el: describe(el ?? target),
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
    },
    "debug",
    "dom",
  );
}

function onKeyCapture(e: KeyboardEvent): void {
  // No registrar la pulsación de modificadores solos (ruido).
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
  const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "meta"]
    .filter(Boolean)
    .join("+");
  logEvent(
    "ui.key",
    { key: e.key, code: e.code, mods: mods || undefined, el: describe(e.target as Element) },
    "debug",
    "dom",
  );
}

/** Valor de un input al perder el foco o cambiar (texto truncado). */
function onChangeCapture(e: Event): void {
  const el = e.target as HTMLInputElement | null;
  if (!el || el.type === "password") return;
  logEvent(
    "ui.change",
    { el: describe(el), value: trunc(String(el.value ?? ""), 120) },
    "debug",
    "dom",
  );
}

/* ── Errores globales ──────────────────────────────────────────────────── */

function installErrorHandlers(): void {
  window.addEventListener("error", (e) => {
    logEvent(
      "error.window",
      {
        message: e.message,
        source: trunc(`${e.filename}:${e.lineno}:${e.colno}`, 160),
      },
      "error",
      "error",
    );
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    logEvent(
      "error.unhandled-rejection",
      { reason: trunc(reason instanceof Error ? reason.message : String(reason)), stack: undefined },
      "error",
      "error",
    );
  });
}

/* ── Arranque ──────────────────────────────────────────────────────────── */

/**
 * Instala la instrumentación. Idempotente; llámalo lo antes posible (en
 * `main.tsx`) para no perder eventos de arranque.
 */
export function installLogger(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  installErrorHandlers();

  // Captura en fase de captura para no perder clicks que detienen la propagación.
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeyCapture, true);
  document.addEventListener("change", onChangeCapture, true);

  // Volcado periódico y al cerrar/ocultar la app.
  intervalTimer = setInterval(() => {
    if (pending.length) void flush();
  }, FLUSH_INTERVAL_MS);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("beforeunload", () => void flush());

  // Contexto de arranque (versión real del shell nativo, si está disponible).
  if (isTauri()) {
    void invoke<{ version?: string }>("app_info")
      .then((info) => setLogContext({ version: info?.version ?? "unknown" }))
      .catch(() => {});
    void invoke("log_path")
      .then((p) => console.info(`[phoson:log] archivo de log: ${p}`))
      .catch(() => {});
  }

  logEvent(
    "app.start",
    {
      href: trunc(String(location.href), 160),
      tauri: isTauri(),
      userAgent: trunc(navigator.userAgent, 200),
    },
    "info",
    "app",
  );
}

/* ── API de consola / tests ────────────────────────────────────────────── */

export function tail(limit = 50): LogEvent[] {
  return memory.slice(-limit);
}

export function all(): LogEvent[] {
  return [...memory];
}

/** Conteo por evento (para un vistazo rápido de uso). */
export function summary(): Array<{ event: string; count: number; errors: number }> {
  const byEvent = new Map<string, { count: number; errors: number }>();
  for (const e of memory) {
    const row = byEvent.get(e.event) ?? { count: 0, errors: 0 };
    row.count += 1;
    if (e.level === "error") row.errors += 1;
    byEvent.set(e.event, row);
  }
  return [...byEvent.entries()]
    .map(([event, row]) => ({ event, ...row }))
    .sort((a, b) => b.count - a.count);
}

export async function logPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("log_path");
  } catch {
    return null;
  }
}

export async function openLogFolder(): Promise<void> {
  if (!isTauri()) return;
  await invoke("log_open_dir").catch(() => {});
}

/** Descarga el buffer en memoria como JSONL (útil en modo navegador). */
export function download(): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([memory.map((e) => JSON.stringify(e)).join("\n")], {
    type: "application/x-ndjson",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phoson-log-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clear(): void {
  memory.length = 0;
  pending = [];
}

/** Detiene timers/captura (tests). No se usa en la app real. */
export function uninstallLogger(): void {
  if (!started) return;
  started = false;
  if (flushTimer != null) clearTimeout(flushTimer);
  if (intervalTimer != null) clearInterval(intervalTimer);
  flushTimer = null;
  intervalTimer = null;
  document.removeEventListener("click", onClickCapture, true);
  document.removeEventListener("keydown", onKeyCapture, true);
  document.removeEventListener("change", onChangeCapture, true);
}

declare global {
  interface Window {
    phosonLog?: {
      tail: typeof tail;
      all: typeof all;
      summary: typeof summary;
      flush: typeof flush;
      path: typeof logPath;
      openFolder: typeof openLogFolder;
      download: typeof download;
      clear: typeof clear;
      event: typeof logEvent;
    };
  }
}

if (typeof window !== "undefined") {
  window.phosonLog = {
    tail,
    all,
    summary,
    flush,
    path: logPath,
    openFolder: openLogFolder,
    download,
    clear,
    event: logEvent,
  };
}
