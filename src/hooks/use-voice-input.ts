import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Dictado por voz con la Web Speech API (Chromium/WebView2). En motores sin
 * soporte (p. ej. WebKitGTK) expone `supported: false` para que la UI lo avise.
 */
export function useVoiceInput({
  onText,
}: {
  /** `final: false` → texto provisional (interino). */
  onText: (text: string, final: boolean) => void;
}) {
  const [supported] = useState(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Este motor no soporta dictado por voz");
      return;
    }
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

  useEffect(() => () => recRef.current?.stop(), []);

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
