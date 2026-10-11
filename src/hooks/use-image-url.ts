import { useEffect, useRef, useState } from "react";

import { phoson } from "@/bridge/client";

/**
 * Carga una imagen local como data URL para previsualizarla en la webview.
 *
 * La webview no puede abrir rutas del sistema (`file://` no está permitido), así
 * que el sidecar devuelve el contenido en base64 (`fs.readImage`). El resultado
 * se cachea en memoria: la misma imagen suele pedirse varias veces (miniatura y
 * ampliación, o al re-renderizar el transcript) y cada lectura cuesta una RPC.
 *
 * El cache está acotado: los data URLs grandes (> 3 MB) no se guardan y el
 * número de entradas se limita para no retener memoria de forma indefinida.
 */

const cache = new Map<string, string>();
const MAX_CACHED_ENTRIES = 24;
/** Longitud máxima (≈ bytes en base64) para que merezca la pena cachear. */
const MAX_CACHED_CHARS = 3 * 1024 * 1024;

function remember(path: string, url: string): void {
  if (url.length > MAX_CACHED_CHARS) return;
  cache.set(path, url);
  while (cache.size > MAX_CACHED_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export interface ImageState {
  /** Data URL lista para `<img src>`, o `null` mientras carga / si falla. */
  url: string | null;
  error: string | null;
  loading: boolean;
}

const IDLE: ImageState = { url: null, error: null, loading: false };
const WAITING: ImageState = { url: null, error: null, loading: true };

/**
 * `enabled: false` pospone la lectura (la miniatura aún no está en pantalla):
 * un transcript con muchas imágenes no dispara una RPC por cada una al abrir la
 * sesión, solo por las que se ven.
 */
export function useImageUrl(path: string | null | undefined, enabled = true): ImageState {
  const [state, setState] = useState<ImageState>(() => {
    if (!path || !enabled) return path ? WAITING : IDLE;
    const hit = cache.get(path);
    return hit ? { url: hit, error: null, loading: false } : WAITING;
  });

  useEffect(() => {
    if (!path) {
      setState(IDLE);
      return;
    }
    if (!enabled) {
      setState(WAITING);
      return;
    }
    const hit = cache.get(path);
    if (hit) {
      setState({ url: hit, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState(WAITING);
    phoson
      .fsReadImage(path)
      .then((r) => {
        const url = `data:${r.mediaType};base64,${r.base64}`;
        remember(path, url);
        if (!cancelled) setState({ url, error: null, loading: false });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({ url: null, error: String(e).replace(/^Error:\s*/, ""), loading: false });
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
