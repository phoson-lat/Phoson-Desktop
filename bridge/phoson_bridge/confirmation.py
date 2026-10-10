"""``GuiConfirmation`` — implementación de ``ConfirmationService`` + interacciones.

Los tools con nivel de permiso ``ask`` (bash en ``safe_mode``) reciben este
servicio por inyección de contexto. Cada confirmación se convierte en una
notificación ``confirm.request`` (con el ``sessionId`` que la originó); el usuario
responde por ``confirm.respond`` y el Future se resuelve.

El mismo ciclo sirve a las interacciones de plugins (``PluginUiService`` del
engine): ``SinkPluginUiService`` delega ``ask``/``select``/``form`` en los métodos
``ask_questions_plugin``/``select_plugin``/``form_plugin`` de este objeto. Sin
ellos, la tool ``questions`` (plugin ``phoson_plugin_questions``) degrada a
``status="unavailable"`` y el modelo no puede preguntar al usuario.

IMPORTANTE (fail-closed): sin ``ConfirmationService`` el engine rechaza los tools
``ask``. Por eso el sidecar SIEMPRE inyecta esta implementación.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

from phoson_agent import FormField, Question, QuestionsResult

#: (session_key, kind, payload) -> awaitable que resuelve la decisión del usuario.
RequestUser = Callable[[str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


def _question_payload(question: Question) -> dict[str, Any]:
    """Serializa una ``Question`` del engine para mandarla a la UI."""
    return {
        "id": question.id,
        "header": question.header,
        "question": question.question,
        "multi_select": bool(question.multi_select),
        "allow_other": bool(question.allow_other),
        "options": [
            {"id": option.id, "label": option.label, "description": option.description}
            for option in question.options
        ],
    }


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

    # -- interacciones de plugins (PluginUiService: select / form / ask) ------
    #
    # Todas reutilizan el ciclo `confirm.request`/`confirm.respond` con un `kind`
    # propio; la UI distingue por `kind` y responde con el payload que cada
    # método interpreta aquí.

    async def select_plugin(self, title: str, message: str, choices: list[Any]) -> str | None:
        """Selección simple (fallback de `ask` en hosts antiguos). Devuelve el id elegido."""
        result = await self._request_user(
            self._session_key,
            "select",
            {
                "title": title,
                "message": message,
                "choices": [
                    {"id": c.id, "label": c.label, "detail": c.detail} for c in choices
                ],
            },
        )
        if result.get("cancelled"):
            return None
        choice = result.get("choice")
        return str(choice) if choice else None

    async def form_plugin(
        self, title: str, fields: "list[FormField]"
    ) -> dict[str, str] | None:
        """Formulario corto (campos de texto). Devuelve {fieldId: valor} o None."""
        result = await self._request_user(
            self._session_key,
            "form",
            {
                "title": title,
                "fields": [
                    {
                        "id": field.id,
                        "label": field.label,
                        "kind": field.kind,
                        "required": bool(field.required),
                        "default": field.default,
                        "help": field.help,
                    }
                    for field in fields
                ],
            },
        )
        if result.get("cancelled"):
            return None
        values = result.get("values")
        return dict(values) if isinstance(values, dict) else {}

    async def ask_questions_plugin(
        self, title: str, questions: "list[Question]"
    ) -> "QuestionsResult | None":
        """Tool `questions`: 1–4 preguntas de opción múltiple en una tarjeta."""
        result = await self._request_user(
            self._session_key,
            "questions",
            {"title": title, "questions": [_question_payload(q) for q in questions]},
        )
        if result.get("cancelled"):
            return None
        selections: dict[str, tuple[str, ...]] = {}
        raw = result.get("selections")
        if isinstance(raw, dict):
            for question_id, option_ids in raw.items():
                if isinstance(option_ids, (list, tuple)):
                    selections[str(question_id)] = tuple(str(i) for i in option_ids)
        other_text: dict[str, str] = {}
        raw_other = result.get("other")
        if isinstance(raw_other, dict):
            for question_id, text in raw_other.items():
                if text:
                    other_text[str(question_id)] = str(text)
        return QuestionsResult(status="submitted", selections=selections, other_text=other_text)
