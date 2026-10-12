"""Pruebas del coalescido de tokens (`_TOKEN_BATCH_SECONDS`).

Se ejecutan con el intérprete del engine (el bridge necesita `phoson_cli`):

    ..\\phoson-engine-minimal\\.venv\\Scripts\\python.exe bridge\\tests\\test_token_batch.py

Sin pytest: asserts y un `main()` que imprime qué verifica. El motor emite un
evento `agent.event` POR TOKEN (cientos por segundo); cada uno es una línea
NDJSON + IPC + despacho en la webview. El bridge los acumula 30 ms y los vuelca
en una sola notificación. Lo que la UI nota:

1. N tokens seguidos salen como UNA línea con el contenido concatenado (y
   respetando el orden).
2. Los tokens razonamiento y texto viajan en la misma ventana sin mezclarse.
3. Un evento posterior de la MISMA sesión (p. ej. `session.assistant.done`)
   nunca se adelanta a los tokens acumulados: el texto llega antes de que la
   UI cierre el mensaje.
4. El volcado por temporizador ocurre aunque no llegue ningún evento más.
5. Las notificaciones que no son tokens no se tocan.
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import phoson_bridge.server as server  # noqa: E402


class _RecordingStream(io.StringIO):
    """El `protocol_out` del bridge: guarda lo escrito y no hace nada al flushear."""

    def flush(self) -> None:
        return None


class _Bridge:
    """Un `Bridge` con su writer en marcha (ver `test_watchdog_models.py`)."""

    def __init__(self) -> None:
        self.out = _RecordingStream()
        self.bridge = server.Bridge(self.out)
        self.bridge._warm_task.cancel()
        self.writer = asyncio.create_task(self.bridge._writer())

    def log(self) -> str:
        return self.out.getvalue()

    def events(self) -> list[dict]:
        """Notificaciones `agent.event` del log, ya parseadas."""
        out = []
        for line in self.log().splitlines():
            if not line.strip():
                continue
            msg = json.loads(line)
            if msg.get("method") == "agent.event":
                out.append(msg["params"]["event"])
        return out

    def lines(self) -> list[dict]:
        return [json.loads(l) for l in self.log().splitlines() if l.strip()]

    async def close(self) -> None:
        self.writer.cancel()
        await asyncio.sleep(0)
        # Drena lo que quedó en la cola: al cancelar el writer puede perderse
        # lo encolado en la misma iteración del loop (lo escrito debe reflejar
        # TODO lo emitido, no lo que el writer alcanzó a vaciar).
        while True:
            try:
                _sid, line = self.bridge._out.get_nowait()
            except asyncio.QueueEmpty:
                break
            self.out.write(line + "\n")


def _emit_token(bridge, sid: str, content: str, etype: str = "AgentTokenEvent") -> None:
    bridge._emit("agent.event", {"sessionId": sid, "event": {"type": etype, "content": content}})


async def _test_many_tokens_coalesce_into_one_line() -> None:
    harness = _Bridge()
    for piece in ("Ho", "la", " ", "mun", "do"):
        _emit_token(harness.bridge, "s1", piece)
    # Sin eventos posteriores: el temporizador de la ventana vuelca solo.
    await asyncio.sleep(0.05)
    await harness.close()

    events = harness.events()
    assert len(events) == 1, f"esperaba 1 evento coalescido, hubo {len(events)}: {events}"
    assert events[0] == {"type": "AgentTokenEvent", "content": "Hola mundo"}, events
    print("  ok  N tokens seguidos salen como una sola notificación coalescida")


async def _test_reasoning_and_text_keep_their_own_batch() -> None:
    harness = _Bridge()
    _emit_token(harness.bridge, "s2", "pienso", "AgentReasoningEvent")
    _emit_token(harness.bridge, "s2", "luego ")
    _emit_token(harness.bridge, "s2", "escribo", "AgentReasoningEvent")
    _emit_token(harness.bridge, "s2", "exist")
    await asyncio.sleep(0.05)
    await harness.close()

    events = harness.events()
    texts = [e for e in events if e["type"] == "AgentTokenEvent"]
    reasoning = [e for e in events if e["type"] == "AgentReasoningEvent"]
    assert texts == [{"type": "AgentTokenEvent", "content": "luego exist"}], texts
    assert reasoning == [{"type": "AgentReasoningEvent", "content": "piensoescribo"}], reasoning
    print("  ok  tokens y reasoning se acumulan por separado y en orden")


async def _test_later_event_flushes_tokens_before_itself() -> None:
    harness = _Bridge()
    _emit_token(harness.bridge, "s3", "texto ")
    _emit_token(harness.bridge, "s3", "final")
    # El evento que cierra el turno: debe salir DESPUÉS de los tokens.
    harness.bridge._emit("session.assistant.done", {"sessionId": "s3", "status": "done"})
    await harness.close()

    lines = harness.lines()
    methods = [l.get("method") for l in lines]
    assert "agent.event" in methods and "session.assistant.done" in methods, methods
    assert methods.index("agent.event") < methods.index("session.assistant.done"), (
        f"los tokens se emitieron después del cierre del turno: {methods}"
    )
    print("  ok  un evento de cierre nunca se adelanta a los tokens acumulados")


async def _test_non_token_events_are_untouched() -> None:
    harness = _Bridge()
    harness.bridge._emit("session.user_message", {"sessionId": "s4", "text": "hola"})
    harness.bridge._emit("ui.flush", {"sessionId": "s4"})
    await asyncio.sleep(0.05)
    await harness.close()

    methods = [l.get("method") for l in harness.lines()]
    assert methods == ["session.user_message", "ui.flush"], methods
    print("  ok  las notificaciones que no son tokens conservan su forma")


async def _test_batches_are_per_session() -> None:
    harness = _Bridge()
    _emit_token(harness.bridge, "sa", "de A")
    _emit_token(harness.bridge, "sb", "de B")
    harness.bridge._emit("session.assistant.done", {"sessionId": "sb", "status": "done"})
    await asyncio.sleep(0.05)
    await harness.close()

    # sA se vuelca por su temporizador; sB por el cierre de su turno. El contenido
    # de una sesión jamás termina en la notificación de la otra.
    for line in harness.lines():
        if line.get("method") != "agent.event":
            continue
        sid, event = line["params"]["sessionId"], line["params"]["event"]
        assert sid in ("sa", "sb"), line
        assert event["content"] == f"de {sid[-1].upper()}", line
    print("  ok  el coalescido es por sesión (sin fugas entre workspaces)")


async def main() -> None:
    tests = [
        _test_many_tokens_coalesce_into_one_line,
        _test_reasoning_and_text_keep_their_own_batch,
        _test_later_event_flushes_tokens_before_itself,
        _test_non_token_events_are_untouched,
        _test_batches_are_per_session,
    ]
    failed = 0
    for test in tests:
        try:
            await test()
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL  {test.__name__}: {exc}")
    if failed:
        print(f"\n{failed} prueba(s) fallaron")
        sys.exit(1)
    print("\ntodas las pruebas de coalescido de tokens pasaron")


if __name__ == "__main__":
    asyncio.run(main())
