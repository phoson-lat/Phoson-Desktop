import { useCallback, useEffect, useRef, useState } from "react";

import { isTauri, phoson } from "@/bridge/client";
import type { SttStatus } from "@/bridge/protocol";
import i18n, { useLocale } from "@/lib/i18n";
import { speechLocale } from "@/lib/locale";

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
 * Idioma del dictado: el de la interfaz, si el motor lo admite.
 *
 * `preferred` es una etiqueta BCP-47 (normalmente `speechLocale(locale)`, que ya
 * respeta la variante de la webview: `es-MX` → `es`). Antes esto miraba
 * `navigator.language` por su cuenta, con lo que el dictado podía ir en un
 * idioma distinto al de la interfaz.
 *
 * `null` significa "que decida el sidecar" (su `config.toml` /
 * `PHOSON_STT_LANGUAGE`, o `es`): forzar un idioma que Moonshine no conoce es
 * peor que respetar el configurado.
 */
export const pickSttLanguage = (supported: string[], preferred?: string): string | null => {
  if (supported.length === 0) return null;
  const nav = (preferred || (typeof navigator === "undefined" ? "" : navigator.language) || "").toLowerCase();
  if (!nav) return null;
  const codes = supported.map((code) => [code, code.toLowerCase()] as const);
  const exact = codes.find(([, key]) => key === nav);
  if (exact) return exact[0];
  const base = nav.split("-")[0];
  const prefixed = codes.find(([, key]) => key === base || nav.startsWith(`${key}-`));
  return prefixed ? prefixed[0] : null;
};

/** Qué usa el sidecar para dictar, para mostrarlo en el botón. */
export interface VoiceEngine {
  language: string | null;
  /** Modelo de Moonshine en uso; `null` = el default de la librería. */
  model: string | null;
}

interface VoiceInputOptions {
  /** `final: false` → texto provisional (interino). */
  onText: (text: string, final: boolean) => void;
  /** Sesión activa: el dictado del sidecar enruta sus notificaciones por ella. */
  sessionId?: string | null;
}

/**
 * Dictado por voz con dos motores, elegidos por disponibilidad:
 *
 *  1. **Motor STT del engine** vía el sidecar (Moonshine, *on-device*): el
 *     **preferido** dentro de la app de escritorio. Captura el micrófono en el
 *     host y reemite interino/final con el mismo contrato que la Web Speech API,
 *     así que la UI es idéntica. Aplica también en WebKitGTK (Linux) y WKWebView
 *     (macOS), donde la Web Speech API no existe.
 *  2. **Web Speech API** como *fallback*: modo demo en navegador, o cuando el
 *     sidecar no la soporta.
 *
 * El orden importa: en WebView2 el constructor `webkitSpeechRecognition` **sí
 * está definido** —Chromium lo exporta— pero la captura falla al iniciar (Edge
 * no trae el servicio de voz de Google: `language not supported` /
 * `not-allowed`). Guiarse por su existencia elegía un motor roto y el modelo
 * local nunca llegaba a sonar; por eso se sondea el sidecar primero.
 *
 * Mientras se sondea el motor del sidecar, `supported` es false y el botón se
 * deshabilita un instante; al resolverse, se habilita o se explica el motivo en
 * `error`. `status` trae avisos transitorios del sidecar (p. ej. la descarga
 * inicial del modelo, con porcentaje: «Descargando… 42%»).
 */
