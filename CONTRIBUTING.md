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

# 2. app
cd ../Phoson-Desktop
pnpm install
export PHOSON_ENGINE_DIR=../phoson-engine-minimal   # si no está al lado
pnpm tauri dev
```

In development the sidecar runs as `python -m phoson_bridge` (no binary needed).

## Checks before a PR

```bash
pnpm build                    # tsc + vite build
cd src-tauri && cargo check && cd ..
python -m py_compile bridge/phoson_bridge/*.py
```

CI (`.github/workflows/ci.yml`) runs these on every push/PR.

## Style

- Match the surrounding code; comments in **Spanish** (codebase convention).
- Keep commits focused; reference the area in the subject
  (e.g. `fix(ui):`, `feat(perf):`, `chore(release):`).
- Don't commit secrets or signing keys (`.gitignore` already excludes `*.key`).

## Releasing

Maintainers only. See `RELEASE.md` and `DISTRIBUTION.md`. Tag pattern `v*`
triggers the cross-platform release workflow.
