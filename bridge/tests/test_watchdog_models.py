"""Pruebas del watchdog de handlers y de la caché de `models.list`.

Se ejecutan con el intérprete del engine (el bridge necesita `phoson_cli`):

    ..\\phoson-engine-minimal\\.venv\\Scripts\\python.exe bridge\\tests\\test_watchdog_models.py

Sin pytest: asserts y un `main()` que imprime qué verifica. Cubre los dos
comportamientos que la UI nota:

1. Un handler que **no da señales de vida** dispara el aviso `notify`/`warn`
   (el caso real: un motor congelado, con la UI en "Pensando…" para siempre).
2. Un handler vivo (aunque sea lento) NO dispara el aviso.
3. `models.list` cachea el catálogo por proveedor y no repite la red; una
   respuesta cacheada se marca con `cached: true`; un fallo de red no se cachea.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
import time
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import phoson_bridge.server as server  # noqa: E402


class _RecordingStream(io.StringIO):
    """El `protocol_out` del bridge: guarda lo escrito y no hace nada al flushear."""

    def flush(self) -> None:  # el writer hace flush por línea
        return None


class _FakeRepl:
    """Lo mínimo que `_models_list` lee de la sesión."""

    current_model = "demo/model"
    config = type("Cfg", (), {"provider": "openrouter", "base_url": ""})()


async def _fake_get(_key: str) -> _FakeRepl:
    """Sustituto de `SessionManager.get` (que es async desde que construye en un hilo)."""
    return _FakeRepl()


class _Bridge:
    """Un `Bridge` con su writer en marcha.

    Sin el task `_writer`, `_emit` solo encola y el stream de protocolo se
    queda vacío (justo lo que hace el sidecar real al arrancar `serve()`).
    """

    def __init__(self) -> None:
        self.out = _RecordingStream()
        self.bridge = server.Bridge(self.out)
        # El precalentado construiría un `PhosonRepl` real: en los tests no hace
        # falta y solo aportaría segundos de arranque.
        self.bridge._warm_task.cancel()
        self.writer = asyncio.create_task(self.bridge._writer())

    def log(self) -> str:
        return self.out.getvalue()

    async def close(self) -> None:
        self.writer.cancel()
        await asyncio.sleep(0)


async def _test_watchdog_fires_when_silent() -> None:
    harness = _Bridge()

    async def hang(_params):
        await asyncio.sleep(30)

    harness.bridge._methods["test.hang"] = hang
    task = asyncio.create_task(
        harness.bridge._dispatch({"id": 1, "method": "test.hang", "params": {"sessionId": "s1"}})
    )
    await asyncio.sleep(1.2)
    task.cancel()
    await asyncio.sleep(0)
    await harness.close()

    log = harness.log()
    assert "sin enviar nada" in log, f"el watchdog no avisó:\n{log}"
    assert '"kind":"warn"' in log, f"el aviso no es un warn:\n{log}"
    print("  ok  watchdog avisa cuando el handler no da señales de vida")


async def _test_watchdog_quiet_when_alive() -> None:
    harness = _Bridge()

    async def alive(params):
        for _ in range(12):
            harness.bridge._emit(
                "notify", {"sessionId": params.get("sessionId"), "kind": "info", "message": "…"}
            )
            await asyncio.sleep(0.1)
        return {}

    harness.bridge._methods["test.alive"] = alive
    task = asyncio.create_task(
        harness.bridge._dispatch({"id": 2, "method": "test.alive", "params": {"sessionId": "s2"}})
    )
    await asyncio.sleep(1.2)
    task.cancel()
    await asyncio.sleep(0)
    await harness.close()

    log = harness.log()
    assert "sin enviar nada" not in log, f"el watchdog aviso con el motor vivo:\n{log}"
    print("  ok  el watchdog calla cuando hay actividad (modelo lento != colgado)")


async def _test_watchdog_fires_while_the_loop_is_frozen() -> None:
    """El caso REAL: el handler **congela el event loop** (como el `git` colgado).

    Ni las tareas asyncio ni el writer del loop pueden ejecutarse en ese
    intervalo, así que el aviso tiene que salir desde el hilo del watchdog. Se
    comprueba leyendo el stream *durante* la congelación (captura desde otro
    hilo, a los 0.9 s): si el aviso estuviera encolado, no aparecería hasta que
    el loop se liberara.
    """
    harness = _Bridge()
    snapshot: dict[str, str] = {}

    def capture() -> None:
        snapshot["log"] = harness.log()

    async def frozen(params):
        # Réplica exacta del bug real: el motor emite (`session.user_message`) y
        # DESPUÉS se congela en una llamada síncrona. Esa emisión no debe contar
        # como señal de vida: se encola, pero nadie la drena con el loop parado.
        harness.bridge._emit(
            "notify", {"sessionId": params.get("sessionId"), "kind": "info", "message": "hola"}
        )
        time.sleep(1.2)  # síncrono: congela el event loop a propósito
        return {}

    harness.bridge._methods["test.frozen"] = frozen
    capturer = threading.Timer(0.9, capture)
    capturer.start()
    await harness.bridge._dispatch({"id": 3, "method": "test.frozen", "params": {"sessionId": "s6"}})
    capturer.join()
    await harness.close()

    got = snapshot.get("log", "")
    assert "sin enviar nada" in got, f"el aviso no salió con el event loop congelado:\n{got or '<vacío>'}"
    # El writer no corría durante la congelación (la emisión del handler seguía
    # encolada): el aviso, por tanto, no pudo salir por la cola del loop.
    assert "hola" not in got, f"el writer drenó durante la congelación:\n{got}"
    print("  ok  el aviso sale aunque el event loop este congelado (hilo aparte)")


async def _test_watchdog_warns_after_a_long_silence() -> None:
    """Escribió y después se calló (una llamada al proveedor colgada sin
    timeout): avisa cuando el silencio supera `PHOSON_WATCHDOG_SILENCE_SECONDS`."""
    harness = _Bridge()

    async def quiet(params):
        harness.bridge._emit(
            "notify", {"sessionId": params.get("sessionId"), "kind": "info", "message": "hola"}
        )
        await asyncio.sleep(1.6)  # el loop sigue vivo, pero no hay más salida
        return {}

    harness.bridge._methods["test.quiet"] = quiet
    await harness.bridge._dispatch({"id": 4, "method": "test.quiet", "params": {"sessionId": "s7"}})
    await harness.close()

    log = harness.log()
    assert "hola" in log, f"la primera salida no se escribió:\n{log}"
    assert "sin enviar nada" in log, f"no avisó tras el silencio prolongado:\n{log}"
    print("  ok  avisa tras un silencio prolongado (p. ej. red colgada)")


async def _test_models_list_is_cached() -> None:
    harness = _Bridge()
    calls = 0

    async def fake_fetch(_cfg):
        nonlocal calls
        calls += 1
        return [{"id": "m1"}, {"id": "m2"}], None

    harness.bridge.sessions.get = _fake_get  # type: ignore[method-assign]
    harness.bridge._fetch_models = fake_fetch  # type: ignore[method-assign]

    first = await harness.bridge._models_list({"sessionId": "s3"})
    second = await harness.bridge._models_list({"sessionId": "s3"})
    await harness.close()

    assert calls == 1, f"la red se consultó {calls} veces (esperaba 1)"
    assert first["models"] == [{"id": "m1"}, {"id": "m2"}]
    assert "cached" not in first
    assert second.get("cached") is True, second
    assert second["models"] == first["models"]
    print("  ok  models.list cachea el catálogo (1 sola consulta de red)")


async def _test_models_error_is_not_cached() -> None:
    harness = _Bridge()
    calls = 0

    async def failing_fetch(_cfg):
        nonlocal calls
        calls += 1
        return [], "sin red"

    harness.bridge.sessions.get = _fake_get  # type: ignore[method-assign]
    harness.bridge._fetch_models = failing_fetch  # type: ignore[method-assign]

    first = await harness.bridge._models_list({"sessionId": "s4"})
    second = await harness.bridge._models_list({"sessionId": "s4"})
    await harness.close()

    assert first.get("error") == "sin red"
    assert calls == 2, f"un fallo de red se cacheó ({calls} llamadas)"
    assert second.get("error") == "sin red"
    print("  ok  un fallo de red no se cachea (reintenta en la siguiente llamada)")


async def _test_models_cache_invalidated_on_provider_change() -> None:
    harness = _Bridge()
    calls = 0

    async def fake_fetch(_cfg):
        nonlocal calls
        calls += 1
        return [{"id": "m1"}], None

    harness.bridge.sessions.get = _fake_get  # type: ignore[method-assign]
    harness.bridge._fetch_models = fake_fetch  # type: ignore[method-assign]

    await harness.bridge._models_list({"sessionId": "s5"})
    harness.bridge._invalidate_models()
    await harness.bridge._models_list({"sessionId": "s5"})
    await harness.close()

    assert calls == 2, f"cambiar de proveedor no invalidó la caché ({calls} llamadas)"
    print("  ok  cambiar de proveedor/base_url invalida la caché del catálogo")


async def _amain() -> None:
    await _test_watchdog_fires_when_silent()
    await _test_watchdog_quiet_when_alive()
    await _test_watchdog_fires_while_the_loop_is_frozen()
    await _test_watchdog_warns_after_a_long_silence()
    await _test_models_list_is_cached()
    await _test_models_error_is_not_cached()
    await _test_models_cache_invalidated_on_provider_change()


def main() -> int:
    # Consola Windows (cp1252): se reconfigura para poder imprimir acentos.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 — si no se puede, seguimos igual
            pass
    print("bridge: watchdog + cache de models.list")
    # Umbrales cortos para la prueba (los reales son 15 s / 60 s; se pueden
    # forzar igual con PHOSON_WATCHDOG_SECONDS / PHOSON_WATCHDOG_SILENCE_SECONDS).
    os.environ["PHOSON_WATCHDOG_SECONDS"] = "0.4"
    os.environ["PHOSON_WATCHDOG_SILENCE_SECONDS"] = "0.7"
    asyncio.run(_amain())
    print("todas las comprobaciones OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
