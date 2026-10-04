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

TRIPLE="${PHOSON_TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')}"
if [ -z "$TRIPLE" ]; then
  echo "error: no se pudo determinar el triple de Rust (¿rustc en PATH?)" >&2
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
echo "==> Instalando PyInstaller y extras de plugins (mcp, checkpoint, stt)…"
install_pkgs pyinstaller
install_pkgs "moonshine-voice>=0.1.5" "mcp>=1.0.0,<2.0.0" "asyncpg>=0.29.0"

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

echo "==> Listo: $OUT_DIR/phoson-bridge-$TRIPLE$EXT"
echo "    Build de release:  pnpm tauri build --config src-tauri/tauri.release.conf.json"
echo "    (en dev no hace falta el binario: el sidecar cae al fallback de Python)"
