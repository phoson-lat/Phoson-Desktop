# AGENTS.md

Instrucciones para agentes de IA que trabajen en **Phoson Desktop** (y referencia
rápida para personas). El detalle de setup y checks está en `CONTRIBUTING.md`.

## Regla: toda contribución lleva descripción informativa — en inglés

Todo **commit**, **pull request** y **release** debe incluir una **descripción
informativa de lo que se hizo** (el título por sí solo no basta) y esa descripción
**debe estar en inglés**.

- **Commits** — además de la línea de asunto (`tipo(área): …`, en inglés), añade un
  **cuerpo** que explique *qué* cambia y *por qué* (el bug que corrige, la decisión
  que toma). Nada de commits “mudos” de una sola línea para cambios no triviales.
- **Pull requests** — rellena la descripción con: problema + causa raíz, cambios y
  **cómo se verificó** (comandos, tablas, capturas).
- **Releases** — las notas (`gh release edit --notes` / `releaseBody`) deben
  describir los cambios del release agrupados (highlights, fixes, notas de
  instalación), no un placeholder.

> Las *descripciones* (commit / PR / release) van en **inglés**. Los **comentarios
> de código** y la **documentación** del repo van en **español** (convención del
> repo, ver `CONTRIBUTING.md`).

### Ejemplo — commit

```
fix(macos): add entitlements so the PyInstaller sidecar loads under hardened runtime

Tauri signs the bundle with the hardened runtime, which enables library
validation: the ad-hoc signature has no Team ID, so the sidecar could not dlopen
the Python framework it extracts at startup (the app panicked on launch). Add
com.apple.security.cs.disable-library-validation so the sidecar can load it.
```

### Ejemplo — PR / release

Problema, causa raíz, cambios y verificación. Las notas de `v0.1.0-alpha.10`
sirven de muestra.

## Convenciones rápidas

- Mensajes de commit y descripciones de PR/release: **inglés**. Comentarios de
  código y docs: **español**.
- Commits pequeños y enfocados; referencia el área (`fix(ui):`, `feat(perf):`…).
- Checks antes de un PR: `pnpm build`, `cd src-tauri && cargo check`,
  `python -m py_compile bridge/phoson_bridge/*.py`.
- No commitear secretos ni claves de firma (`.gitignore` ya excluye `*.key`).

## Contexto del proyecto

Tauri 2 (Rust) + React 19 (Vite) con un **sidecar Python** (`bridge/`) que habla
JSON-RPC/NDJSON sobre stdio contra el engine `phoson-engine-minimal`. Los releases
se disparan con un tag `v*` (`.github/workflows/release.yml`) y el updater usa un
feed estático `latest.json`. Ver `README.md`, `DISTRIBUTION.md` y `RELEASE.md`.
