"""Pre-descarga del modelo de dictado con progreso (`stt.progress`).

La primera captura de un idioma baja ~100 MB del modelo de Moonshine con el
stderr nativo silenciado. El bridge la adelanta (`_download_model`) para
emitir ``phase="downloading"`` con ``percent`` 0-100 y ``phase="ready"`` al
terminar; con la caché caliente no debe pintar nada.

Corre en CI: el runtime de Moonshine se suplanta con un stub, igual que
`test_stt_config.py`.

    python bridge/tests/test_stt_download.py
"""

from __future__ import annotations

import asyncio
import enum
import os
import sys
import threading
import time
import types
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class ModelArch(enum.IntEnum):
    """ModelArch de mentira: basta con que `ModelArch(n)` funcione."""

    TINY = 0
    BASE = 1
    TINY_STREAMING = 2
    BASE_STREAMING = 3
    SMALL_STREAMING = 4
    MEDIUM_STREAMING = 5


class _MicTranscriber:  # API builder mínima, sin micrófono
    def language(self, _code: str) -> "_MicTranscriber":
        return self


#: Llamadas a `get_model_for_language`: ``(idioma, arch, duración)``.
get_calls: list[tuple[str, Any, float]] = []
#: Si es true, `get_model_for_language` revienta (descarga imposible).
fail_download = False


def _get_model_for_language(language, arch=None, *, on_progress=None, **_kw):
    """Falso descargador: registra la llamada y notifica como el tracker real.

    El tracker de moonshine-voice llama al callback una vez por archivo aunque
    estén en caché (eventos `force`): así se prueba también la ventana de gracia
    que distingue «caché caliente» de «descarga real».
    """
    duration = 0.01 if not fail_download else 0.0
    get_calls.append((language, arch, duration))
    if fail_download:
        raise RuntimeError("sin red")
    if on_progress is not None:
        on_progress(0.5, "model.ort")
        on_progress(1.0, "model.ort")
    return "/cache/model", arch


_moonshine = types.ModuleType("moonshine_voice")
_moonshine.MicTranscriber = _MicTranscriber
_moonshine.ModelArch = ModelArch
_moonshine.get_model_for_language = _get_model_for_language
sys.modules.setdefault("moonshine_voice", _moonshine)
sys.modules.setdefault("sounddevice", types.ModuleType("sounddevice"))

# `phoson_plugin_stt` de mentira, con la superficie que usa el bridge.
if "phoson_plugin_stt" not in sys.modules:
    _engine_mod = types.ModuleType("phoson_plugin_stt.engine")
    _engine_mod.MODEL_ARCHES = {name: value for name, value in ModelArch.__members__.items()}
    _pkg = types.ModuleType("phoson_plugin_stt")
    _pkg.engine = _engine_mod
    sys.modules["phoson_plugin_stt"] = _pkg
    sys.modules["phoson_plugin_stt.engine"] = _engine_mod

from phoson_bridge import stt  # noqa: E402

failures: list[str] = []


def _check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


class _Engine:
    """SttEngine de mentirita: "capta" hasta que lo detengan."""

    def __init__(self, model_arch: int | None = None) -> None:
        self.model_arch = model_arch

    def transcribe_microphone(
        self, language: str, seconds: float | None = None, *, stop: Any = None, **_kw
    ) -> str:
        assert isinstance(stop, threading.Event), "el bridge debe pasar su evento de parada"
        while not stop.wait(0.02):
            pass
        return f"[{language}]"


class _Plugin:
    LANGUAGES = {"es": "Spanish", "en": "English", "zh": "Chinese"}
    SttEngine = _Engine

    @staticmethod
    def parse_model_arch(value: object) -> int | None:
        if value in (None, ""):
            return None
        known = {"medium-streaming": 5}
        if isinstance(value, str) and value in known:
            return known[value]
        raise ValueError(f"Unknown model_arch {value!r}")

    @staticmethod
    def normalize_language(lang: str | None) -> str:
        code = (lang or "es").strip().lower().split("-")[0]
        if code not in _Plugin.LANGUAGES:
            raise ValueError(f"Idioma no admitido: {code}")
        return code


