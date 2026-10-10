"""Pruebas de las interacciones de plugins (`questions`/`select`/`form`).

Se ejecutan con el intérprete del engine (el bridge necesita `phoson_agent`):

    ..\\phoson-engine-minimal\\.venv\\Scripts\\python.exe bridge\\tests\\test_questions.py

Sin pytest: asserts y un `main()` que imprime qué verifica. Cubre el contrato
entre `GuiConfirmation` y el `SinkPluginUiService` del engine, que es el que
alimenta la tool `questions` del plugin `phoson_plugin_questions`:

1. `ask_questions_plugin` emite `confirm.request` con `kind="questions"` y las
   preguntas serializadas (id, header, opciones, multi_select, allow_other).
2. La respuesta de la UI (`selections`/`other`) se traduce a `QuestionsResult`.
3. `cancelled` resuelve a `None` (el engine lo traduce a `status="cancelled"`).
4. `select_plugin`/`form_plugin` (fallback) devuelven el id elegido y los
   valores del formulario.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phoson_agent import Choice, FormField, Question, QuestionOption  # noqa: E402

from phoson_bridge.confirmation import GuiConfirmation  # noqa: E402

QUESTION = Question(
    id="q1",
    header="Auth",
    question="¿Qué método de autenticación prefieres?",
    options=(
        QuestionOption(id="a", label="Token", description="Simple"),
        QuestionOption(id="b", label="OAuth", description="Por delegación"),
    ),
    multi_select=True,
    allow_other=True,
)


def _responder(response: dict):
    """`request_user` falso: registra la petición y devuelve `response`."""

    seen: dict = {}

    async def request_user(_key: str, kind: str, payload: dict) -> dict:
        seen.clear()
        seen.update(kind=kind, payload=payload)
        return response

    return request_user, seen


async def _run() -> None:
    # 1) La petición viaja con kind "questions" y las preguntas serializadas.
    request_user, seen = _responder({"selections": {"q1": ["a", "b"]}, "other": {}})
    result = await GuiConfirmation("k", request_user).ask_questions_plugin("Preferencias", [QUESTION])
    assert seen["kind"] == "questions", seen
    sent = seen["payload"]["questions"][0]
    assert sent["id"] == "q1" and sent["header"] == "Auth", sent
    assert sent["multi_select"] is True and sent["allow_other"] is True, sent
    assert [o["label"] for o in sent["options"]] == ["Token", "OAuth"], sent
    print("ok: ask serializa la pregunta con kind=questions")

    # 2) La respuesta de la UI se traduce a QuestionsResult.
    assert result is not None and result.status == "submitted", result
    assert dict(result.selections) == {"q1": ("a", "b")}, result.selections
    assert dict(result.other_text) == {}, result.other_text
    print("ok: selections -> QuestionsResult(selections=...)")

    request_user, _seen = _responder({"selections": {}, "other": {"q1": "mi respuesta"}})
    result = await GuiConfirmation("k", request_user).ask_questions_plugin("T", [QUESTION])
    assert result is not None and dict(result.other_text) == {"q1": "mi respuesta"}, result
    print("ok: other -> QuestionsResult(other_text=...)")

    # 3) Cancelar resuelve a None (el engine lo ve como status="cancelled").
    request_user, _seen = _responder({"cancelled": True})
    gui = GuiConfirmation("k", request_user)
    assert await gui.ask_questions_plugin("T", [QUESTION]) is None
    assert await gui.select_plugin("T", "M", [Choice(id="a", label="A")]) is None
    assert await gui.form_plugin("T", [FormField(id="x", label="X")]) is None
    print("ok: cancelled -> None en ask/select/form")

    # 4) Fallback select/form.
    request_user, seen = _responder({"choice": "b"})
    chosen = await GuiConfirmation("k", request_user).select_plugin(
        "T", "M", [Choice(id="a", label="A"), Choice(id="b", label="B")]
    )
    assert chosen == "b", chosen
    assert seen["kind"] == "select", seen
    assert seen["payload"]["choices"][1] == {"id": "b", "label": "B", "detail": None}, seen
    print("ok: select_plugin devuelve el id elegido")

    request_user, seen = _responder({"values": {"other": "hola"}})
    values = await GuiConfirmation("k", request_user).form_plugin(
        "T", [FormField(id="other", label="Tu respuesta")]
    )
    assert values == {"other": "hola"}, values
    assert seen["kind"] == "form", seen
    assert seen["payload"]["fields"][0]["id"] == "other", seen
    print("ok: form_plugin devuelve los valores")

    # 5) El pegamento real: `SinkPluginUiService` del engine delega `ask` en
    #    `GuiConfirmation.ask_questions_plugin` (antes devolvía "unavailable").
    from phoson_cli.plugin_ui import SinkPluginUiService

    class _FakeSink:
        def notify(self, kind: str, message: str) -> None:  # pragma: no cover
            return None

    request_user, _seen = _responder({"selections": {"q1": ["a"]}, "other": {}})
    ui = SinkPluginUiService(_FakeSink(), None, confirmation=GuiConfirmation("k", request_user))
    result = await ui.ask(title="Preferencias", questions=[QUESTION])
    assert result.status == "submitted" and dict(result.selections) == {"q1": ("a",)}, result
    print("ok: SinkPluginUiService.ask delega en GuiConfirmation")

    ui_sin_preguntas = SinkPluginUiService(_FakeSink(), None, confirmation=object())
    result = await ui_sin_preguntas.ask(title="T", questions=[QUESTION])
    assert result.status == "unavailable", result
    print("ok: sin ask_questions_plugin degrada a unavailable (fail-safe)")


def main() -> None:
    asyncio.run(_run())
    print("TODO OK")


if __name__ == "__main__":
    main()
