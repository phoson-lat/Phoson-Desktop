#!/usr/bin/env bash
#
# Construye el sidecar `phoson-bridge` con PyInstaller y lo deja listo como
# `externalBin` de Tauri (uno por plataforma), con los plugins:
# bgjobs, monitor, checkpoint, mcp, stt, swarm y peers.
#
#   scripts/build-sidecar.sh
#
# Variables:
#   PHOSON_ENGINE_DIR      ruta del engine (por defecto ../phoson-engine-minimal)
#   PHOSON_TARGET_TRIPLE   fuerza el triple de Rust (por defecto, el host)
#
# La salida es `src-tauri/binaries/phoson-bridge-<triple>` (Tauri añade/espera
# el sufijo del triple y renombra a `phoson-bridge` dentro del bundle).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="${PHOSON_ENGINE_DIR:-$HERE/../phoson-engine-minimal}"
BRIDGE_DIR="$HERE/bridge"
OUT_DIR="$HERE/src-tauri/binaries"
WORK_DIR="$HERE/build/pyinstaller"

# Triple de Rust = nombre que Tauri espera en `binaries/phoson-bridge-<triple>`.
# OJO en Windows: `rustc` es un .exe y su salida puede traer CR; sin limpiarlo el
# archivo quedaría como `phoson-bridge-x86_64-pc-windows-msvc\r` y Tauri no lo ve.
TRIPLE="${PHOSON_TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')}"
TRIPLE="${TRIPLE//[$'\r\n' ]/}"

# Sin rustc en PATH (bash de login mínimo): se deduce del host.
if [ -z "$TRIPLE" ]; then
  case "$(uname -s):$(uname -m)" in
    Linux:x86_64)  TRIPLE=x86_64-unknown-linux-gnu ;;
    Linux:aarch64) TRIPLE=aarch64-unknown-linux-gnu ;;
    Darwin:x86_64) TRIPLE=x86_64-apple-darwin ;;
    Darwin:arm64)  TRIPLE=aarch64-apple-darwin ;;
    MINGW*:x86_64 | MSYS*:x86_64 | CYGWIN*:x86_64) TRIPLE=x86_64-pc-windows-msvc ;;
  esac
fi

if [ -z "$TRIPLE" ]; then
  echo "error: no se pudo determinar el triple (¿rustc en PATH? en Windows usa Git Bash," >&2
  echo "       no WSL, o forza PHOSON_TARGET_TRIPLE=x86_64-pc-windows-msvc)" >&2
  exit 1
fi

# Intérprete del venv del engine (POSIX o Windows).
if [ -x "$ENGINE_DIR/.venv/bin/python" ]; then
  PY="$ENGINE_DIR/.venv/bin/python"
elif [ -x "$ENGINE_DIR/.venv/Scripts/python.exe" ]; then
  PY="$ENGINE_DIR/.venv/Scripts/python.exe"
else
  echo "error: no hay venv en $ENGINE_DIR/.venv" >&2
  exit 1
fi

echo "==> Engine:   $ENGINE_DIR"
echo "==> Triple:   $TRIPLE"
echo "==> Salida:   $OUT_DIR/phoson-bridge-$TRIPLE"

# 1) PyInstaller + extras de los plugins que van dentro del bundle.
install_pkgs() {
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$PY" "$@"
  else
    "$PY" -m pip install "$@"
  fi
}
echo "==> Instalando PyInstaller y extras de plugins…"
install_pkgs pyinstaller
install_pkgs "mcp>=1.0.0,<2.0.0" "asyncpg>=0.29.0"
# STT (Moonshine): trae wheels solo para algunas plataformas (en macOS x86_64 el
# engine ya lo omite) y arrastra numpy + sounddevice, que es el que abre el micro.
# Best-effort: si no está, el sidecar se construye sin dictado y el paso 4 lo dice.
if ! install_pkgs "moonshine-voice>=0.1.5" "sounddevice>=0.5.5"; then
  echo "==> AVISO: moonshine-voice no disponible aquí; se construye sin STT."
  install_pkgs "moonshine-voice" 2>/dev/null || true
fi

# 2) Build (onefile).
mkdir -p "$OUT_DIR" "$WORK_DIR"
rm -rf "$OUT_DIR/tmp"
(
  cd "$ENGINE_DIR"
  PHOSON_ENGINE_DIR="$ENGINE_DIR" "$PY" -m PyInstaller \
    --clean --noconfirm \
    --distpath "$OUT_DIR/tmp" \
    --workpath "$WORK_DIR" \
    "$BRIDGE_DIR/phoson_bridge.spec"
)

# 3) Renombra al esquema de Tauri.
EXT=""
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) EXT=".exe" ;;
esac
mv "$OUT_DIR/tmp/phoson-bridge$EXT" "$OUT_DIR/phoson-bridge-$TRIPLE$EXT"
rm -rf "$OUT_DIR/tmp"
chmod +x "$OUT_DIR/phoson-bridge-$TRIPLE$EXT" 2>/dev/null || true

# 4) Verificación del dictado: un congelado sin el runtime de voz responde igual y
#    la UI solo muestra "no soportado", así que se comprueba aquí, con el propio
#    binario (`--stt-check` imprime el estado de STT y sale 0/1). No es fatal: en
#    macOS x86_64 no hay wheel de Moonshine y el build debe seguir sirviendo.
BIN="$OUT_DIR/phoson-bridge-$TRIPLE$EXT"
STT_JSON="$WORK_DIR/stt-check.json"
echo "==> Comprobando el dictado dentro del binario…"
if "$BIN" --stt-check >"$STT_JSON" 2>/dev/null; then
  echo "    STT operativo: $(tr -d '\r\n\t ' <"$STT_JSON" | cut -c1-200)"
  # Y la prueba de fondo: Moonshine trae WAVs de ejemplo en el paquete. Dictar uno
  # con el binario congelado prueba onnxruntime, la descarga del modelo y el
  # empaquetado sin depender de un micrófono (ni de que nadie hable).
  SAMPLE="$("$PY" -c 'import os, moonshine_voice as m
p = os.path.join(os.path.dirname(m.__file__), "assets", "two_cities.wav")
print(p if os.path.isfile(p) else "")' 2>/dev/null || true)"
  if [ -n "$SAMPLE" ]; then
    echo "==> Dictando un WAV de ejemplo con el binario…"
    if "$BIN" --stt-transcribe "$SAMPLE" en >"$WORK_DIR/stt-transcribe.json" 2>/dev/null; then
      echo "    $(tr -d '\r\n\t ' <"$WORK_DIR/stt-transcribe.json" | cut -c1-160)"
    else
      echo "==> AVISO: el binario no dictó el WAV de ejemplo:"
      sed 's/^/    /' "$WORK_DIR/stt-transcribe.json"
      echo "    (revisa red/SSL para la descarga del modelo dentro del congelado)"
    fi
  fi
else
  echo "==> AVISO: este binario NO trae dictado operativo:"
  sed 's/^/    /' "$STT_JSON"
  echo "    (si es por falta de PortAudio en Linux: apt install libportaudio2)"
fi

echo "==> Listo: $OUT_DIR/phoson-bridge-$TRIPLE$EXT"
echo "    Build de release:  pnpm tauri build --config src-tauri/tauri.release.conf.json"
echo "    (en dev no hace falta el binario: el sidecar cae al fallback de Python)"
