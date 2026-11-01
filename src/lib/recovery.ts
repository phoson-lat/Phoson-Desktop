/** Utilidades puras para recuperar sesiones tras perder un sidecar. */

interface BackoffOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Inyectable en tests; en la app usa el temporizador del WebView. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta una operación con esperas exponenciales (0.5 s, 1 s, 2 s…).
 * No reintenta dentro de la operación: cada intento debe ser una RPC nueva para
 * que Rust pueda crear un sidecar si el anterior terminó.
 */
export async function withBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  { attempts = 4, baseDelayMs = 500, sleep = defaultSleep }: BackoffOptions = {},
): Promise<T> {
  if (attempts < 1) throw new Error("attempts must be at least 1");
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Reasigna claves sin mutar el objeto (borradores que sobreviven al rehidratado). */
export function remapRecordKeys<T>(
  record: Record<string, T>,
  mapping: Record<string, string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [mapping[key] ?? key, value]),
  );
}
