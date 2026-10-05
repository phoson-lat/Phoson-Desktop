# Roadmap

Estado: **`0.1.0-alpha.1` publicada** (Linux · Windows · macOS Apple Silicon, updater firmado).
Este documento ordena lo siguiente: primero *consolidar* (rendimiento y calidad),
después *ampliar* (distribución y producto).

**Cómo leerlo**
- **Prioridad**: **P0** (ahora) · **P1** (siguiente) · **P2** (después).
- **Esfuerzo**: **S** (horas) · **M** (días) · **L** (semanas, o bloqueado por terceros).
- **Quién**: `app` (este repo) · `engine` (`phoson-engine-minimal`).
- Docs relacionados: [`PERF.md`](PERF.md) · [`ENGINE_GAPS.md`](ENGINE_GAPS.md) · [`RELEASE.md`](RELEASE.md) · [`DISTRIBUTION.md`](DISTRIBUTION.md).

---

## 1. Cerrar el rendimiento  *(ya medido; falta rematar)*

| # | Tarea | Prio | Esf. | Quién |
|---|---|---|---|---|
| 1.1 | **Root fix de `session.list`**: índice/`.meta.json` por sesión en vez de parsear todos los `.jsonl` (hoy el primer listado ~3 s) | P0 | M | engine |
| 1.2 | **Cachear `models.list` por proveedor** (evita ~430 ms de red por llamada) | P0 | S | app |
| 1.3 | **Code-splitting del frontend**: `React.lazy` en `CodeViewer`, `SettingsDialog`, `CommandPalette`, `FileExplorer`, `Onboarding` + `manualChunks` (entrada ~1.4 MB) | P0 | M | app |
| 1.4 | **Diferir `bridge.init`** (~1.3 s por workspace) hasta el primer `turn.run`, o compartir instancia | P1 | M | app+engine |
| 1.5 | **Medir el release** (cold start, RSS, CPU) y comparar con los presupuestos de `PERF.md` §5 | P0 | S | app |

## 2. Calidad y robustez  *(red de seguridad antes de más features)*

| # | Tarea | Prio | Esf. | Quién |
|---|---|---|---|---|
| 2.1 | **Tests**: unit del store y del bridge-client (Vitest) + integración del protocolo; correrlos en `ci.yml` (hoy solo `bridge/tests/smoke.py`) | P0 | M | app |
| 2.2 | **Reporte de fallos**: botón «Reportar problema» que adjunte versión/plataforma + logs `[perf]` (con consentimiento, sin datos de conversación) | P1 | M | app |
| 2.3 | **Endurecer el sidecar**: reintentos y estado degradado si un plugin/MCP falla | P1 | M | app |

## 3. Distribución  *(alpha → beta)*

| # | Tarea | Prio | Esf. | Quién |
|---|---|---|---|---|
| 3.1 | **Firma de instaladores**: Windows Authenticode + macOS Developer ID/notarización (quita el "origen desconocido") | P1 | L | app |
| 3.2 | **Verificar el updater end-to-end**: publicar `0.1.0-alpha.2` e instalar la update desde el alpha | P0 | S | app |
| 3.3 | **`CHANGELOG.md`** + notas de release automáticas | P1 | S | app |
| 3.4 | **macOS Intel**: reactivar `macos-13` cuando haya runners, o decidir no soportarlo | P2 | S | app |

## 4. Producto  *(lo que más valor añade)*

| # | Tarea | Prio | Esf. | Quién |
|---|---|---|---|---|
| 4.1 | **Integrar `peers`**: el engine ya permite agentes con nombre que se mensajean entre ventanas (`peer_ask`/`peer_send`) → chat entre sesiones/proyectos. Feature distintiva | P1 | M | app |
| 4.2 | **Swarms de agentes**: sigue en «Próximamente» hasta que el engine exponga G1–G3 (grafo/rutas/mensajería directa) | P2 | L | app+engine |
| 4.3 | **Tray + notificaciones nativas** para los *wakes* (turnos autónomos) y **keychain** para secretos | P2 | M | app |

## 5. Pulido

| # | Tarea | Prio | Esf. | Quién |
|---|---|---|---|---|
| 5.1 | **i18n** (hoy todo en español) | P2 | M | app |
| 5.2 | **Accesibilidad (a11y)** y atajos | P2 | M | app |
| 5.3 | **Onboarding / setup de proveedor** más guiado | P2 | S | app |

---

## Próximo sprint (recomendado)

1. **Medir el release** (1.5) y publicar los números en `PERF.md`.
2. **Code-splitting** (1.3) + **cache de `models.list`** (1.2): mejoras visibles sin depender de terceros.
3. **Tests + CI** (2.1): red de seguridad para iterar rápido.

> Criterio: **consolidar** el alpha (rendimiento + tests) **antes** de abrir features grandes
> como `peers` (4.1) o swarms (4.2).

## Dependencias del engine
Los puntos marcados `engine` (1.1, 1.4, 4.2) dependen del equipo de
`phoson-engine-minimal`. El detalle de lo necesario para swarms peer-to-peer está
en [`ENGINE_GAPS.md`](ENGINE_GAPS.md) (G1–G8).
