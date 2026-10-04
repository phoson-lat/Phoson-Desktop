# Distribución de Phoson Desktop

Guía del **camino B**: empaquetar el sidecar con PyInstaller, firmar la app y
entregar actualizaciones.

## 1. Sidecar empaquetado (PyInstaller)

El sidecar (`bridge/`) se compila a un único ejecutable que Tauri mete en el
bundle como `externalBin`. Dentro van estos plugins del engine: **bgjobs,
monitor, checkpoint, mcp, stt, swarm, peers** (los del paquete base; los demás
aportan `mcp`, `asyncpg` y `moonshine-voice`).

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

## 2. Firma

### Updater (obligatoria para `createUpdaterArtifacts`)

```bash
pnpm tauri signer generate -w ~/.tauri/phoson-desktop.key
# imprime/guarda la clave PÚBLICA (~/.tauri/phoson-desktop.key.pub)
```

Estado actual:
- La clave pública **ya está** en `src-tauri/tauri.conf.json` →
  `plugins.updater.pubkey` (par generado el 2026-10-04).
- La clave **privada** vive **fuera del repo**: `~/.tauri/phoson-desktop.key`
  (generada sin password). **No se versiona.**

En CI (GitHub Actions → *Settings → Secrets and variables → Actions*), añade:
- `TAURI_SIGNING_PRIVATE_KEY` — contenido del fichero
  `~/.tauri/phoson-desktop.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — vacío si la clave no tiene password.

> ⚠️ Si pierdes la clave privada, no podrás firmar actualizaciones futuras y los
> clientes instalarán una versión que ya no se puede actualizar. Guárdala en un
> gestor de secretos.

### Firma de los instaladores (pendiente de credenciales)

- **Windows**: Authenticode (`signtool` o Azure Trusted Signing) →
  `bundle.windows.certificateThumbprint` / variables `WINDOWS_CERTIFICATE*`.
- **macOS**: Developer ID + notarización (`APPLE_CERTIFICATE`,
  `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_PASSWORD`).

La firma de instaladores sigue **pendiente**; la app funciona sin ella (con el
aviso de "origen desconocido" del SO). El updater **sí** queda operativo con la
clave de arriba.

## 3. Updater — solución elegida

**Plugin oficial de Tauri + feed estático `latest.json`**, servido desde GitHub
Releases (o cualquier host HTTPS). Motivos: sin backend ni servidor propio,
multiplataforma, artefactos **firmados y verificados** con la clave del updater,
y diff-friendly con el pipeline de releases existente.

Configuración: `src-tauri/tauri.conf.json` → `plugins.updater.endpoints`.

- GitHub Releases (**elegido**):
  `https://github.com/phoson-lat/Phoson-Desktop/releases/latest/download/latest.json`
- Host propio (alternativa): `https://releases.phoson.lat/{{target}}/{{arch}}/{{current_version}}`

El `latest.json` lo **genera y fusiona `tauri-action`** por plataforma al crear el
release; no hay que escribirlo a mano. Ejemplo de formato:

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

## 5. CI

Ya implementada en `.github/workflows/`:

- **`ci.yml`** — en cada push/PR: typecheck + build del frontend, `cargo check`
  de `src-tauri` y `py_compile` del bridge.
- **`release.yml`** — en push de un tag `v*` (o a mano): matrix
  `ubuntu-22.04` / `windows-latest` / `macos-13` / `macos-14`; en cada runner
  clona el engine (`v0.49.1`), crea su venv, compila **su** sidecar y corre
  `tauri-action` (build de release firmado + release con bundles y `latest.json`).

Para publicar un alpha:

```bash
git tag v0.1.0-alpha.1 && git push origin v0.1.0-alpha.1
```

Requiere los secretos `TAURI_SIGNING_PRIVATE_KEY` y
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (ver §2). El release sale como **draft +
prerelease**: revísalo y publícalo para que el updater (`releases/latest`) lo vea.
