"""``GuiConfirmation`` — implementación de ``ConfirmationService``.

Los tools con nivel de permiso ``ask`` (bash en ``safe_mode``) reciben este
servicio por inyección de contexto. Cada confirmación se convierte en una
notificación ``confirm.request`` (con el ``sessionId`` que la originó); el usuario
responde por ``confirm.respond`` y el Future se resuelve.

IMPORTANTE (fail-closed): sin ``ConfirmationService`` el engine rechaza los tools
``ask``. Por eso el sidecar SIEMPRE inyecta esta implementación.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

#: (session_key, kind, payload) -> awaitable que resuelve la decisión del usuario.
RequestUser = Callable[[str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


class GuiConfirmation:
    def __init__(self, session_key: str, request_user: RequestUser) -> None:
        self._session_key = session_key
        self._request_user = request_user

    async def confirm_bash(self, command: str) -> bool:
        result = await self._request_user(
            self._session_key, "bash", {"command": command, "actions": ["yes", "no"]}
        )
        return result.get("decision") in ("yes", "always")

    async def confirm_bash_command(
        self,
        command: str,
        *,
        on_always: "Callable[[str], Coroutine[Any, Any, None]] | None" = None,
    ) -> bool:
        result = await self._request_user(
            self._session_key,
            "bash",
            {"command": command, "actions": ["yes", "always", "no"]},
        )
        decision = result.get("decision")
        if decision == "always" and on_always is not None:
            await on_always(command)
        return decision in ("yes", "always")
