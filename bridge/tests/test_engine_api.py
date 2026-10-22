"""Contrato bridge ↔ engine: la API de ``PhosonRepl`` que usa el bridge existe.

Se ejecuta con el intérprete del engine (el bridge necesita `phoson_cli`):

    ../phoson-engine-minimal/.venv/bin/python bridge/tests/test_engine_api.py

El bridge reutiliza ``PhosonRepl`` como motor headless y llama a sus métodos
por nombre: si el engine renombra uno (v0.54.0 cambió ``_run_agent`` por
``run_turn``), el build empaqueta un sidecar que falla en el primer turno. Esta
prueba construye un ``PhosonRepl`` real del engine instalado y comprueba cada
atributo que el bridge usa, para que subir el pin del engine lo detecte antes
del release.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from phoson_cli.config import PhosonConfig  # noqa: E402
from phoson_cli.repl import PhosonRepl  # noqa: E402

#: Lo que `server.py` llama sobre el `PhosonRepl` de cada sesión.
REPL_API = (
    "config",
    "current_model",
    "engine",
    "tree",
    "storage",
    "is_running",
    "session_metrics",
    "run_turn",
    "cancel_current",
    "set_model",
    "set_provider",
    "load_session",
    "undo_last_turn",
    "jump_to_user_turn",
    "jump_candidates",
    "plan_compaction",
    "compact_context",
    "shutdown",
    "_controller",
)

#: Lo que el bridge usa del `SessionController` (`repl._controller`).
CONTROLLER_API = (
    "attachments",
    "tree",
    "sink",
    "engine",
    "plugin_ui",
    "context_tokens",
    "context_window",
    "command_catalog",
    "_node_path",
    "set_operation_starter",
    "start_monitor_wake_loop",
)


def test_repl_api() -> None:
    config = PhosonConfig(
        provider="ollama", model="test-model", sessions_dir=Path(tempfile.mkdtemp())
    )
    with patch(
        "phoson_cli.controller.build_chat", return_value=MagicMock(aclose=AsyncMock())
    ):
        repl = PhosonRepl(config)
    missing = [name for name in REPL_API if not hasattr(repl, name)]
    missing += [
        f"_controller.{name}"
        for name in CONTROLLER_API
        if not hasattr(repl._controller, name)
    ]
    assert not missing, f"el engine ya no expone: {', '.join(missing)}"


def main() -> None:
    test_repl_api()
    print("ok  test_repl_api")


if __name__ == "__main__":
    main()
