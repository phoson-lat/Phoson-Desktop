"""Modelo e idioma del dictado: el bridge respeta config.toml/entorno y el UI.

No enciende el micrófono ni baja modelos: el motor se suple con un stub, así que
corre también en CI (sin `moonshine-voice` instalado).

    python bridge/tests/test_stt_config.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import threading
import types
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# El bridge sondea estos dos para decir si hay motor. Se suplantan aquí para que
# el test valga también en CI, donde `moonshine-voice` no está instalado. El
# falso moonshine_voice expone la API builder que valida `_engine()`
# (`MicTranscriber()` sin argumentos), igual que el real >= 0.1.1.
_moonshine = types.ModuleType("moonshine_voice")


class _MicTranscriber:  # API builder mínima, sin micrófono
    def language(self, _code: str) -> "_MicTranscriber":
        return self


_moonshine.MicTranscriber = _MicTranscriber
sys.modules.setdefault("moonshine_voice", _moonshine)
sys.modules.setdefault("sounddevice", types.ModuleType("sounddevice"))

# `_arch_label` lee MODEL_ARCHES del motor para ponerle nombre al modelo; sin esto,
# en CI la etiqueta caería al número suelto y el test dependería del entorno.
if "phoson_plugin_stt.engine" not in sys.modules:
    _pkg = types.ModuleType("phoson_plugin_stt")
    _engine_mod = types.ModuleType("phoson_plugin_stt.engine")
    _engine_mod.MODEL_ARCHES = {
        "tiny": 0,
        "base": 1,
        "tiny_streaming": 2,
        "base_streaming": 3,
        "small_streaming": 4,
        "medium_streaming": 5,
    }
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
    """SttEngine de mentira: recuerda su arch y "capta" hasta que lo detengan."""

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
    """phoson_plugin_stt de mentira, con la misma superficie que usa el bridge."""

    LANGUAGES = {"es": "Spanish", "en": "English", "zh": "Chinese"}
    SttEngine = _Engine
    seen: list[Any] = []

    @staticmethod
    def parse_model_arch(value: object) -> int | None:
        _Plugin.seen.append(value)
        if value in (None, ""):
            return None
        known = {"tiny": 0, "base": 1, "small-streaming": 4, "medium-streaming": 5}
        if isinstance(value, str) and value in known:
            return known[value]
        raise ValueError(f"Unknown model_arch {value!r}")

    @staticmethod
    def normalize_language(lang: str | None) -> str:
        code = (lang or "es").strip().lower().split("-")[0]
        if code not in _Plugin.LANGUAGES:
            raise ValueError(f"Idioma no admitido: {code}")
        return code


def _manager(**env: str | None) -> stt.SttManager:
    """SttManager con motor de mentira y config de config.toml vacía."""
    for key in ("PHOSON_STT_MODEL_ARCH", "PHOSON_STT_LANGUAGE"):
        os.environ.pop(key, None)
    for key, value in env.items():
        if value is not None:
            os.environ[key] = value
    stt._plugin_config_cache = {}  # sin config.toml: solo manda el entorno
    manager = stt.SttManager(lambda _m, _p: None)
    manager._plugin = lambda: _Plugin
    return manager


async def _dictate(manager: stt.SttManager, key: str, language: str | None) -> dict[str, Any]:
    """Arranca la captura, lee el estado y la detiene (no deja hilos colgados)."""
    started = await manager.start(key, language)
    await asyncio.sleep(0)
    status = manager.status()
    await manager.stop(key)
    return {**started, "_status": status}


# 1) Sin configuración: modelo default de la librería, motor operativo.
manager = _manager()
engine, reason = manager._engine()
status = manager.status()
_check(
    "sin configuración usa el modelo de la librería",
    engine is not None
    and reason is None
    and _Plugin.seen[-1] is None
    and status["modelArch"] is None
    and status["modelName"] is None,
    str(status),
)

# 2) PHOSON_STT_MODEL_ARCH llega al motor y se reporta a la UI.
manager = _manager(PHOSON_STT_MODEL_ARCH="medium-streaming")
engine, reason = manager._engine()
status = manager.status()
_check(
    "PHOSON_STT_MODEL_ARCH se propaga al motor",
    engine is not None and engine.model_arch == 5,
    str(reason),
)
_check(
    "stt.status reporta el modelo en uso",
    status["supported"] and status["modelArch"] == 5 and status["modelName"] == "medium_streaming",
    str(status),
)

# 3) config.toml gana al entorno (la misma precedencia que la CLI del engine).
manager = _manager(PHOSON_STT_MODEL_ARCH="base")
stt._plugin_config_cache = {"model_arch": "tiny"}
engine, _ = manager._engine()
_check(
    "config.toml gana a PHOSON_STT_MODEL_ARCH",
    engine is not None and engine.model_arch == 0,
    str(manager._model_arch),
)

# 4) Un valor inválido no tumba el sidecar: lo dice y nombra la fuente.
manager = _manager(PHOSON_STT_MODEL_ARCH="no-existe")
engine, reason = manager._engine()
_check(
    "arch inválida => supported false con motivo accionable",
    engine is None
    and reason is not None
    and "PHOSON_STT_MODEL_ARCH" in reason
    and "medium-streaming" in reason,
    str(reason),
)

# 5) Idioma: manda el del UI, luego el configurado, y un idioma unknown no captura.
loop_result = asyncio.run(_dictate(_manager(), "s1", "en"))
_check(
    "stt.start respeta el idioma del UI",
    loop_result.get("ok") and loop_result.get("language") == "en",
    str(loop_result),
)

loop_result = asyncio.run(_dictate(_manager(PHOSON_STT_LANGUAGE="zh"), "s2", None))
_check(
    "sin idioma del UI usa PHOSON_STT_LANGUAGE",
    loop_result.get("language") == "zh" and loop_result["_status"]["language"] == "zh",
    str(loop_result),
)

loop_result = asyncio.run(_dictate(_manager(), "s3", "fr"))
_check(
    "idioma no admitido => error accionable y sin captura",
    loop_result.get("ok") is False and "fr" in str(loop_result.get("reason")),
    str(loop_result),
)

for key in ("PHOSON_STT_MODEL_ARCH", "PHOSON_STT_LANGUAGE"):
    os.environ.pop(key, None)
stt._plugin_config_cache = None

print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)
