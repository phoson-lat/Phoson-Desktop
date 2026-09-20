"""Dictado por voz (STT) del bridge, respaldado por ``phoson_plugin_stt``.

La Web Speech API **no existe en WebKitGTK/WKWebView**, así que en Linux/macOS la
app no puede dictar con el navegador. En su lugar, el sidecar usa el motor STT
del propio engine (Moonshine, *on-device*, multilingüe) y reemite el transcript
como notificaciones JSON-RPC. El micrófono lo captura el host que ejecuta el
sidecar — el mismo equipo que muestra la app.

Notificaciones:

- ``stt.partial`` ``{sessionId, text, final}`` — ``final=false`` es texto
  interino (se sustituye); ``final=true`` es una línea ya cerrada (se añade).
- ``stt.done``    ``{sessionId, text}`` — fin de la captura.
- ``stt.error``   ``{sessionId, message}`` — fallo con mensaje accionable.

Mismo contrato ``interino/final`` que la Web Speech API, para que el hook de
dictado del frontend sea agnóstico al motor.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import threading
from typing import Any, Callable

log = logging.getLogger("phoson_bridge")

#: Segundos que ``stop`` espera a que el hilo de captura termine.
_STOP_TIMEOUT = 4.0

_MISSING_RUNTIME = (
    "El runtime de dictado (moonshine-voice) no está instalado. "
    "Instálalo con: pip install 'phoson-engine-minimal[stt]'."
)


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

    # ── Disponibilidad ────────────────────────────────────────────────────
    def _plugin(self):
        """Importa ``phoson_plugin_stt`` (lazy). Devuelve el módulo o ``None``."""
        try:
            return importlib.import_module("phoson_plugin_stt")
        except ImportError:
            return None

    def _engine(self) -> tuple[Any | None, str | None]:
        """Devuelve ``(SttEngine | None, razón-de-fallo | None)``.

        No descarga modelos: solo comprueba que el plugin, el runtime de
        Moonshine y el backend de audio (sounddevice) están disponibles.
        """
        plugin = self._plugin()
        if plugin is None:
            return None, "El plugin de dictado (phoson_plugin_stt) no está instalado."
        try:
            importlib.import_module("moonshine_voice")
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
        try:
            return plugin.SttEngine(), None
        except Exception as exc:  # noqa: BLE001 — nunca tumbar la UI
            return None, str(exc)

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
        try:
            chosen = plugin.normalize_language(language) if plugin else (language or "es")
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
