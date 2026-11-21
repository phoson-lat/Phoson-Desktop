"""Comprueba que Desktop pueda usar el bridge oficial incluido en el engine."""

import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys

from packaging.version import Version


def test_engine_distribution_and_protocol_are_installed():
    assert Version(importlib.metadata.version("phoson-engine-minimal")) >= Version("0.64.0")
    import phoson_bridge.protocol as protocol

    assert json.loads(protocol.dump({"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}))["result"]["ok"]


def test_engine_bridge_entrypoint(tmp_path):
    # Igual que Rust: el workspace no necesita contener el código del bridge.
    import phoson_cli

    engine = Path(phoson_cli.__file__).resolve().parent.parent
    env = {
        **os.environ,
        "HOME": str(tmp_path),
        "USERPROFILE": str(tmp_path),
        "PHOSON_HOME": str(tmp_path / ".phoson"),
        "PYTHONPATH": str(engine),
        "PHOSON_PROVIDER": "ollama",
        "PHOSON_MODEL": "test-model",
    }
    origin = subprocess.run(
        [sys.executable, "-c", "import phoson_bridge.server as s; print(s.__file__)"],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30, check=True,
    )
    assert Path(origin.stdout.strip()).resolve() == engine / "phoson_bridge" / "server.py"
    result = subprocess.run(
        [sys.executable, "-m", "phoson_bridge"],
        input='{"jsonrpc":"2.0","id":1,"method":"system.ping"}\n',
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30, check=True,
    )
    responses = [json.loads(line) for line in result.stdout.splitlines()]
    assert any(r.get("id") == 1 and r.get("result", {}).get("ok") for r in responses)