export function useVoiceInput({ onText, sessionId }: VoiceInputOptions) {
  const webCtor = useRef<(new () => SpeechRecognitionLike) | null>(getCtor());
  /** null = sin sonda (o sondeando) el motor del sidecar. */
  const [engineSupported, setEngineSupported] = useState<boolean | null>(null);
  /** Motor/idioma elegidos por el sidecar (para el título del botón). */
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  /** Idioma que se mandará en `stt.start` (null = que decida el sidecar). */
  const languageRef = useRef<string | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Aviso transitorio del sidecar (descarga/carga del modelo). */
  const [status, setStatus] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** Baja de la suscripción a las notificaciones `stt.*` del sidecar. */
  const unsubRef = useRef<(() => void) | null>(null);
  /** Cancela la sonda del motor en vuelo (evita que una vieja pise la nueva). */
  const probeCancelRef = useRef<(() => void) | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;
  /**
   * Idioma de la interfaz. Va por ref (no por dependencia) para que cambiar de
   * idioma no vuelva a sondear el motor: basta con que el próximo dictado use
   * el idioma nuevo.
   */
  const [uiLocale] = useLocale();
  const localeRef = useRef(uiLocale);
  localeRef.current = uiLocale;

  const detach = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  /** El sidecar solo existe dentro de la app de escritorio. */
  const hasSidecar = isTauri() && Boolean(sessionId);
  /** Sondeando el motor del sidecar (un instante: `stt.status` está cacheado). */
  const checking = hasSidecar && engineSupported === null;
  const supported =
    !checking && (engineSupported === true || webCtor.current !== null);

  // Sondea el motor del sidecar SIEMPRE que exista: es el preferido. La
  // presencia de `webkitSpeechRecognition` no basta para elegir motor (en
  // WebView2 existe y falla), así que ya no se usa para saltarse la sonda.
  const probeEngine = useCallback(() => {
    // Si hay una sonda previa en vuelo (evento de Ajustes), se cancela para
    // que su respuesta tardía no pise el estado de la nueva.
    probeCancelRef.current?.();
    let cancelled = false;
    setEngineSupported(null);
    phoson
      .sttStatus()
      .then((probe: SttStatus) => {
        if (cancelled) return;
        setEngineSupported(probe.supported);
        // Un idioma fijado desde Ajustes (config.toml) gana al de la interfaz;
        // si no hay, el de la UI — o nada, si el motor no lo conoce, y decide
        // el sidecar (su config/default).
        const forced = probe.configuredLanguage ?? null;
        const language = forced ?? pickSttLanguage(probe.languages, speechLocale(localeRef.current));
        languageRef.current = language;
        setEngine({ language: language ?? probe.language ?? null, model: probe.modelName ?? null });
        if (probe.supported) setError(null);
        else if (probe.reason) setError(probe.reason);
      })
      .catch((e) => {
        if (cancelled) return;
        setEngineSupported(false);
        setError(String(e));
      });
    const cancel = () => {
      cancelled = true;
    };
    probeCancelRef.current = cancel;
    return cancel;
  }, []);

  useEffect(() => {
    if (!hasSidecar) return;
    return probeEngine();
  }, [hasSidecar, sessionId, probeEngine]);

  // Ajustes puede cambiar el idioma/modelo del dictado (`stt.config.set`): el
  // dialog lo anuncia por evento y aquí se re-sondea para que la próxima
  // captura (y el título del botón) reflejen lo nuevo sin recargar la vista.
  useEffect(() => {
    window.addEventListener("phoson:stt-config-changed", probeEngine);
    return () => window.removeEventListener("phoson:stt-config-changed", probeEngine);
  }, [probeEngine]);

  // ── Web Speech API ─────────────────────────────────────────────────────
  const stopWeb = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const startWeb = useCallback((Ctor: new () => SpeechRecognitionLike) => {
    const rec = new Ctor();
    rec.lang = speechLocale(localeRef.current);
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
      // Avisos que pinta el compositor (línea de aviso): se resuelven al fallar,
      // con el idioma activo entonces (`i18n.t`, no un hook: esto es un callback).
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? i18n.t("system:voice.micDenied")
          : code === "no-speech"
            ? i18n.t("system:voice.noSpeech")
            : i18n.t("system:voice.dictationError", { code }),
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
      const params = envelope.params as {
        sessionId?: string;
        text?: string;
        final?: boolean;
        message?: string;
        phase?: string;
        percent?: number;
      };
      if (params.sessionId !== sessionId) return;
      if (envelope.method === "stt.partial") {
        setStatus(null);
        textRef.current(String(params.text ?? ""), Boolean(params.final));
      } else if (envelope.method === "stt.progress") {
        // El texto lo elige el UI por `phase` (i18n); el `message` del sidecar
        // queda como fallback para engines que aún no manden `phase`.
        const phase = typeof params.phase === "string" ? params.phase : "";
        setStatus(
          phase === "loading"
            ? i18n.t("chat:composer.voice.loading")
            : phase === "downloading"
              ? i18n.t("chat:composer.voice.downloading", { percent: params.percent ?? 0 })
              : phase === "ready"
                ? i18n.t("chat:composer.voice.ready")
                : params.message ?? null,
        );
      } else if (envelope.method === "stt.error") {
        setError(params.message ?? i18n.t("system:voice.engineFailed"));
        setStatus(null);
        setListening(false);
        detach();
      } else if (envelope.method === "stt.done") {
        setListening(false);
        setStatus(null);
        detach();
      }
    });
    const result = await phoson.sttStart(sessionId, languageRef.current ?? undefined);
    if (!result.ok) {
      setError(result.reason ?? i18n.t("system:voice.startFailed"));
      setStatus(null);
      detach();
      return;
    }
    // El sidecar confirma el idioma que aceptó (el pedido, o el suyo si no mandamos).
    if (result.language) {
      setEngine((prev) => (prev ? { ...prev, language: result.language! } : prev));
    }
    setError(null);
    setListening(true);
  }, [sessionId]);

  const stopEngine = useCallback(async () => {
    detach();
    setListening(false);
    setStatus(null);
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
    // El motor del sidecar manda cuando está disponible: en WebView2 el ctor de
    // Web Speech existe pero la captura no funciona.
    if (engineSupported === true) {
      void startEngine();
      return;
    }
    if (webCtor.current) {
      startWeb(webCtor.current);
      return;
    }
    setError(
      // Mismo mensaje que el título del botón (`chat:composer.voice.*`): se
      // reutiliza la clave en vez de duplicar el texto en dos catálogos.
      checking
        ? i18n.t("chat:composer.voice.checking")
        : i18n.t("chat:composer.voice.unsupported"),
    );
  }, [engineSupported, checking, startWeb, startEngine]);

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
    status,
    checking,
    engine,
    start,
    stop,
    toggle: () => (listening ? stop() : start()),
    clearError: () => {
      setError(null);
      setStatus(null);
    },
  };
}
