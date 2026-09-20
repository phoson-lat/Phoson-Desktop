"""Arnés de validación del sidecar contra el engine real.

Uso:
    cd <repo del engine>            # venv con phoson-engine-minimal instalado
    PYTHONPATH=<Phoson-Desktop>/bridge \
        .venv/bin/python <Phoson-Desktop>/bridge/tests/smoke.py [--turn]

Sin `--turn` prueba todo el plano de control (sin coste). Con `--turn` hace UNA
llamada mínima al LLM configurado para validar el streaming end-to-end.

Variables:
    PHOSON_ENGINE_DIR  (opcional) raíz del engine; por defecto el cwd.
"""

from __future__ import annotations

import os
import sys
import json
import time
import subprocess
import threading

ENGINE_DIR = os.environ.get("PHOSON_ENGINE_DIR", os.getcwd())
BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON = sys.executable
WANT_TURN = "--turn" in sys.argv


def spawn():
    env = {**os.environ, "PYTHONPATH": BRIDGE_DIR + os.pathsep + os.environ.get("PYTHONPATH", "")}
    return subprocess.Popen(
        [PYTHON, "-m", "phoson_bridge"],
        cwd=ENGINE_DIR,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        env=env,
    )


class Client:
    def __init__(self, proc):
        self.proc = proc
        self.responses: dict[int, dict] = {}
        self.notifications: list[dict] = []
        self.bad_framing: list[str] = []
        self.events: list[dict] = []
        self._rid = 1
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                self.bad_framing.append(line[:160])
                continue
            if msg.get("id") is not None:
                self.responses[msg["id"]] = msg
            else:
                self.notifications.append(msg)
                if msg.get("method") == "agent.event":
                    self.events.append(msg["params"]["event"])

    def call(self, method, params=None, timeout=120):
        rid = self._rid
        self._rid += 1
        self.proc.stdin.write(
            json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}) + "\n"
        )
        self.proc.stdin.flush()
        deadline = time.time() + timeout
        while time.time() < deadline:
            if rid in self.responses:
                return self.responses[rid]
            time.sleep(0.05)
        raise TimeoutError(method)


def main() -> int:
    proc = spawn()
    cli = Client(proc)
    checks: list[tuple[str, bool, str]] = []

    def check(name, cond, detail=""):
        checks.append((name, bool(cond), detail))

    try:
        r = cli.call("initialize")
        check("initialize", "result" in r, r.get("error", {}).get("message", ""))
        info = r["result"]
        default = info["defaultSessionId"]

        r = cli.call("session.new")
        check("session.new", "result" in r)
        s2 = r["result"]["sessionId"]
        check("multi-sesión (claves distintas)", s2 != default, f"{s2[:8]} vs {default[:8]}")

        r = cli.call("session.list")
        check("session.list", "result" in r, f"{len(r.get('result', {}).get('sessions', []))} sesiones")

        r = cli.call("session.planCompact", {"sessionId": default})
        check("session.planCompact", "result" in r)

        r = cli.call("session.jumpCandidates", {"sessionId": default})
        check("session.jumpCandidates", "result" in r)

        png = os.path.join(ENGINE_DIR, "assets", "tui.png")
        if os.path.exists(png):
            r = cli.call("attachment.add", {"sessionId": default, "path": png})
            check("attachment.add", "result" in r, r.get("error", {}).get("message", ""))
            r = cli.call("attachment.clear", {"sessionId": default})
            check("attachment.clear", "result" in r)

        r = cli.call("session.close", {"sessionId": s2})
        check("session.close", "result" in r)

        r = cli.call("metodo.inventado")
        check("error método desconocido", "error" in r)

        r = cli.call("turn.cancel", {"sessionId": "no-existe"})
        check("error sesión desconocida", "error" in r)

        if WANT_TURN:
            r = cli.call(
                "turn.run",
                {"sessionId": default, "text": "Responde exactamente con la palabra: OK"},
            )
            result = r.get("result", {})
            check("turn.run status=done", result.get("status") == "done", str(result.get("status")))
            tokens = "".join(str(e.get("content", "")) for e in cli.events if e["type"] == "AgentTokenEvent")
            check("streaming reconstruido", bool(tokens), repr(tokens)[:60])

    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        time.sleep(0.4)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print("=== smoke test ===")
    failed = 0
    for name, ok, detail in checks:
        mark = "OK  " if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"  [{mark}] {name}" + (f"  ({detail})" if detail else ""))
    print(f"\nframing: {'OK' if not cli.bad_framing else 'ERRORES: ' + str(cli.bad_framing)}")
    print(f"notificaciones: {len(cli.notifications)} | eventos: {len(cli.events)}")
    print(f"RESULTADO: {'TODO OK' if failed == 0 else f'{failed} FALLOS'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
