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
        # Lo fija `SessionManager` para que el hook `on_session_title` pueda leer
        # el título desde el árbol sin acoplar el sink al REPL.
        self.title_provider: Callable[[], str] | None = None

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        self._emit(method, {"sessionId": self._session_key, **params})

    # -- turnos ---------------------------------------------------------------
    def on_user_message(self, text: str, message: object) -> None:
        self._notify("session.user_message", {"text": text, "message": to_jsonable(message)})

    def on_attachments(self, sources: list[str]) -> None:
        self._notify("attachments.changed", {"sources": list(sources)})

    def on_session_title(self) -> None:
        """El engine actualizó el título de la sesión (heurístico o del modelo).

        Mismo comportamiento que el CLI: tras el primer turno, el título pasa del
        primer mensaje a uno generado por el modelo en background (#55).
        """
        title = ""
        if self.title_provider is not None:
            try:
                title = str(self.title_provider() or "")
            except Exception:  # noqa: BLE001 — nunca tumbar el stream por un título
                title = ""
        self._notify("session.title", {"title": title})

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
        self._notify("subagent.progress", {"progress": self._subagent_snapshot(progress)})

    @staticmethod
    def _subagent_snapshot(progress: object | None) -> Any:
        """Snapshot serializable del tracker de subagentes.

        ``SubagentProgressTracker`` es una clase opaca (no dataclass), así que
        ``to_jsonable`` la reduciría a un ``repr`` inservible. Extraemos sus
        ``tasks`` (``SubagentProgress`` sí es dataclass) para que la UI pueda
        pintar el progreso real de cada subagente.
        """
        if progress is None:
            return None
        tasks = getattr(progress, "tasks", None)
        if tasks is not None:
            return {"tasks": [to_jsonable(t) for t in tasks]}
        return to_jsonable(progress)
