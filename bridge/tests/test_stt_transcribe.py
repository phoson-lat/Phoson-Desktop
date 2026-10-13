"""``stt.transcribe_wav``: la prueba de dictado sin micrófono (para el congelado).

El binario de PyInstaller puede responder al protocolo y aun así no poder dictar
(le faltan las librerías nativas de Moonshine o no puede bajar el modelo). Por
eso el bridge expone ``--stt-transcribe``, que dicta un WAV por el mismo camino
que el micrófono pero sin PortAudio. Este test suplanta el motor, así que corre
también en CI, sin ``moonshine-voice`` instalado.

    python bridge/tests/test_stt_transcribe.py
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

sys.modules.setdefault("moonshine_voice", types.ModuleType("moonshine_voice"))
sys.modules.setdefault("sounddevice", types.ModuleType("sounddevice"))

from phoson_bridge import stt  # noqa: E402

failures: list[str] = []
_REAL_ENGINE = stt.SttManager._engine


def _check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


class _Plugin:
    """Parte de ``phoson_plugin_stt`` que usa el helper (con alias de nombres)."""

    _ALIASES = {"spanish": "es", "english": "en"}

    @staticmethod
    def normalize_language(lang: str | None) -> str:
        code = (lang or "es").strip().lower().split("-")[0]
        code = _Plugin._ALIASES.get(code, code)
        if code not in ("es", "en"):
            raise ValueError(f"Idioma no admitido: {code}")
        return code


class _Engine:
    """SttEngine de mentira que recuerda cómo fue llamado."""

    def __init__(self, *, text: str = "hola", error: BaseException | None = None) -> None:
        self.text = text
        self.error = error
        self.calls: list[tuple[str, str]] = []

    def transcribe_wav(self, path: Any, language: str) -> str:
        self.calls.append((str(path), language))
        if self.error is not None:
            raise self.error
        return self.text


class _OldEngine:
    """Motor de un plugin viejo: sin ``transcribe_wav``."""

    def transcribe_microphone(self, *_a: Any, **_kw: Any) -> str:
        return ""


def _fake_engine(engine: Any, reason: str | None = None) -> None:
    """``SttManager._engine``/``._plugin`` devueltos por el test (se restauran al final).

    El helper construye su propio ``SttManager``, así que se suplanta la clase,
    no una instancia: si no, ``transcribe_wav`` usaría el plugin real del venv.
    """

    def _method(self: Any) -> tuple[Any, str | None]:  # noqa: ARG001 — firma original
        return engine, reason

    stt.SttManager._engine = _method
    stt.SttManager._plugin = lambda self: _Plugin  # type: ignore[method-assign]


WAV = str(Path(__file__).resolve().parent / "audio.wav")

# 1) Camino feliz: dicta y normaliza el idioma pedido por el CLI.
engine = _Engine(text="esto es una prueba")
_fake_engine(engine)
ok, text = stt.transcribe_wav(WAV, "SPANISH")
_check(
    "dicta el WAV con el idioma normalizado",
    ok and text == "esto es una prueba" and engine.calls == [(WAV, "es")],
    f"{ok} {text!r} {engine.calls}",
)

# 2) Sin idioma: manda la cadena de configuración (aquí, el default "es").
engine = _Engine(text="vale")
_fake_engine(engine)
ok, _ = stt.transcribe_wav(WAV)
_check("sin idioma usa el default", ok and engine.calls == [(WAV, "es")], str(engine.calls))

# 3) Idioma no admitido: motivo legible y el motor ni se toca.
engine = _Engine()
_fake_engine(engine)
ok, text = stt.transcribe_wav(WAV, "klingon")
_check(
    "idioma no admitido se reporta como error",
    not ok and "no admitido" in text and engine.calls == [],
    f"{ok} {text!r}",
)

# 4) Archivo inexistente: el FileNotFoundError llega como motivo, no como traceback.
_fake_engine(_Engine(error=FileNotFoundError(f"Audio file not found: {WAV}")))
ok, text = stt.transcribe_wav(WAV, "es")
_check("archivo ausente se reporta", not ok and "not found" in text, repr(text))

# 5) Fallo del runtime nativo (justo lo que quiere detectar el empaquetado).
_fake_engine(_Engine(error=RuntimeError("onnxruntime failed to initialize")))
ok, text = stt.transcribe_wav(WAV, "es")
_check(
    "un fallo del motor se etiqueta con su tipo",
    not ok and text.startswith("RuntimeError:") and "onnxruntime" in text,
    repr(text),
)

# 6) Sin motor (falta el extra o PortAudio roto): se propaga el motivo de _engine().
_fake_engine(None, reason="El plugin de dictado no está instalado.")
ok, text = stt.transcribe_wav(WAV, "es")
_check("sin motor se devuelve su motivo", not ok and "plugin" in text, repr(text))

# 7) Plugin viejo sin ``transcribe_wav``: aviso accionable, no AttributeError.
_fake_engine(_OldEngine())
ok, text = stt.transcribe_wav(WAV, "es")
_check(
    "un plugin sin dictado de archivos lo dice",
    not ok and "actualiza" in text,
    repr(text),
)

stt.SttManager._engine = _REAL_ENGINE  # deja la clase como estaba
print("todo OK" if not failures else f"FALLOS: {failures}")
sys.exit(1 if failures else 0)
