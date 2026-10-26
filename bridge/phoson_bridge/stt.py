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
  ``phase``: ``"loading"`` (preparando la sesión), ``"downloading"``
  (descargando el modelo; lleva ``percent`` 0-100) y ``"ready"`` (modelo
  disponible).

Mismo contrato ``interino/final`` que la Web Speech API, para que el hook de
dictado del frontend sea agnóstico al motor.

Configuración — la misma cadena que usa la CLI del engine, resuelta al construir
el motor (una vez por proceso) y expuesta por ``stt.status``:

- ``model_arch`` / ``language`` en la sección del plugin ``stt`` de
  ``config.toml`` (``[[plugins]] name = "phoson-plugin-stt"`` con su ``config``),
- si no, ``PHOSON_STT_MODEL_ARCH`` / ``PHOSON_STT_LANGUAGE``,
- si no, el default de la librería (``small-streaming``) y ``es``.

El idioma que manda el frontend en ``stt.start`` (el del UI) gana a lo anterior
— salvo que ``config.toml`` haya fijado uno (``configuredLanguage`` en
``stt.status``): entonces Ajustes lo eligió a mano y el frontend no manda nada.
``model_arch`` acepta nombre (``tiny``, ``base``, ``tiny-streaming``,
``base-streaming``, ``small-streaming``, ``medium-streaming``) o número (0-5): es
el equivalente de ``--stt-model-arch`` de la CLI.

Ajustes cambia esa sección con ``stt.config.set`` (server.py, que persiste con
``save_config`` y llama a :meth:`SttManager.reload`) y puede bajar el modelo por
adelantado con ``stt.download``, que comparte la pre-descarga con progreso de la
captura.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import threading
import time
from typing import Any, Callable

from .extras import requirements_for

log = logging.getLogger("phoson_bridge")

#: Segundos que ``stop`` espera a que el hilo de captura termine.
_STOP_TIMEOUT = 4.0

#: La primera captura descarga el modelo de Moonshine (decenas de MB) y abre la
#: sesión ONNX: 10-20 s sin ninguna salida visible (el motor silencia el stderr
#: nativo). Se avisa de la espera para que la UI no parezca colgada.
_LOADING_MESSAGE = "Cargando el modelo de dictado (la primera vez se descarga)…"
_DOWNLOADING_MESSAGE = "Descargando el modelo de dictado…"
_READY_MESSAGE = "Modelo de dictado listo."

#: Segundos antes de pintar progreso de descarga: con la caché caliente el
#: «recalentado» del modelo termina en milisegundos y no debe mostrar barra.
_DOWNLOAD_GRACE_SECONDS = 0.75

