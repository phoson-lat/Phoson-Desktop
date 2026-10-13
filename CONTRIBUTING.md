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
The language the UI sends on `stt.start` wins over all three, so the app follows
the interface language (`es-MX` → `es`); if it maps to nothing Moonshine knows,
the configured language is used instead.

Two mic-free diagnostics, useful on a packaged build:

```bash
phoson-bridge --stt-check                  # JSON status, exit 0/1 (no microphone)
phoson-bridge --stt-transcribe talk.wav es # transcribes a WAV (no PortAudio needed)
```

`--stt-transcribe` goes through the same Moonshine runtime as the microphone, so
it is the check that a frozen bundle is really able to dictate.

## Building the sidecar binary

```bash
scripts/build-sidecar.sh        # PyInstaller onefile → src-tauri/binaries/
```

- **On Windows run it from Git Bash, not WSL**: WSL's Linux `rustc`/`uname`
  produce the wrong target triple and a Linux binary. The script also strips CR
  from `rustc -vV`, whose Windows output carries `\r` (a trailing CR makes Tauri
  unable to find `phoson-bridge-<triple>.exe`). `PHOSON_TARGET_TRIPLE` forces it.
- After building, the script runs `--stt-check` and dictates one of Moonshine's
  sample WAVs with the built binary. A missing STT runtime is a warning, not a
  failure: platforms without a Moonshine wheel (e.g. macOS x86_64) must still
  ship.
- `bridge/phoson_bridge.spec` has to declare PortAudio by hand: on Windows the
  DLL is a *data file* of the sibling package `_sounddevice_data/`, invisible to
  PyInstaller's static analysis, so a bundle without it answers RPC but fails to
  open the microphone.
- `.gitattributes` pins `*.sh` to LF; a CRLF shell script does not run under Git
  Bash.

## Checks before a PR

```bash
pnpm build                    # tsc + vite build
cd src-tauri && cargo check && cd ..
python -m py_compile bridge/phoson_bridge/*.py
python bridge/tests/smoke.py            # y el resto de bridge/tests/*.py
```

CI (`.github/workflows/ci.yml`) runs these on every push/PR.

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
