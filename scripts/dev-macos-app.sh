#!/usr/bin/env bash
# Genera una app de desarrollo apta para UNUserNotificationCenter.
# El identificador separado evita mezclar firma y permisos con el release.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/debug/bundle/macos/Phoson Desktop.app"

cd "$ROOT"
pnpm tauri build --debug --bundles app --config '{"identifier":"lat.phoson.desktop.debug"}'

# `tauri build --debug` deja el ejecutable linker-signed, pero no sella el
# bundle. UNUserNotificationCenter necesita el .app completo y con Info.plist.
codesign --force --deep --sign - \
  --options runtime \
  --entitlements "$ROOT/src-tauri/entitlements.plist" \
  "$APP"
codesign --verify --deep --strict "$APP"
open "$APP"
