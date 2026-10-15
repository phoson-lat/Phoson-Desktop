#!/usr/bin/env bash
#
# Construye el sidecar `phoson-bridge` con PyInstaller (onedir) y lo deja listo
# para empaquetarlo como recurso del bundle de Tauri, con los plugins:
# bgjobs, monitor, checkpoint, mcp, stt, swarm y peers.
#
#   scripts/build-sidecar.sh
#
# Variables:
#   PHOSON_ENGINE_DIR      ruta del engine (por defecto ../phoson-engine-minimal)
#
# La salida es `src-tauri/binaries/phoson-bridge/` (árbol onedir:
# ejecutable + libs), que `tauri.release.conf.json` declara como
# `bundle.resources` (map: `binaries/phoson-bridge` → `phoson-bridge`).
#
# ¿Por qué onedir y no onefile? El onefile re-extrae ~100 MB a un directorio
# temporal en CADA arranque: macOS valida la firma de cada `.so` recién
# extraído (vnode nuevo, sin caché de kernel) y el sidecar tardaba ~10 s en
# responder la primera RPC. Con onedir los archivos quedan dentro del bundle y
# solo el PRIMER arranque tras instalar paga esa validación (~10 s); los
# siguientes arrancan en ~0.2 s. Ver PERF.md §6.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="${PHOSON_ENGINE_DIR:-$HERE/../phoson-engine-minimal}"
BRIDGE_DIR="$HERE/bridge"
OUT_DIR="$HERE/src-tauri/binaries"
WORK_DIR="$HERE/build/pyinstaller"

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
echo "==> Salida:   $OUT_DIR/phoson-bridge/ (onedir)"

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

# 2) Build (onedir): el COLLECT del spec deja el árbol en `$OUT_DIR/phoson-bridge/`.
EXT=""
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) EXT=".exe" ;;
esac
mkdir -p "$OUT_DIR" "$WORK_DIR"
rm -rf "$OUT_DIR/phoson-bridge"
(
  cd "$ENGINE_DIR"
  PHOSON_ENGINE_DIR="$ENGINE_DIR" "$PY" -m PyInstaller \
    --clean --noconfirm \
    --distpath "$OUT_DIR" \
    --workpath "$WORK_DIR" \
    "$BRIDGE_DIR/phoson_bridge.spec"
)
test -f "$OUT_DIR/phoson-bridge/phoson-bridge$EXT" || {
  echo "error: el build no produjo $OUT_DIR/phoson-bridge/phoson-bridge$EXT" >&2
  exit 1
}

# 3) Verificación del dictado: un congelado sin el runtime de voz responde igual y
#    la UI solo muestra "no soportado", así que se comprueba aquí, con el propio
#    binario (`--stt-check` imprime el estado de STT y sale 0/1). No es fatal: en
#    macOS x86_64 no hay wheel de Moonshine y el build debe seguir sirviendo.
BIN="$OUT_DIR/phoson-bridge/phoson-bridge$EXT"
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

echo "==> Listo: $OUT_DIR/phoson-bridge/"
echo "    Build de release:  pnpm tauri build --config src-tauri/tauri.release.conf.json"
echo "    (en dev no hace falta el binario: el sidecar cae al fallback de Python)"
