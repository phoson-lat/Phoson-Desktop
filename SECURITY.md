# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Email: **security@phoson.lat** (or the maintainer's address in `README`/`LICENSE`).
- Include: affected version(s), platform, steps to reproduce, and impact.
- We aim to acknowledge within **72 hours** and to ship a fix (and, if needed, a
  signed update) as soon as practical.

## Scope

In scope:
- The desktop app (`src/`, `src-tauri/`), the Python sidecar (`bridge/`).
- The update mechanism: verification of signed releases.

Out of scope (report upstream):
- The engine (`phoson-engine-minimal`) and its plugins.
- Third-party model providers (OpenAI, Anthropic, OpenRouter, …).

## Release signing

Official releases are built by CI (`.github/workflows/release.yml`) and signed
with the Tauri updater key. The app only accepts updates whose signature matches
the public key embedded in `src-tauri/tauri.conf.json`.

The **private signing key is never in this repository** and is not distributed;
it is held in a secret manager. If you find any signing material committed to
the repo or a release, treat it as a security incident and report it as above.
