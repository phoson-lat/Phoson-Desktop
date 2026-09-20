# Distribución de Phoson Desktop

Guía del **camino B**: empaquetar el sidecar con PyInstaller, firmar la app y
entregar actualizaciones.

## 1. Sidecar empaquetado (PyInstaller)

El sidecar (`bridge/`) se compila a un único ejecutable que Tauri mete en el
bundle como `externalBin`. Dentro van estos plugins del engine: **bgjobs,
monitor, checkpoint, mcp, stt, swarm** (los dos primeros y swarm ya vienen en el
paquete base; los demás aportan `mcp`, `asyncpg` y `moonshine-voice`).

```bash
scripts/build-sidecar.sh          # detecta el triple de Rust del host
```

- Entrada: `bridge/phoson_bridge.spec` (recolecta submodules de los plugins,
  los assets y las libs nativas de Moonshine — `libmoonshine.so` +
  `moonshine_voice.libs/libonnxruntime-*.so.1`, replicando el RPATH relativo).
- Salida: `src-tauri/binaries/phoson-bridge-<target-triple>` (~94 MB en Linux;
  onefile).
- Variables: `PHOSON_ENGINE_DIR` (venv con el engine + extras) y
  `PHOSON_TARGET_TRIPLE`.

El binario se declara como `bundle.externalBin` **solo en la config de
release** (`src-tauri/tauri.release.conf.json`), de modo que en desarrollo
`cargo check` / `pnpm tauri dev` no exigen el binario y el sidecar cae al
fallback de Python. Los binarios **no se versionan** (`.gitignore`); se generan
por plataforma en CI.

> Cross-compile: PyInstaller **no** cross-compila. Cada plataforma se construye
> en su runner (matrix de GitHub Actions con `ubuntu/windows/macos`).

## 2. Firma (placeholders)

### Updater (obligatoria para `createUpdaterArtifacts`)

```bash
pnpm tauri signer generate -w ~/.tauri/phoson.key
# imprime la clave PÚBLICA → pégala en tauri.conf.json → plugins.updater.pubkey
```

En CI:
`TAURI_SIGNING_PRIVATE_KEY` (contenido o ruta de la clave) y
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Firma de los instaladores (pendiente de credenciales)

- **Windows**: Authenticode (`signtool` o Azure Trusted Signing) →
  `bundle.windows.certificateThumbprint` / variables `WINDOWS_CERTIFICATE*`.
- **macOS**: Developer ID + notarización (`APPLE_CERTIFICATE`,
  `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`).

De momento `pubkey` y la firma de instaladores son **placeholders**; la app
funciona en local sin ellas. `tauri build` con `createUpdaterArtifacts: true`
exige la clave del updater.

## 3. Updater — solución elegida

**Plugin oficial de Tauri + feed estático `latest.json`**, servido desde GitHub
Releases (o cualquier host HTTPS). Motivos: sin backend ni servidor propio,
multiplataforma, artefactos **firmados y verificados** con la clave del updater,
y diff-friendly con el pipeline de releases existente.

Configuración: `src-tauri/tauri.conf.json` → `plugins.updater.endpoints`.

- GitHub Releases (recomendado):
  `https://github.com/<org>/<repo>/releases/latest/download/latest.json`
- Host propio (placeholder actual): `https://releases.phoson.lat/{{target}}/{{arch}}/{{current_version}}`

Ejemplo de `latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "Novedades…",
  "pub_date": "2026-09-20T12:00:00Z",
  "platforms": {
    "linux-x86_64": { "signature": "…", "url": "https://…/Phoson.Desktop_0.2.0_amd64.AppImage" },
    "windows-x86_64": { "signature": "…", "url": "https://…/Phoson.Desktop_0.2.0_x64-setup.exe" },
    "darwin-aarch64": { "signature": "…", "url": "https://…/Phoson.Desktop_0.2.0_aarch64.app.tar.gz" }
  }
}
```

## 4. Build completo

```bash
scripts/build-sidecar.sh
pnpm tauri build --config src-tauri/tauri.release.conf.json   # requiere TAURI_SIGNING_PRIVATE_KEY
```

La UI de actualizaciones vive en **Ajustes → Acerca de** (`src/lib/updater.ts`).
En modo demo (navegador) se degrada a no-op.

## 5. CI sugerida

1. `pnpm install && scripts/build-sidecar.sh` (cada SO).
2. `pnpm tauri build` con los secretos de firma/updater.
3. Publicar instaladores + `latest.json` (GitHub Release) — el formato de
   `latest.json` para GitHub Releases lo genera `tauri action`/`tauri-action`.
