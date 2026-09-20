import { useCallback, useEffect, useRef, useState } from "react";

import { phoson } from "@/bridge/client";

/** Subconjunto de la Web Speech API que usamos. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

const getCtor = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

interface VoiceInputOptions {
  /** `final: false` → texto provisional (interino). */
  onText: (text: string, final: boolean) => void;
  /** Sesión activa: el dictado del sidecar enruta sus notificaciones por ella. */
  sessionId?: string | null;
}

/**
 * Dictado por voz con dos motores, elegidos por disponibilidad:
 *
 *  1. **Web Speech API** cuando existe (Chromium/WebView2).
 *  2. **Motor STT del engine** vía el sidecar cuando no (WebKitGTK en Linux,
 *     WKWebView en macOS, donde la Web Speech API no está implementada). El
 *     sidecar captura el micrófono en el host y reemite interino/final con el
 *     mismo contrato, así que la UI es idéntica.
 *
 * Mientras se sondea el motor del sidecar, `supported` es false y el botón se
 * deshabilita; al resolverse, se habilita o se explica el motivo en `error`.
 */
export function useVoiceInput({ onText, sessionId }: VoiceInputOptions) {
  const webCtor = useRef<(new () => SpeechRecognitionLike) | null>(getCtor());
  /** null = sondeando el motor del sidecar. */
  const [engineSupported, setEngineSupported] = useState<boolean | null>(
    webCtor.current ? true : null,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** Baja de la suscripción a las notificaciones `stt.*` del sidecar. */
  const unsubRef = useRef<(() => void) | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  const supported = webCtor.current !== null || engineSupported === true;

  // Sondea el motor del sidecar solo si falta la Web Speech API.
  useEffect(() => {
    if (webCtor.current || !sessionId) return;
    let cancelled = false;
    phoson
      .sttStatus()
      .then((status) => {
        if (cancelled) return;
        setEngineSupported(status.supported);
        if (!status.supported && status.reason) setError(status.reason);
      })
      .catch((e) => {
        if (!cancelled) setEngineSupported(false);
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ── Web Speech API ─────────────────────────────────────────────────────
  const stopWeb = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const startWeb = useCallback((Ctor: new () => SpeechRecognitionLike) => {
    const rec = new Ctor();
    rec.lang = typeof navigator !== "undefined" ? navigator.language || "es-ES" : "es-ES";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (final) textRef.current(final, true);
      else if (interim) textRef.current(interim, false);
    };
    rec.onerror = (event) => {
      const code = event?.error ?? "error";
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Permiso de micrófono denegado"
          : code === "no-speech"
            ? "No se detectó voz"
            : `Dictado: ${code}`,
      );
      setListening(false);
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ── Motor STT del sidecar ──────────────────────────────────────────────
  const startEngine = useCallback(async () => {
    if (!sessionId) return;
    detach();
    // Escucha interino/final del sidecar (mismo contrato que Web Speech).
    unsubRef.current = await phoson.onNotify((envelope) => {
      const params = envelope.params as { sessionId?: string; text?: string; final?: boolean; message?: string };
      if (params.sessionId !== sessionId) return;
      if (envelope.method === "stt.partial") {
        textRef.current(String(params.text ?? ""), Boolean(params.final));
      } else if (envelope.method === "stt.error") {
        setError(params.message ?? "Fallo de dictado");
        setListening(false);
        detach();
      } else if (envelope.method === "stt.done") {
        setListening(false);
        detach();
      }
    });
    const result = await phoson.sttStart(sessionId);
    if (!result.ok) {
      setError(result.reason ?? "No se pudo iniciar el dictado");
      detach();
      return;
    }
    setError(null);
    setListening(true);
  }, [sessionId]);

  const stopEngine = useCallback(async () => {
    detach();
    setListening(false);
    if (sessionId) {
      try {
        await phoson.sttStop(sessionId);
      } catch {
        /* el sidecar pudo haberse cerrado */
      }
    }
  }, [sessionId]);

  // ── API pública ────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (recRef.current) stopWeb();
    else void stopEngine();
  }, [stopWeb, stopEngine]);

  const start = useCallback(() => {
    const Ctor = webCtor.current;
    if (Ctor) {
      startWeb(Ctor);
      return;
    }
    if (!engineSupported) {
      setError("Este sistema no soporta dictado por voz");
      return;
    }
    void startEngine();
  }, [engineSupported, startWeb, startEngine]);

  useEffect(
    () => () => {
      recRef.current?.stop();
      detach();
    },
    [],
  );

  return {
    supported,
    listening,
    error,
    start,
    stop,
    toggle: () => (listening ? stop() : start()),
    clearError: () => setError(null),
  };
}
