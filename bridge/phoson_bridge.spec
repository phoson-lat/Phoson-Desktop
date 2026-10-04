# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec del sidecar `phoson-bridge` (Phoson Desktop).

Build (desde la raíz del repo, con el venv del engine activo):

    cd <Phoson-Desktop>
    scripts/build-sidecar.sh            # multiplataforma, detecta el triple

o directamente:

    cd <phoson-engine-minimal>
    PHOSON_ENGINE_DIR=$PWD .venv/bin/pyinstaller \\
        --distpath <out> <Phoson-Desktop>/bridge/phoson_bridge.spec

Qué hace además de un build del entry-point (`phoson_bridge/__main__.py`):

1. **Plugins del engine**: `bgjobs`, `monitor`, `checkpoint`, `mcp`, `stt`,
   `swarm`. El loader de plugins usa `importlib`, invisible al análisis
   estático, así que se recolectan como submodules.
2. **Dependencias nativas de STT**: `moonshine_voice` trae `libmoonshine.so` +
   `libonnxruntime-*.so.1` en un directorio hermano `.libs` que se resuelve por
   RPATH relativo (`$ORIGIN/../moonshine_voice.libs`), así que se replica esa
   estructura exacta en el bundle. `sounddevice` usa cffi/`_sounddevice`.
3. **SDKs de proveedor** que se importan de forma perezosa.

Salida: un único ejecutable `phoson-bridge` (onefile) apto para `externalBin`
de Tauri (que espera `binaries/phoson-bridge-<target-triple>`).
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)

ROOT = Path(SPECPATH)  # .../bridge
ENGINE = Path(os.environ.get("PHOSON_ENGINE_DIR", ROOT.parent.parent / "phoson-engine-minimal"))

DIST_NAME = "phoson-bridge"


def _subs(pkg: str) -> list[str]:
    try:
        return collect_submodules(pkg)
    except Exception:  # noqa: BLE001 — el extra no está en el entorno de build
        return []


# ── Hidden imports ──────────────────────────────────────────────────────────
HIDDEN_IMPORTS: list[str] = []

# First-party: cargados por importlib (loader de plugins) → invisibles al análisis.
for pkg in (
    "phoson_agent",
    "phoson_llm",
    "phoson_cli",
    "phoson_plugin_bgjobs",
    "phoson_plugin_monitor",
    "phoson_plugin_checkpoint",
    "phoson_plugin_mcp",
    "phoson_plugin_stt",
    "phoson_plugin_swarm",
    "phoson_plugin_peers",
):
    HIDDEN_IMPORTS += _subs(pkg)

# Terceros: proveedores + extras de los plugins.
for pkg in (
    "anthropic",
    "openai",
    "httpx",
    "tiktoken",
    "rich",
    "prompt_toolkit",
    "google.genai",
    "mistralai",
    "boto3",
    "botocore",
    "mcp",
    "asyncpg",
    "moonshine_voice",
    "sounddevice",
    "cffi",
    # tiktoken carga sus encodings como plugin (namespace package); sin esto,
    # `tiktoken.get_encoding("cl100k_base")` falla en el binario congelado.
    "tiktoken_ext",
):
    HIDDEN_IMPORTS += _subs(pkg)

# Extensiones cargadas dinámicamente que el análisis a veces no ve.
HIDDEN_IMPORTS += ["sounddevice", "_sounddevice", "_cffi_backend", "tiktoken_ext.openai_public"]

# ── Datos y bibliotecas nativas ─────────────────────────────────────────────
DATAS: list[tuple[str, str]] = []
BINARIES: list[tuple[str, str]] = []

# Assets y libs nativas: **best-effort** por paquete. En plataformas sin wheel
# de Moonshine (p. ej. macOS) el sidecar se construye sin STT y el plugin lo
# degrada con un aviso.
def _safe_data(pkg: str) -> list:
    try:
        return collect_data_files(pkg)
    except Exception:  # noqa: BLE001 — paquete opcional ausente
        return []


def _safe_libs(pkg: str) -> list:
    try:
        return collect_dynamic_libs(pkg)
    except Exception:  # noqa: BLE001 — paquete opcional ausente
        return []


DATAS += _safe_data("moonshine_voice")  # wav de ejemplo, embeddings, tiny-en…
DATAS += _safe_data("phoson_cli")  # banner phos-ascii.txt
DATAS += _safe_data("mcp")
DATAS += _safe_data("asyncpg")

# libmoonshine.so (destino: moonshine_voice/).
BINARIES += _safe_libs("moonshine_voice")
BINARIES += _safe_libs("sounddevice")

# Onnxruntime vive en el directorio HERMANO `moonshine_voice.libs`, que el
# loader de libmoonshine.so busca por RPATH relativo. Se replica esa ruta.
try:
    import moonshine_voice  # noqa: PLC0415 — solo para localizar el paquete

    libs_dir = Path(moonshine_voice.__file__).parent.parent / "moonshine_voice.libs"
    if libs_dir.is_dir():
        for lib in libs_dir.glob("*.so*"):
            BINARIES.append((str(lib), "moonshine_voice.libs"))
except Exception:  # noqa: BLE001
    pass

# ── Análisis / build ────────────────────────────────────────────────────────
a = Analysis(
    [str(ROOT / "phoson_bridge" / "__main__.py")],
    pathex=[str(ROOT), str(ENGINE)],
    binaries=BINARIES,
    datas=DATAS,
    hiddenimports=HIDDEN_IMPORTS,
    hookspath=[],
    runtime_hooks=[],
    # Fuera del alcance del sidecar (reduce tamaño y evita falsos positivos).
    excludes=["tkinter", "matplotlib", "PIL", "pytest", "IPython", "notebook"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=DIST_NAME,
    debug=False,
    strip=False,
    upx=False,
    console=True,
    # Sin ventana ni splash: es un proceso de protocolo por stdio.
)
