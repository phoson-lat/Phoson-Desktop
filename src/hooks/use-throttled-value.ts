import { useEffect, useRef, useState } from "react";

/**
 * Limita la frecuencia con la que un valor que cambia muy rápido llega al
 * render (throttle con arrastre del último valor).
 *
 * Pensado para el streaming: el store vuelca el buffer cada ~32 ms y cada volcado
 * re-parseaba el markdown completo del bloque en curso (remark + rehype + KaTeX).
 * Con `enabled` el valor se refresca como mucho cada `ms`; al desactivarse se
 * muestra el valor exacto y se cancelan los temporizadores, así que el resultado
 * final nunca se queda a medias.
 */
export function useThrottledValue<T>(value: T, enabled: boolean, ms = 140): T {
  const [shown, setShown] = useState(value);
  /** Último valor recibido (puede ir por delante de `shown`). */
  const latest = useRef(value);
  const scheduled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  latest.current = value;

  useEffect(() => {
    if (!enabled) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      scheduled.current = false;
      setShown(value);
      return;
    }
    if (scheduled.current) return; // ya hay un volcado pendiente
    setShown(value);
    scheduled.current = true;
    timer.current = setTimeout(() => {
      timer.current = null;
      scheduled.current = false;
      setShown(latest.current);
    }, ms);
  }, [value, enabled, ms]);

  // Al desmontar (p. ej. el mensaje deja de ser el último), sin timers vivos.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return enabled ? shown : value;
}