/**
 * Instrumentación de rendimiento, deliberadamente **ligera**.
 *
 * Objetivo (alpha): medir **arranque**, **tiempo de cada acción** (RPC) y
 * servir de base para el consumo. No envía nada a ningún sitio: todo se queda
 * en memoria y se puede volcar desde la consola con:
 *
 *     phosonPerf.summary()   // tabla agregada
 *     phosonPerf.slowest()   // las N más lentas
 *     phosonPerf.snapshot()  // crudo
 *     phosonPerf.reset()
 *
 * `performance.now()` es relativo al *time origin* (≈ inicio de navegación), así
 * que `now()` ya es "ms desde que arrancó la webview".
 */

type Sample = { name: string; ms: number; at: number };

const MAX_SAMPLES = 800;

const samples: Sample[] = [];
const marks = new Map<string, number>();

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Registra un instante con nombre (para medir desde él con `since`). */
export function mark(name: string): number {
  const t = now();
  marks.set(name, t);
  return t;
}

/** ms transcurridos desde un `mark` (o `null` si no existe). */
export function since(name: string): number | null {
  const start = marks.get(name);
  return start === undefined ? null : now() - start;
}

/** ms desde el arranque de la webview. */
export function uptime(): number {
  return now();
}

/** Guarda una muestra con nombre. */
export function record(name: string, ms: number): void {
  samples.push({ name, ms, at: Date.now() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

/** Cronómetro manual: llama al `stop()` que devuelve. */
export function startTimer(name: string): () => number {
  const start = now();
  return () => {
    const ms = now() - start;
    record(name, ms);
    return ms;
  };
}

/** Mide una promesa y registra su duración. */
export async function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const stop = startTimer(name);
  try {
    return await fn();
  } finally {
    stop();
  }
}

export interface PerfRow {
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  totalMs: number;
}

/** Tabla agregada por nombre, ordenada por tiempo total. */
export function summary(): PerfRow[] {
  const byName = new Map<string, number[]>();
  for (const s of samples) {
    const list = byName.get(s.name) ?? [];
    list.push(s.ms);
    byName.set(s.name, list);
  }
  return [...byName.entries()]
    .map(([name, list]) => ({
      name,
      count: list.length,
      avgMs: round(list.reduce((a, b) => a + b, 0) / list.length),
      maxMs: round(Math.max(...list)),
      lastMs: round(list[list.length - 1]),
      totalMs: round(list.reduce((a, b) => a + b, 0)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

/** Las N muestras individuales más lentas. */
export function slowest(limit = 20): Sample[] {
  return [...samples].sort((a, b) => b.ms - a.ms).slice(0, limit);
}

export function snapshot() {
  return {
    marks: Object.fromEntries(marks),
    samples: [...samples],
    uptimeMs: round(now()),
  };
}

export function reset(): void {
  samples.length = 0;
  marks.clear();
}

const round = (n: number): number => Math.round(n * 10) / 10;

// Acceso desde la consola del webview (DevTools) o desde tests.
declare global {
  interface Window {
    phosonPerf?: {
      summary: typeof summary;
      slowest: typeof slowest;
      snapshot: typeof snapshot;
      reset: typeof reset;
      marks: () => Record<string, number>;
    };
  }
}

if (typeof window !== "undefined") {
  window.phosonPerf = {
    summary,
    slowest,
    snapshot,
    reset,
    marks: () => Object.fromEntries(marks),
  };
}
