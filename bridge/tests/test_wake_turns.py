"""Pruebas de la reactivación autónoma (monitores / jobs en background).

Se ejecutan con el intérprete del engine (el bridge necesita `phoson_cli`):

    ../phoson-engine-minimal/.venv/bin/python bridge/tests/test_wake_turns.py

Sin pytest: asserts y un `main()` que imprime qué verifica. Lo que la UI nota:

1. Al construir una sesión, el bridge registra su `operation_starter` y arranca
   el bucle de wakes del controller (antes nadie lo arrancaba y un monitor solo
   se entregaba con el siguiente mensaje del usuario).
2. Un turno autónomo que se ejecuta termina con `session.assistant.done`
   (con el estado del outcome) para que la GUI cierre el mensaje.
3. Si un turno del usuario consumió los wakes antes (no se ejecutó nada), el
   bridge no emite nada.
4. Con un engine anterior (el wake no devuelve outcome) el cierre se deduce de
   `session.user_message`.
5. Cancelar el turno autónomo emite `cancelled` y propaga la cancelación.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import phoson_bridge.server as server  # noqa: E402
from phoson_bridge.sink import GuiSink  # noqa: E402


class _FakeController:
    def __init__(self, sink: GuiSink) -> None:
        self.sink = sink
        self.starter: Any = None
        self.loop_started = 0

    def set_operation_starter(self, starter: Any) -> None:
        self.starter = starter

    def start_monitor_wake_loop(self) -> None:
        self.loop_started += 1


def _manager() -> tuple[server.SessionManager, list[tuple[str, dict]], str]:
    emitted: list[tuple[str, dict]] = []

    def emit(method: str, params: dict, *, life: bool = True) -> None:
        emitted.append((method, params))

    manager = server.SessionManager(SimpleNamespace(), emit)
    key = "sess-1"
    sink = GuiSink(key, lambda method, params: emitted.append((method, params)))
    manager._repls[key] = SimpleNamespace(_controller=_FakeController(sink))  # type: ignore[assignment]
    return manager, emitted, key


def _done(emitted: list[tuple[str, dict]]) -> list[dict]:
    return [p for m, p in emitted if m == "session.assistant.done"]


async def test_wires_loop_and_starter() -> None:
    manager, _, key = _manager()
    repl = manager._repls[key]
    manager._wire_wakes(key, repl)  # type: ignore[arg-type]
    controller = repl._controller
    assert controller.loop_started == 1
    assert callable(controller.starter)

    async def wake() -> None:
        return None

    task = controller.starter(wake(), "wake")
    assert isinstance(task, asyncio.Task)
    await task


async def test_wake_turn_emits_done_with_outcome() -> None:
    manager, emitted, key = _manager()
    finished: list[str] = []
    manager.on_wake_turn_done = finished.append
    sink = manager._repls[key]._controller.sink

    async def wake() -> Any:
        sink.on_user_message("[MONITOR EVENTS] ...", None)
        return SimpleNamespace(status="error", error_code="auth", final_content=None)

    await manager._run_wake_turn(key, wake())
    (done,) = _done(emitted)
    assert done["status"] == "error" and done["errorCode"] == "auth"
    assert done["source"] == "wake"
    assert finished == [key]


async def test_consumed_wake_emits_nothing() -> None:
    manager, emitted, key = _manager()

    async def wake() -> None:
        return None  # un turno del usuario ya los consumió

    await manager._run_wake_turn(key, wake())
    assert _done(emitted) == []


async def test_old_engine_closes_from_user_message() -> None:
    manager, emitted, key = _manager()
    sink = manager._repls[key]._controller.sink

    async def wake() -> None:
        sink.on_user_message("[MONITOR EVENTS] ...", None)
        return None  # engine anterior: sin outcome

    await manager._run_wake_turn(key, wake())
    (done,) = _done(emitted)
    assert done["status"] == "done"


async def test_cancel_emits_cancelled() -> None:
    manager, emitted, key = _manager()
    sink = manager._repls[key]._controller.sink
    started = asyncio.Event()

    async def wake() -> None:
        sink.on_user_message("[MONITOR EVENTS] ...", None)
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(manager._run_wake_turn(key, wake()))
    await started.wait()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("la cancelación debe propagarse")
    (done,) = _done(emitted)
    assert done["status"] == "cancelled"


async def _run_all() -> None:
    for test in (
        test_wires_loop_and_starter,
        test_wake_turn_emits_done_with_outcome,
        test_consumed_wake_emits_nothing,
        test_old_engine_closes_from_user_message,
        test_cancel_emits_cancelled,
    ):
        await test()
        print(f"ok  {test.__name__}")


def main() -> None:
    asyncio.run(_run_all())


if __name__ == "__main__":
    main()
