# Contributing

Thanks for helping! Phoson Desktop is MIT-licensed (see `LICENSE`).

## Dev setup

Requirements: **Node ≥ 20 + pnpm**, **Rust (Tauri v2 prerequisites)**,
**Python 3.12** with the sibling engine
[`phoson-engine-minimal`](https://github.com/phoson-lat/phoson-engine-minimal).

```bash
# 1. engine venv (editable) — la app lo usa en desarrollo
git clone https://github.com/phoson-lat/phoson-engine-minimal ../phoson-engine-minimal
cd ../phoson-engine-minimal && python -m venv .venv && .venv/bin/pip install -e ".[bundle]"
# Windows: la misma línea con .venv\Scripts\pip.exe, o con uv:
#   uv venv && uv pip install -e ".[bundle]"

# 2. app
cd ../Phoson-Desktop
pnpm install
export PHOSON_ENGINE_DIR=../phoson-engine-minimal   # si no está al lado
pnpm tauri dev
```

El extra `bundle` **no es opcional si quieres dictar por voz**: trae
`moonshine-voice` + `sounddevice`. Un venv creado con `uv sync` a secas (sin
`--extra stt`) arranca la app sin errores, pero `stt.status` devuelve
`supported: false` y el botón del micrófono queda deshabilitado con el aviso
*"El runtime de dictado (moonshine-voice) no está instalado"*. La primera
captura de cada idioma baja además el modelo de Moonshine (≈15 s, cacheado
después en `%LOCALAPPDATA%\moonshine_voice` en Windows, `~/.cache/moonshine_voice`
en Linux/macOS).

In development the sidecar runs as `python -m phoson_bridge` (no binary needed).

## Voice dictation (STT)

Model and language are resolved by the same chain the engine CLI uses, and the
result is reported to the UI (`stt.status` → `modelArch` / `modelName`, shown in
the mic button tooltip):

1. the `stt` plugin section of `config.toml` (`model_arch` / `language`),
2. else `PHOSON_STT_MODEL_ARCH` / `PHOSON_STT_LANGUAGE`,
3. else Moonshine's default for the language (`small-streaming` for `es`).

`PHOSON_STT_MODEL_ARCH` takes a name (`tiny`, `base`, `tiny-streaming`,
`base-streaming`, `small-streaming`, `medium-streaming`) or its number (0–5);
a bad value leaves dictation disabled with a message that says what to fix.
The language the UI sends on `stt.start` wins over all three, so dictation
follows the **interface language** — the one resolved in `src/lib/locale.ts`
(your choice in Settings → Appearance, else the OS/webview, see
[Localization](#localization-i18n)); `es-MX` → `es`. If it maps to nothing
Moonshine knows, the configured language is used instead.

Two mic-free diagnostics, useful on a packaged build:

```bash
phoson-bridge --stt-check                  # JSON status, exit 0/1 (no microphone)
phoson-bridge --stt-transcribe talk.wav es # transcribes a WAV (no PortAudio needed)
```

`--stt-transcribe` goes through the same Moonshine runtime as the microphone, so
it is the check that a frozen bundle is really able to dictate.

## Notificaciones nativas

Las envía **Rust** (`src-tauri/src/notify.rs`), no el webview: cada sistema
necesita una API distinta y el clic debe traer la ventana al frente.

| Plataforma | API | Notas |
|---|---|---|
| macOS | `UNUserNotificationCenter` (`mac-usernotifications`) | **Requiere bundle** `.app` con `CFBundleIdentifier` y firma válida (ad-hoc basta), lanzado por LaunchServices. En `tauri dev` el proceso no está empaquetado y las notificaciones no existen: se registra un `[notify] …` en stderr. Para probar en macOS: `pnpm tauri build --debug --bundles app`, copia el `.app` a `~/Applications` y ábrelo con `open`. |
| Linux | D-Bus `org.freedesktop.Notifications` (`notify-rust`) | Necesita un daemon (GNOME/KDE/dunst) accesible en la sesión. La acción «Mostrar Phoson» abre la ventana. |
| Windows | Toast de WinRT (`tauri-plugin-notification`) | Único sitio donde sigue usándose el plugin. |

El **primer arranque** en macOS pide permiso (diálogo del sistema). Si el
usuario lo deniega, se apaga el aviso nativo hasta que lo reactive en Ajustes
del Sistema → Notificaciones.

Quién no debe interrumpir: el front pregunta `app_in_foreground` (visible **y**
con foco, sin minimizar). No se usa `document.hasFocus()` porque el webview
conserva el foco lógico al ocultarse la ventana a la bandeja.

## Building the sidecar binary

```bash
scripts/build-sidecar.sh        # PyInstaller onedir → src-tauri/binaries/phoson-bridge/
```

- **On Windows run it from Git Bash, not WSL**: WSL's Linux Python/uname
  produce a Linux binary that won't run on Windows.
- After building, the script runs `--stt-check` and dictates one of Moonshine's
  sample WAVs with the built binary. A missing STT runtime is a warning, not a
  failure: platforms without a Moonshine wheel (e.g. macOS x86_64) must still
  ship.
- `bridge/phoson_bridge.spec` has to declare PortAudio by hand: on Windows the
  DLL is a *data file* of the sibling package `_sounddevice_data/`, invisible to
  PyInstaller's static analysis, so a bundle without it answers RPC but fails to
  open the microphone.
- The tree is bundled as `bundle.resources` (see `DISTRIBUTION.md` §1): onedir
  instead of onefile because onefile re-extracts at every launch and macOS
  re-signature-validation made the bridge take ~10 s to boot.
- `.gitattributes` pins `*.sh` to LF; a CRLF shell script does not run under Git
  Bash.

## Checks before a PR

```bash
pnpm build                    # tsc + vite build
pnpm check:i18n               # locale parity + untranslated UI strings
cd src-tauri && cargo check && cd ..
python -m py_compile bridge/phoson_bridge/*.py
python bridge/tests/smoke.py            # y el resto de bridge/tests/*.py
```

CI (`.github/workflows/ci.yml`) runs these on every push/PR.

## Iconos de la bandeja (tray)

El icono de la bandeja **no** es el icono de la app: cada plataforma dibuja la
bandeja distinto y el icono de 512 px con fondo blanco se ve como un parche en
la barra de menús de macOS.

- `src-tauri/icons/tray/tray-template.png` — macOS: *template image*
  monocroma (negro + alfa), 36x36 px (18 pt @2x). Se carga con
  `icon_as_template(true)` y el sistema la recolorea según el tema.
- `src-tauri/icons/tray/tray.png` — Windows y Linux: glifo de 32x32 px sobre
  disco blanco (contraste en barras claras y oscuras).

Ambos se generan con `python3 scripts/gen-tray-icons.py` (requiere Pillow) a
partir de la geometría de `public/icon.svg`; hay que regenerarlos si cambia la
marca y commitear los PNG resultantes. El tamaño y la plantilla se aplican en
`setup_tray` (`src-tauri/src/main.rs`).

## Localization (i18n)

The UI runs on `i18next` + `react-i18next`. **`src/locales/es/*.json` is the
source of truth**; `en/` mirrors it key by key.

- **Where keys live** — one JSON file per namespace (`common`, `chrome`, `chat`,
  `welcome`, `onboarding`, `palette`, `settings`, `system`, `tools`) under
  `src/locales/<locale>/`. `src/locales/<locale>/index.ts` aggregates them and
  `src/lib/i18n.ts` bundles every namespace: no backend, no lazy loading, so
  `t()` is synchronous and no component paints a raw key for a frame.
- **In components** — `const { t } = useTranslation("settings")` picks the
  namespace, `t("appearance.language")` the key. Plurals use the i18next v4
  suffixes with a `count` (`t("x.files", { count })` → `files_one` /
  `files_other`).
- **Typed keys** — `src/i18n.d.ts` derives the key union from the `es` tree, so a
  typo'd key or a wrong namespace is a **`tsc` error**, never a raw string in the
  UI. `en` is deliberately untyped; the script below checks its parity.
- **Language resolution** (`src/lib/locale.ts`) — an explicit choice in
  `localStorage` (`phoson.locale`, set from **Settings → Appearance**) always
  wins; otherwise the OS locale (`system_locale` Rust command), then
  `navigator.languages`, then `en`. The OS step is not redundant: on macOS the
  webview of an unlocalized app reports `en` even on a Spanish Mac. The resolved
  locale also drives `<html lang>` and the dictation tag (`speechLocale`: Web
  Speech `lang` and the sidecar's `stt.start`), which never falls back to a
  *different* language — dictating in the wrong one transcribes gibberish.
- **Native labels** — the tray menu and its notice are drawn by Rust, where
  i18next cannot reach; `src/lib/native-labels.ts` pushes the translated labels
  through `set_native_labels` and re-syncs on `languageChanged`.

```bash
pnpm check:i18n             # key parity + placeholders + leftover Spanish
pnpm check:i18n -- --list   # also prints every suspicious literal
```

`scripts/check-i18n.mjs` **fails** (exit 1) when a namespace file is missing on
one side, when `en` lacks a key that `es` has (or carries an extra one), or when
an interpolation placeholder differs between the two languages — the last one
leaves a sentence lopsided in runtime and typing cannot see it. Plural suffixes
are folded into one logical key (`foo_one` / `foo_other` → `foo_#`), so adding a
plural form does not read as a new key.

It also *warns* about Spanish-looking literals left in the JSX, with two
intentional escapes:

- comments and diagnostic logs (`console.*`, `logError`, `logWarn`, `logInfo`,
  `logDebug`) are skipped — those are in **Spanish** by convention;
- a line that must stay as it is gets an `i18n-ignore: <reason>` comment (a
  language name is written in its own language):

  ```tsx
  { id: "es", label: "Español" }, // i18n-ignore: cada idioma en su idioma
  ```

**Adding a language** touches, in order: `src/locales/<lng>/` (copy `es/`,
translate, `index.ts` included), the `resources` map in `src/lib/i18n.ts`,
`SUPPORTED_LOCALES` / `htmlLang` / `SPEECH_TAGS` in `src/lib/locale.ts`,
`LOCALE_DIRS` in `scripts/check-i18n.mjs`, and the options in the language
selector of `src/features/settings-dialog.tsx`. Rust needs no change: it reports
the OS locale and renders whatever labels the UI hands it.

## Style

- Match the surrounding code; comments in **Spanish** (codebase convention).
- Keep commits focused; reference the area in the subject
  (e.g. `fix(ui):`, `feat(perf):`, `chore(release):`).
- Write commit messages and PR titles/descriptions in **English** (issue
  discussion and code comments stay in Spanish).
- Don't commit secrets or signing keys (`.gitignore` already excludes `*.key`).

## Releasing

Maintainers only. See `RELEASE.md` and `DISTRIBUTION.md`. Tag pattern `v*`
triggers the cross-platform release workflow.
