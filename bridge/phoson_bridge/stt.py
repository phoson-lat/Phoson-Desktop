"""Dictado por voz (STT) del bridge, respaldado por ``phoson_plugin_stt``.

La Web Speech API depende del navegador del webview: WebView2 la expone pero falla
(falta el servicio de Google en Edge) y WebKitGTK/WKWebView no la implementa. El
motor principal es el STT del propio engine (Moonshine, *on-device*, multilingüe),
que reemite el transcript como notificaciones JSON-RPC. El micrófono lo captura el
host que ejecuta el sidecar — el mismo equipo que muestra la app.

Notificaciones:

- ``stt.partial`` ``{sessionId, text, final}`` — ``final=false`` es texto
  interino (se sustituye); ``final=true`` es una línea ya cerrada (se añade).
- ``stt.done``    ``{sessionId, text}`` — fin de la captura.
- ``stt.error``   ``{sessionId, message}`` — fallo con mensaje accionable.
- ``stt.progress`` ``{sessionId, phase, message}`` — aviso transitorio del motor
  (carga/descarga del modelo). La primera captura baja ~100 MB del modelo de
  Moonshine con el stderr nativo silenciado: sin esto, la UI parece colgada.

Mismo contrato ``interino/final`` que la Web Speech API, para que el hook de
dictado del frontend sea agnóstico al motor.

Configuración — la misma cadena que usa la CLI del engine, resuelta al construir
el motor (una vez por proceso) y expuesta por ``stt.status``:

- ``model_arch`` / ``language`` en la sección del plugin ``stt`` de
  ``config.toml`` (``[[plugins]] name = "phoson-plugin-stt"`` con su ``config``),
- si no, ``PHOSON_STT_MODEL_ARCH`` / ``PHOSON_STT_LANGUAGE``,
- si no, el default de la librería (``small-streaming``) y ``es``.

El idioma que manda el frontend en ``stt.start`` (el del UI) gana a lo anterior.
``model_arch`` acepta nombre (``tiny``, ``base``, ``tiny-streaming``,
``base-streaming``, ``small-streaming``, ``medium-streaming``) o número (0-5): es
el equivalente de ``--stt-model-arch`` de la CLI.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import threading
from typing import Any, Callable

log = logging.getLogger("phoson_bridge")

#: Segundos que ``stop`` espera a que el hilo de captura termine.
_STOP_TIMEOUT = 4.0

#: La primera captura descarga el modelo de Moonshine (decenas de MB) y abre la
#: sesión ONNX: 10-20 s sin ninguna salida visible (el motor silencia el stderr
#: nativo). Se avisa de la espera para que la UI no parezca colgada.
_LOADING_MESSAGE = "Cargando el modelo de dictado (la primera vez se descarga)…"

_MISSING_RUNTIME = (
    "El runtime de dictado (moonshine-voice) no está instalado. "
    "Instálalo con: pip install 'phoson-engine-minimal[stt]'."
)

#: Pista para una ``model_arch`` mal escrita: los nombres que acepta Moonshine.
_ARCH_HINT = (
    "Usa tiny|base|tiny-streaming|base-streaming|small-streaming|medium-streaming "
    "(o su número 0-5)."
)

_plugin_config_cache: dict[str, Any] | None = None


def _plugin_config() -> dict[str, Any]:
    """Config del plugin de dictado en ``config.toml``, o ``{}``.

    Es la misma fuente que consume la CLI (``PhosonConfig.plugins``); el bridge no
    reinventa la resolución, solo la lee. Un fallo al cargar la config (engine sin
    ``phoson_cli``, sin archivo) deja el dictado con los defaults: nunca tumba.
    """
    global _plugin_config_cache
    if _plugin_config_cache is None:
        try:
            from phoson_cli.config import load_config

            specs = load_config().plugins or []
        except Exception:  # noqa: BLE001 — la config es opcional
            specs = []
        for spec in specs:
            if isinstance(spec, dict) and "stt" in str(spec.get("name", "")).lower():
                inner = spec.get("config")
                _plugin_config_cache = inner if isinstance(inner, dict) else {}
                break
        else:
            _plugin_config_cache = {}
    return _plugin_config_cache


def _setting(key: str) -> tuple[Any, str]:
    """``(valor, fuente)`` de una opción del dictado: config.toml → entorno → None."""
    value = _plugin_config().get(key)
    if value not in (None, ""):
        return value, f"la opción '{key}' del plugin stt en config.toml"
    env = f"PHOSON_STT_{key.upper()}"
    raw = os.environ.get(env)
    if raw:
        return raw, env
    return None, ""


def _arch_label(plugin, arch: int | None) -> str | None:
    """Nombre legible de la arquitectura; ``None`` si manda la librería."""
    if arch is None:
        return None
    try:
        arches = getattr(
            importlib.import_module("phoson_plugin_stt.engine"), "MODEL_ARCHES", {}
        )
    except Exception:  # noqa: BLE001 — es solo una etiqueta para la UI
        return str(arch)
    return next((name for name, value in arches.items() if value == arch), str(arch))


class SttManager:
    """Captura de micrófono por sesión, sobre el loop del sidecar.

    La transcripción corre en un hilo (``asyncio.to_thread``) porque Moonshine es
    bloqueante; el loop solo hace *poll* de las líneas/parciales y los emite.
    """

    def __init__(self, emit: Callable[[str, dict[str, Any]], None]) -> None:
        self._emit = emit
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._stops: dict[str, threading.Event] = {}
        #: Idioma por sesión (una captura por sesión) + último usado, para el sondeo.
        self._languages: dict[str, str] = {}
        self._language: str | None = None
        #: El motor se construye una vez: guarda solo la arquitectura del modelo, y
        #: el entorno no cambia durante la vida del sidecar.
        self._engine_instance: Any | None = None
        self._model_arch: int | None = None

    # ── Disponibilidad ────────────────────────────────────────────────────
    def _plugin(self):
        """Importa ``phoson_plugin_stt`` (lazy). Devuelve el módulo o ``None``."""
        try:
            return importlib.import_module("phoson_plugin_stt")
        except ImportError:
            return None

    def _engine(self) -> tuple[Any | None, str | None]:
        """Devuelve ``(SttEngine | None, razón-de-fallo | None)``, construido una vez.

        No descarga modelos: solo comprueba que el plugin, el runtime de
        Moonshine y el backend de audio (sounddevice) están disponibles, y respeta
        la ``model_arch`` configurada (config.toml → entorno).
        """
        if self._engine_instance is not None:
            return self._engine_instance, None
        plugin = self._plugin()
        if plugin is None:
            return None, "El plugin de dictado (phoson_plugin_stt) no está instalado."
        try:
            importlib.import_module("moonshine_voice")
        except ImportError:
            return None, _MISSING_RUNTIME
        # Compatibilidad de API: phoson_plugin_stt construye MicTranscriber() sin
        # argumentos (API builder, moonshine-voice >= 0.1.1). Una 0.1.0 importa
        # bien — este chequeo la detecta aquí, con mensaje accionable, en vez de
        # dejar que el micrófono reviente a mitad de dictado (alpha.12).
        try:
            from moonshine_voice import MicTranscriber

            MicTranscriber()
        except TypeError as exc:
            return None, (
                "El runtime de dictado (moonshine-voice) es demasiado viejo: "
                f"{exc}. Actualízalo con: pip install 'moonshine-voice>=0.1.5'."
            )
        except ImportError:
            return None, _MISSING_RUNTIME
        try:
            importlib.import_module("sounddevice")
        except ImportError:
            return None, (
                "El backend de audio (sounddevice) no está instalado. "
                "Instálalo con: pip install 'phoson-engine-minimal[stt]'."
            )
        except OSError:
            # Falta PortAudio: el motor tiene un localizador propio
            # (PHOSON_STT_PORTAUDIO / ~/.cache/phoson/portaudio); deja que
            # falle en la captura con su mensaje accionable.
            pass
        raw_arch, arch_source = _setting("model_arch")
        try:
            arch = plugin.parse_model_arch(raw_arch)
        except (ValueError, TypeError) as exc:
            return None, f"{arch_source or 'model_arch'} no es válido: {exc} {_ARCH_HINT}"
        try:
            engine = plugin.SttEngine(model_arch=arch)
        except Exception as exc:  # noqa: BLE001 — nunca tumbar la UI
            return None, str(exc)
        self._engine_instance = engine
        self._model_arch = arch
        return engine, None

    def status(self) -> dict[str, Any]:
        """Estado del dictado para que la UI habilite o explique el botón."""
        engine, reason = self._engine()
        languages: list[str] = []
        plugin = self._plugin()
        if plugin is not None:
            languages = sorted(getattr(plugin, "LANGUAGES", {}) or {})
        # Idioma de la captura en curso (una hay, normalmente); si no, el último.
        active = next(iter(self._languages.values()), None)
        return {
            "supported": engine is not None,
            "listening": any(not task.done() for task in self._tasks.values()),
            "language": active or self._language,
            "languages": languages,
            # Modelo en uso; null = el default de moonshine-voice para el idioma.
            "modelArch": self._model_arch,
            "modelName": _arch_label(plugin, self._model_arch) if engine else None,
            "reason": reason,
        }

    # ── Ciclo de captura ──────────────────────────────────────────────────
    async def start(self, session_key: str, language: str | None = None) -> dict[str, Any]:
        """Inicia el dictado para una sesión (detiene el anterior si lo había)."""
        await self.stop(session_key)

        engine, reason = self._engine()
        if engine is None:
            self._emit("stt.error", {"sessionId": session_key, "message": reason})
            return {"ok": False, "supported": False, "reason": reason}

        plugin = self._plugin()
        # El idioma del UI (lo manda el frontend en stt.start) gana al configurado.
        configured = _setting("language")[0]
        requested = language or (str(configured) if configured else None) or None
        try:
            chosen = plugin.normalize_language(requested) if plugin else (requested or "es")
        except ValueError as exc:
            self._emit("stt.error", {"sessionId": session_key, "message": str(exc)})
            return {"ok": False, "supported": True, "reason": str(exc)}

        self._language = chosen
        self._languages[session_key] = chosen
        stop = threading.Event()
        self._stops[session_key] = stop
        self._tasks[session_key] = asyncio.create_task(
            self._listen(session_key, engine, chosen, stop)
        )
        return {"ok": True, "supported": True, "language": chosen}

    async def stop(self, session_key: str) -> dict[str, Any]:
        """Detiene la captura de una sesión y espera a que emita su resultado."""
        stop = self._stops.get(session_key)
        if stop is not None:
            stop.set()
        task = self._tasks.get(session_key)
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=_STOP_TIMEOUT)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                task.cancel()
                # Espera a que el `finally` del task viejo se complete ANTES de
                # volver: si no, un `start` inmediato insertaría el task nuevo y
                # el `finally` del viejo lo borraría (captura huérfana).
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
        return {"ok": True}

    async def stop_all(self) -> None:
        for key in list(self._tasks):
            await self.stop(key)

    async def _listen(
        self,
        key: str,
        engine: Any,
        language: str,
        stop: threading.Event,
    ) -> None:
        captured: list[str] = []
        partial = {"text": ""}

        # El motor baja el modelo y monta la sesión ONNX dentro del hilo, con el
        # stderr nativo silenciado: sin este aviso la espera parece un cuelgue.
        self._emit(
            "stt.progress",
            {"sessionId": key, "phase": "loading", "message": _LOADING_MESSAGE},
        )

        worker = asyncio.ensure_future(
            asyncio.to_thread(
                engine.transcribe_microphone,
                language,
                None,
                stop=stop,
                on_line=captured.append,
                on_partial=lambda text: partial.__setitem__("text", text),
            )
        )

        emitted = 0
        last_partial = ""
        try:
            while not worker.done():
                await asyncio.sleep(0.15)
                emitted = self._emit_new_lines(key, captured, emitted)
                current = partial["text"].strip()
                if current and current != last_partial:
                    self._emit("stt.partial", {"sessionId": key, "text": current, "final": False})
                    last_partial = current
            text = await worker
        except asyncio.CancelledError:
            stop.set()
            worker.cancel()
            raise
        except Exception as exc:  # noqa: BLE001 — un fallo de audio no tumba el bridge
            log.warning("dictado falló: %s", exc)
            self._emit("stt.error", {"sessionId": key, "message": f"Fallo de transcripción: {exc}"})
            return
        finally:
            # Solo limpiamos si seguimos siendo el task registrado: un `start`
            # posterior pudo haber reemplazado la entrada, y un `pop` a ciegas
            # borraría la captura NUEVA.
            if self._tasks.get(key) is asyncio.current_task():
                self._tasks.pop(key, None)
                self._stops.pop(key, None)
                self._languages.pop(key, None)

        self._emit_new_lines(key, captured, emitted)
        self._emit("stt.done", {"sessionId": key, "text": text})

    def _emit_new_lines(self, key: str, captured: list[str], emitted: int) -> int:
        while emitted < len(captured):
            self._emit(
                "stt.partial",
                {"sessionId": key, "text": captured[emitted], "final": True},
            )
            emitted += 1
        return emitted


def report() -> tuple[bool, str]:
    """``phoson-bridge --stt-check``: estado del dictado como texto, sin micrófono.

    Sirve para depurar el sidecar *congelado* (PyInstaller): un binario sin el
    extra ``stt`` responde pero ``supported`` es ``false`` con el motivo.
    """
    manager = SttManager(lambda _method, _params: None)
    status = manager.status()
    return bool(status["supported"]), json.dumps(status, ensure_ascii=False, indent=2)


def transcribe_wav(path: str, language: str | None = None) -> tuple[bool, str]:
    """``phoson-bridge --stt-transcribe``: dicta un WAV y devuelve el texto.

    Es la prueba determinista del empaquetado: recorre el mismo runtime de
    Moonshine (sus librerías nativas y la descarga del modelo) que usa el botón
    del micrófono, pero alimentado por un archivo y sin PortAudio, así que corre
    en CI, sin micro y en el binario congelado. ``language`` omite la cadena de
    configuración (config.toml → entorno) cuando se da. Devuelve ``(ok, texto)``
    o ``(False, motivo)``.
    """
    manager = SttManager(lambda _method, _params: None)
    engine, reason = manager._engine()
    if engine is None:
        return False, reason or "El motor de dictado no está disponible."
    plugin = manager._plugin()
    try:
        chosen = plugin.normalize_language(language) if plugin else (language or "es")
    except ValueError as exc:
        return False, str(exc)
    if not hasattr(engine, "transcribe_wav"):
        return False, (
            "El plugin de dictado no puede dictar archivos "
            "(actualiza phoson-engine-minimal)."
        )
    try:
        text = engine.transcribe_wav(path, chosen)
    except FileNotFoundError as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001 — es un diagnóstico de CLI, nunca tumbar
        return False, f"{type(exc).__name__}: {exc}"
    return True, text