def _manager() -> stt.SttManager:
    """SttManager con motor de mentira que registra todas las notificaciones."""
    for key in ("PHOSON_STT_MODEL_ARCH", "PHOSON_STT_LANGUAGE"):
        os.environ.pop(key, None)
    stt._plugin_config_cache = {}  # sin config.toml: solo manda el entorno
    notes: list[tuple[str, dict[str, Any]]] = []
    manager = stt.SttManager(lambda method, params: notes.append((method, dict(params))))
    manager._plugin = lambda: _Plugin
    manager.notes = notes  # type: ignore[attr-defined]
    return manager


async def _dictate(manager: stt.SttManager, key: str, language: str | None) -> list[tuple[str, dict[str, Any]]]:
    """Arranca la captura, deja correr la pre-descarga y la detiene."""
    await manager.start(key, language)
    # La pre-descarga corre en un hilo y sus eventos cruzan al loop con
    # `call_soon_threadsafe`: hay que darle vueltas al loop para verlos.
    await asyncio.sleep(0.2)
    await manager.stop(key)
    return manager.notes  # type: ignore[attr-defined]


def _phases(notes: list[tuple[str, dict[str, Any]]]) -> list[tuple[str, Any]]:
    """Fases `stt.progress` emitidas: ``[(phase, percent), ...]``."""
    return [
        (params.get("phase"), params.get("percent"))
        for method, params in notes
        if method == "stt.progress"
    ]


# 1) Descarga fría: loading → downloading (con percent) → ready.
stt._DOWNLOAD_GRACE_SECONDS = 0  # sin gracia: el stub "descarga" al instante
notes = asyncio.run(_dictate(_manager(), "s1", "en"))
_check(
    "descarga fría: loading → downloading(percent) → ready",
    _phases(notes) == [("loading", None), ("downloading", 50), ("downloading", 100), ("ready", None)],
    str(_phases(notes)),
)
_check(
    "la captura sigue tras la pre-descarga (stt.done)",
    any(method == "stt.done" for method, _params in notes),
    str([m for m, _ in notes]),
)
_check(
    "se pre-descarga el idioma pedido (no el default)",
    get_calls and get_calls[-1][0] == "en" and get_calls[-1][1] is None,
    str(get_calls[-1]),
)

# 2) Caché caliente: el recaliento dura milisegundos y no pinta barras.
stt._DOWNLOAD_GRACE_SECONDS = 0.75  # valor real
notes = asyncio.run(_dictate(_manager(), "s2", "en"))
_check(
    "caché caliente: solo el aviso de loading, sin downloading",
    _phases(notes) == [("loading", None)],
    str(_phases(notes)),
)

# 3) Descarga imposible: nada de progreso, la captura reporta su error.
fail_download = True
get_calls.clear()
notes = asyncio.run(_dictate(_manager(), "s3", "en"))
fail_download = False
_check(
    "descarga rota: sin fase downloading, el motor reporta después",
    ("downloading", 50) not in _phases(notes) and ("ready", None) not in _phases(notes),
    str(_phases(notes)),
)
_check(
    "descarga rota: la captura no se aborta por la pre-descarga",
    any(method == "stt.done" for method, _params in notes),
    str([m for m, _ in notes]),
)

# 4) La pre-descarga calienta la MISMA arquitectura configurada.
manager = _manager()  # primero: `_manager` limpia el entorno
os.environ["PHOSON_STT_MODEL_ARCH"] = "medium-streaming"
manager._engine()  # fija self._model_arch desde el entorno
asyncio.run(_dictate(manager, "s4", "en"))
os.environ.pop("PHOSON_STT_MODEL_ARCH", None)
_check(
    "model_arch configurada se propaga a la pre-descarga",
    get_calls and get_calls[-1][1] == ModelArch.MEDIUM_STREAMING,
    str(get_calls[-1]),
)

stt._plugin_config_cache = None

print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)
