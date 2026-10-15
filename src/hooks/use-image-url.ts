import { useEffect, useRef, useState } from "react";

import { phoson } from "@/bridge/client";
import i18n from "@/lib/i18n";
import { isInlineSource } from "@/lib/files";

/**
 * Carga una imagen local como data URL para previsualizarla en la webview.
 *
 * La webview no puede abrir rutas del sistema (`file://` no está permitido), así
 * que el sidecar devuelve el contenido en base64 (`fs.readImage`). El resultado
 * se cachea en memoria: la misma imagen suele pedirse varias veces (miniatura,
 * ampliación, re-render del transcript) y cada lectura cuesta una RPC.
 *
 * Los `source` que la webview pinta sola (data URLs, `blob:` y URLs http) no
 * pasan por el sidecar ni por la caché: se devuelven tal cual.
 */

/** path → data URL, en orden de uso: el primero es el más antiguo (LRU). */
const cache = new Map<string, string>();
/** Lecturas en vuelo: dos tiles de la misma ruta comparten una sola RPC. */
const inflight = new Map<string, Promise<string>>();
/** Rutas que ya fallaron (p. ej. borradas): no se reintenta en cada montaje. */
const failures = new Map<string, string>();
/** Bytes de imagen retenidos (el base64 ocupa 4/3 de su tamaño real). */
let cachedBytes = 0;

/**
 * Presupuesto de la caché. El sidecar admite hasta 12 MB por lectura, así que
 * una imagen grande también se cachea —abrir su zoom no debe releer el archivo—
 * y el límite desaloja las entradas más antiguas, nunca la recién leída.
 */
const MAX_CACHE_BYTES = 48 * 1024 * 1024;
/** Rutas fallidas que se recuerdan antes de olvidar las más viejas. */
const MAX_FAILURES = 64;
/** Recorte del mensaje de error que consume la UI. */
const MAX_ERROR_CHARS = 160;

/** Bytes de imagen de un data URL (aproximados: base64 = 4/3 del original). */
const bytesOf = (dataUrl: string): number => {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
  return Math.ceil((payload * 3) / 4);
};

/** Mensaje corto y sin prefijo técnico, para pintarlo junto a la miniatura. */
function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Texto de UI (lo pinta la miniatura), así que sale del catálogo; el resto del
  // mensaje del sidecar se deja tal cual porque ya es el detalle del fallo.
  const clean = raw.replace(/^Error:\s*/, "").trim() || i18n.t("system:images.readFailed");
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean;
}

/** Guarda la data URL reordenando por uso (LRU) y respetando el presupuesto. */
function remember(path: string, url: string): void {
  const previous = cache.get(path);
  if (previous !== undefined) {
    cachedBytes -= bytesOf(previous);
    cache.delete(path); // delete + set: la entrada pasa al final (la más reciente).
  }
  cache.set(path, url);
  cachedBytes += bytesOf(url);
  while (cachedBytes > MAX_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    cachedBytes -= evicted === undefined ? 0 : bytesOf(evicted);
  }
}

/** Recuerda un fallo (ruta inexistente, tipo no legible) para no reintentarlo. */
function rememberFailure(path: string, message: string): void {
  if (failures.size >= MAX_FAILURES) {
    const oldest = failures.keys().next();
    if (!oldest.done) failures.delete(oldest.value);
  }
  failures.set(path, message);
}

/**
 * Lee una ruta local, o reutiliza lo cacheado. Las peticiones simultáneas de la
 * misma ruta comparten la promesa: una sola RPC para las dos miniaturas.
 */
function readImage(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit !== undefined) return Promise.resolve(hit);
  const running = inflight.get(path);
  if (running !== undefined) return running;
  const pending = phoson
    .fsReadImage(path)
    .then((r) => {
      const url = `data:${r.mediaType};base64,${r.base64}`;
      remember(path, url);
      failures.delete(path);
      return url;
    })
    .catch((error: unknown) => {
      const message = messageOf(error);
      rememberFailure(path, message);
      throw new Error(message);
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, pending);
  return pending;
}

export interface ImageState {
  /** Data URL lista para `<img src>`, o `null` mientras carga / si falla. */
  url: string | null;
  error: string | null;
  loading: boolean;
  /**
   * La lectura está **pospuesta** (`enabled: false`): ni hay imagen todavía ni
   * nada ha fallado, así que la UI no debe pintar spinner ni error.
   */
  deferred: boolean;
}

const IDLE: ImageState = { url: null, error: null, loading: false, deferred: false };
const DEFERRED: ImageState = { url: null, error: null, loading: false, deferred: true };
const WAITING: ImageState = { url: null, error: null, loading: true, deferred: false };

const ready = (url: string): ImageState => ({
  url,
  error: null,
  loading: false,
  deferred: false,
});

/** Estado de arranque: lo que ya se sabe sin llamar al sidecar. */
function initialState(path: string | null | undefined, enabled: boolean): ImageState {
  if (!path) return IDLE;
  if (!enabled) return DEFERRED;
  if (isInlineSource(path)) return ready(path);
  const hit = cache.get(path);
  if (hit !== undefined) return ready(hit);
  const failure = failures.get(path);
  if (failure !== undefined) return { url: null, error: failure, loading: false, deferred: false };
  return WAITING;
}

/**
 * `enabled: false` pospone la lectura (la miniatura aún no está en pantalla):
 * un transcript con muchas imágenes no dispara una RPC por cada una al abrir la
 * sesión, solo por las que se ven.
 */
export function useImageUrl(path: string | null | undefined, enabled = true): ImageState {
  const [state, setState] = useState<ImageState>(() => initialState(path, enabled));

  useEffect(() => {
    if (!path) {
      setState(IDLE);
      return;
    }
    if (!enabled) {
      setState(DEFERRED);
      return;
    }
    if (isInlineSource(path)) {
      setState(ready(path));
      return;
    }
    const hit = cache.get(path);
    if (hit !== undefined) {
      setState(ready(hit));
      return;
    }
    const failure = failures.get(path);
    if (failure !== undefined) {
      setState({ url: null, error: failure, loading: false, deferred: false });
      return;
    }
    let cancelled = false;
    setState(WAITING);
    readImage(path)
      .then((url) => {
        if (!cancelled) setState(ready(url));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ url: null, error: messageOf(error), loading: false, deferred: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  return state;
}

/**
 * Marca un elemento como "en pantalla" (una sola vez) para cargar su imagen de
 * forma perezosa. Si el navegador no soporta `IntersectionObserver`, carga ya.
 */
export function useOnScreen<T extends HTMLElement>(rootMargin = "300px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, rootMargin]);

  return { ref, seen };
}
