"""``GuiSink`` — implementación de ``AgentEventSink`` que reenvía a la GUI.

Una instancia por sesión (una por ``PhosonRepl``/``SessionController``). Todos los
métodos son **síncronos** y corren en el loop del sidecar: aquí NO se escribe a
stdout, solo se encola (no bloquea). El writer async del servidor drena la cola en
orden, garantizando el ordering de tokens/tools.

Equivale a ``ClassicSink``/``FullScreenSink`` del CLI: un front-end nuevo es un
sink, no un fork.
"""

from __future__ import annotations

from typing import Any, Callable

from phoson_agent import AgentReasoningEvent

from .protocol import to_jsonable

#: (método_notificación, params) -> encolado, síncrono y no bloqueante.
Emit = Callable[[str, dict[str, Any]], None]


class GuiSink:
    """Traduce el protocolo de presentación del engine a notificaciones JSON."""

    def __init__(self, session_key: str, emit: Emit) -> None:
        self._session_key = session_key
        self._emit = emit
        self._reasoning: list[str] = []

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        self._emit(method, {"sessionId": self._session_key, **params})

    # -- turnos ---------------------------------------------------------------
    def on_user_message(self, text: str, message: object) -> None:
        self._notify("session.user_message", {"text": text, "message": to_jsonable(message)})

    def on_attachments(self, sources: list[str]) -> None:
        self._notify("attachments.changed", {"sources": list(sources)})

    # -- stream ---------------------------------------------------------------
    def on_event(self, event: object) -> None:
        # AgentReasoningEvent/AgentTokenEvent exponen `.content` (no `.text`).
        if isinstance(event, AgentReasoningEvent):
            token = getattr(event, "content", None)
            if token:
                self._reasoning.append(token)
        self._notify("agent.event", {"event": to_jsonable(event)})

    def flush_line(self) -> None:
        self._notify("ui.flush", {})

    def capture_partial_reasoning(self) -> None:
        # No-op: el reasoning ya se acumula en vivo.
        return None

    def take_reasoning(self) -> str:
        reasoning = "".join(self._reasoning)
        self._reasoning.clear()
        return reasoning

    # -- sesión / estado ------------------------------------------------------
    def set_session(self, session_id: str) -> None:
        self._notify("session.info", {"engineSessionId": session_id})

    def print_history(
        self,
        path: list[object],
        tail: int | None = None,
        timestamps: "list | None" = None,
    ) -> None:
        messages = path if tail is None else path[-tail:]
        stamps = timestamps if timestamps is None else timestamps[-(tail or len(timestamps)) :]
        self._notify(
            "session.history",
            {
                "messages": [to_jsonable(m) for m in messages],
                "timestamps": to_jsonable(stamps) if stamps is not None else None,
            },
        )

    def notify(self, kind: str, message: str) -> None:
        self._notify("notify", {"kind": kind, "message": message})

    def on_subagent_progress(self, progress: object | None) -> None:
        self._notify(
            "subagent.progress",
            {"progress": to_jsonable(progress) if progress is not None else None},
        )