_MISSING_RUNTIME = (
    "El runtime de dictado (moonshine-voice) no está instalado. "
    "Instálalo con: pip install 'phoson-engine-minimal[stt]'."
)
_MISSING_AUDIO = (
    "El backend de audio (sounddevice) no está instalado. "
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


def _arches() -> list[str]:
    """Nombres de arquitectura que acepta Moonshine (opciones de Ajustes)."""
    try:
        arches = getattr(
            importlib.import_module("phoson_plugin_stt.engine"), "MODEL_ARCHES", {}
        )
    except Exception:  # noqa: BLE001 — es solo para la UI
        return []
    return sorted(arches)


#: Nombre canónico del plugin de dictado (la spec de config.toml lo referencia).
_STT_PLUGIN_NAME = "phoson-plugin-stt"


def _is_stt_spec(spec: object) -> bool:
    """¿Es la spec (cadena o tabla inline) del plugin de dictado?"""
    if isinstance(spec, dict):
        return "stt" in str(spec.get("name", "")).lower()
    return "stt" in str(spec or "").lower()


def merge_plugin_config(cfg: Any, values: dict[str, Any]) -> None:
    """Fusiona ``values`` en la sección ``config`` del plugin stt de ``cfg.plugins``.

    ``values`` mapea opción → valor nuevo; ``None``/``""`` borra la opción (vuelve
    al default de la librería). La spec del plugin puede ser una cadena suelta
    (``"phoson-plugin-stt"``) o una tabla inline con su ``config``: se normaliza a
    tabla y se fusionan las claves; si queda sin opciones se colapsa de nuevo a
    la cadena suelta para no ensuciar el toml. Persistir es cosa del llamador
    (``save_config`` con ``only_fields={"plugins"}``).
    """
    specs: list[Any] = list(getattr(cfg, "plugins", None) or [])
    index = next((i for i, spec in enumerate(specs) if _is_stt_spec(spec)), None)
    if index is None:
        if all(value in (None, "") for value in values.values()):
            return  # no hay sección y nada que fijar: no se crea
        spec: dict[str, Any] = {"name": _STT_PLUGIN_NAME, "config": {}}
    else:
        original = specs[index]
        if isinstance(original, dict):
            spec = {**original, "config": dict(original.get("config") or {})}
        else:
            spec = {"name": str(original), "config": {}}
    inner: dict[str, Any] = spec["config"]
    for key, value in values.items():
        if value in (None, ""):
            inner.pop(key, None)
        else:
            inner[key] = value
    if index is None:
        specs.append(spec)
    elif not inner and set(spec.keys()) <= {"name", "config"}:
        # Sin opciones queda la forma mínima (cadena suelta): no ensucia el toml.
        specs[index] = spec["name"]
    else:
        specs[index] = spec
    cfg.plugins = specs


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

    def _download_model(
        self,
        language: str,
        session_key: str,
        emit: Callable[[str, dict[str, Any]], None],
    ) -> str:
        """Descarga (si falta) el modelo de Moonshine de ``language``, con progreso.

        Se llama ANTES de abrir la sesión de micrófono — la primera captura de
        un idioma baja ~100 MB sin ninguna salida visible (el motor silencia el
        stderr nativo), y con esto la UI muestra ``stt.progress`` con
        ``phase="downloading"`` y ``percent`` 0-100 en vez del aviso genérico de
        «cargando». ``emit`` debe ser thread-safe: el método corre en un hilo
        aparte y el loop hace el marshal.

        Devuelve un estado breve, que también consume ``stt.download`` (Ajustes):

        - ``"downloaded"`` — hubo descarga visible (con progreso emitido);
        - ``"cached"`` — el modelo ya estaba (la caché caliente recalienta en
          milisegundos y no debe pintar barras);
        - ``"unavailable"`` — el runtime no expone la API de descarga;
        - ``"failed"`` — la descarga reventó (la captura reintentará y
          reportará el error una sola vez por ``stt.error``).
        """
        try:
            moonshine = importlib.import_module("moonshine_voice")
        except ImportError:
            return "unavailable"
        get_model = getattr(moonshine, "get_model_for_language", None)
        if get_model is None:
            # Runtime sin API pública de descarga: el flujo viejo (aviso de
            # «cargando») sigue siendo válido.
            return "unavailable"
        arch = None
        if self._model_arch is not None:
            arch_enum = getattr(moonshine, "ModelArch", None)
            if arch_enum is None:
                return "unavailable"
            try:
                # La misma arquitectura que usará la captura, para calentar
                # exactamente el mismo modelo.
                arch = arch_enum(self._model_arch)
            except ValueError:
                return "unavailable"
        started = time.monotonic()
        reported = False

        def _on_progress(fraction: float, _file: str) -> None:
            nonlocal reported
            if time.monotonic() - started < _DOWNLOAD_GRACE_SECONDS:
                return
            reported = True
            percent = max(0, min(100, round(fraction * 100)))
            emit(
                "stt.progress",
                {
                    "sessionId": session_key,
                    "phase": "downloading",
                    "percent": percent,
                    "message": _DOWNLOADING_MESSAGE,
                },
            )

        try:
            # `on_progress` silencia las barras tqdm de la librería y da una
            # fracción 0-1 que cubre modelo + corrector ortográfico.
            get_model(language, arch, on_progress=_on_progress)
        except Exception as exc:  # noqa: BLE001 — la captura reintentará y reportará
            log.info("pre-descarga del modelo de dictado no disponible: %s", exc)
            return "failed"
        return "downloaded" if reported else "cached"

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
            return None, _MISSING_AUDIO
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

    def reload(self) -> None:
        """Descarta el motor y la config cacheada tras cambiar ``config.toml``.

        ``stt.config.set`` escribe la sección del plugin y llama aquí: la próxima
        captura reconstruye el motor con la ``model_arch`` nueva en vez de
        esperar un reinicio de la app. Una captura en curso no se toca (el task
        ya tiene su referencia al motor).
        """
        global _plugin_config_cache
        _plugin_config_cache = None
        self._engine_instance = None
        self._model_arch = None

    def pick_language(self, requested: str | None) -> str:
        """Idioma efectivo de una captura: pedido → config.toml/entorno → ``es``.

        Lanza ``ValueError`` (mensaje accionable del plugin) si el idioma no es
        admitido. Además de ``start`` lo usan ``stt.download`` y Ajustes para
        predecir qué idioma capturará la próxima sesión.
        """
        plugin = self._plugin()
        configured = _setting("language")[0]
        wanted = requested or (str(configured) if configured else None) or None
        if plugin is not None:
            return plugin.normalize_language(wanted)
        return wanted or "es"

    def status(self) -> dict[str, Any]:
        """Estado del dictado para que la UI habilite o explique el botón."""
        engine, reason = self._engine()
        languages: list[str] = []
        plugin = self._plugin()
        if plugin is not None:
            languages = sorted(getattr(plugin, "LANGUAGES", {}) or {})
        # Idioma de la captura en curso (una hay, normalmente); si no, el último.
        active = next(iter(self._languages.values()), None)
        configured, language_source = _setting("language")
        _, arch_source = _setting("model_arch")
        return {
            "supported": engine is not None,
            "listening": any(not task.done() for task in self._tasks.values()),
            "language": active or self._language,
            "languages": languages,
            # Nombres amigables (es → "Spanish") y arquitecturas aceptadas:
            # opciones de la sección de Dictado en Ajustes.
            "languageNames": dict(getattr(plugin, "LANGUAGES", {}) or {})
            if plugin
            else {},
            "arches": _arches(),
            # Idioma fijado en config.toml/entorno: el frontend deja de mandar el
            # suyo y la fuente explica quién manda. null = el de la interfaz.
            "configuredLanguage": str(configured) if configured else None,
            "languageSource": language_source or None,
            "archSource": arch_source or None,
            # Modelo en uso; null = el default de moonshine-voice para el idioma.
            "modelArch": self._model_arch,
            "modelName": _arch_label(plugin, self._model_arch) if engine else None,
            "reason": reason,
            # Extra del engine que lo arregla (la UI ofrece instalarlo); vacío si
            # el fallo no es una dependencia que falte o la plataforma no la tiene
            # (Moonshine no publica wheels para macOS Intel).
            "missingExtra": "stt"
            if reason in (_MISSING_RUNTIME, _MISSING_AUDIO) and requirements_for("stt")
            else "",
        }

    # ── Ciclo de captura ──────────────────────────────────────────────────
    async def start(self, session_key: str, language: str | None = None) -> dict[str, Any]:
        """Inicia el dictado para una sesión (detiene el anterior si lo había)."""
        await self.stop(session_key)

        engine, reason = self._engine()
        if engine is None:
            self._emit("stt.error", {"sessionId": session_key, "message": reason})
            return {"ok": False, "supported": False, "reason": reason}

        # El idioma del UI (lo manda el frontend en stt.start) gana al configurado.
        try:
            chosen = self.pick_language(language)
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

        # Pre-descarga con progreso (ver `_download_model`). El marshal va con
        # `call_soon_threadsafe` porque `self._emit` toca la cola asyncio del
        # loop, que no es thread-safe.
        loop = asyncio.get_running_loop()

        def _emit_threadsafe(method: str, params: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(self._emit, method, params)

        worker: asyncio.Future[str] | None = None
        emitted = 0
        last_partial = ""
        try:
            await asyncio.to_thread(self._download_model, language, key, _emit_threadsafe)
            if stop.is_set():
                # El usuario cortó el dictado mientras bajaba el modelo.
                self._emit("stt.done", {"sessionId": key, "text": ""})
                return
            worker = asyncio.ensure_future(
                asyncio.to_thread(
                    engine.transcribe_microphone,
                    language,
                    None,
                    stop=stop,
                    on_line=captured.append,
                    on_partial=lambda text: partial.__setitem__("text", text),
                    on_ready=lambda: _emit_threadsafe(
                        "stt.progress",
                        {"sessionId": key, "phase": "ready", "message": _READY_MESSAGE},
                    ),
                )
            )
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
            if worker is not None:
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
