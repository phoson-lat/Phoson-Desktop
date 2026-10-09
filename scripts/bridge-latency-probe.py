"""Mide la latencia del sidecar `phoson-bridge` tal y como la ve la app.

Lanza el sidecar igual que `src-tauri/src/bridge.rs` (un proceso por workspace,
protocolo NDJSON por stdout/stdin) y cronometra:

  - ``spawn``      : ms en crear el proceso.
  - ``boot``       : ms desde el spawn hasta la respuesta a la PRIMERA petición
                     (incluye import del engine + ``bridge.init``). Es el coste
                     que paga el primer mensaje de cada workspace.
  - ``rpc:<método>``: round-trip de cada método, en frío y en caliente.
  - ``turn.ttft``  : ms desde enviar ``turn.run`` hasta el primer ``agent.event``
                     (tiempo hasta el primer token). Solo si hay proveedor
                     configurado.

Uso:

    python scripts/bridge-latency-probe.py                 # matriz básica
    python scripts/bridge-latency-probe.py --turn "hola"   # añade turn.run
    python scripts/bridge-latency-probe.py --repeat 3      # repite la matriz

No toca nada del estado: usa un directorio de sesiones temporal salvo que se
pase ``--sessions-dir``. Stdlib solamente.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from contextlib import closing
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BRIDGE_DIR = REPO / "bridge"
ENGINE_DIR = Path(os.environ.get("PHOSON_ENGINE_DIR", REPO.parent / "phoson-engine-minimal"))
PYTHON = ENGINE_DIR / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

BASIC_METHODS = [
    ("initialize", {}),
    ("session.list", {}),
    ("session.new", {}),
    ("fs.cwd", {}),
    ("config.get", {}),
    ("stt.status", {}),
    ("perf", {}),
]


class Sidecar:
    """Un sidecar vivo + lector de su stdout en un hilo."""

    def __init__(self, cwd: Path, env: dict[str, str], trace: bool = False) -> None:
        self._inbox: queue.Queue[dict] = queue.Queue()
        self._next_id = 0
        self.session_id: str | None = None
        self.stderr_lines: list[str] = []
        self.t_spawn = time.perf_counter()
        self.proc = subprocess.Popen(
            [str(PYTHON), "-m", "phoson_bridge"],
            cwd=str(cwd),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE if trace else subprocess.DEVNULL,
            bufsize=0,
        )
        self.spawn_ms = (time.perf_counter() - self.t_spawn) * 1000
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        if trace:
            threading.Thread(target=self._read_stderr, daemon=True).start()

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for raw in self.proc.stderr:
            self.stderr_lines.append(raw.decode("utf-8", "replace").rstrip())

    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for raw in self.proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                self._inbox.put(json.loads(line))
            except json.JSONDecodeError:
                pass

    def request(self, method: str, params: dict, timeout: float = 120.0) -> tuple[float, dict]:
        """Devuelve (ms hasta la respuesta, mensaje de respuesta)."""
        self._next_id += 1
        rid = self._next_id
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": rid, "method": method, "params": params},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        start = time.perf_counter()
        assert self.proc.stdin is not None
        self.proc.stdin.write(payload.encode("utf-8") + b"\n")
        self.proc.stdin.flush()
        deadline = start + timeout
        while True:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                raise TimeoutError(f"{method} sin respuesta en {timeout:.0f}s")
            try:
                msg = self._inbox.get(timeout=remaining)
            except queue.Empty:
                raise TimeoutError(f"{method} sin respuesta en {timeout:.0f}s") from None
            if msg.get("id") == rid:
                return (time.perf_counter() - start) * 1000, msg

    def drain_notifications(self, seconds: float) -> list[dict]:
        """Notificaciones (sin `id`) recibidas durante *seconds*."""
        out: list[dict] = []
        deadline = time.perf_counter() + seconds
        while True:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                return out
            try:
                msg = self._inbox.get(timeout=remaining)
            except queue.Empty:
                return out
            if msg.get("id") is None:
                out.append(msg)

    def turn_ttft(
        self, session_id: str, text: str, timeout: float
    ) -> tuple[float | None, float | None, str, list[tuple[float, str]]]:
        """(ms hasta el primer evento, ms hasta el resultado, estado, timeline)."""
        self._next_id += 1
        rid = self._next_id
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "method": "turn.run",
                "params": {"sessionId": session_id, "text": text},
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        start = time.perf_counter()
        assert self.proc.stdin is not None
        self.proc.stdin.write(payload.encode("utf-8") + b"\n")
        self.proc.stdin.flush()
        ttft: float | None = None
        timeline: list[tuple[float, str]] = []
        deadline = start + timeout
        while True:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                return ttft, None, f"TIMEOUT ({timeout:.0f}s)", timeline
            try:
                msg = self._inbox.get(timeout=remaining)
            except queue.Empty:
                return ttft, None, f"TIMEOUT ({timeout:.0f}s)", timeline
            if msg.get("id") == rid:
                done = (time.perf_counter() - start) * 1000
                err = msg.get("error")
                timeline.append((done, "RESULTADO"))
                return ttft, done, (err.get("message", "") if err else "ok"), timeline
            method = msg.get("method", "?")
            at = (time.perf_counter() - start) * 1000
            if method == "agent.event":
                kind = (msg.get("params") or {}).get("event", {}).get("type", "?")
                method = f"agent.event:{kind}"
                if ttft is None and kind in ("AgentTokenEvent", "AgentReasoningEvent"):
                    ttft = at
            timeline.append((at, method))

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def fmt(ms: float | None) -> str:
    return "   —  " if ms is None else f"{ms:7.0f}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=str(ENGINE_DIR), help="cwd del sidecar (por defecto: el engine)")
    ap.add_argument("--repeat", type=int, default=1, help="repeticiones de la matriz básica")
    ap.add_argument("--turn", default=None, help="texto para un turn.run real (requiere proveedor)")
    ap.add_argument("--turn-timeout", type=float, default=180.0)
    ap.add_argument("--trace", action="store_true", help="captura el stderr del sidecar (logs [perf])")
    ap.add_argument(
        "--first",
        default=None,
        help="método barato a medir como PRIMERA RPC de un sidecar en frío "
        "(muestra cuánto paga el arranque el primer contacto)",
    )
    ap.add_argument(
        "--models",
        action="store_true",
        help="ejecuta `models.list` dos veces y muestra si la 2.ª sale de la caché",
    )
    args = ap.parse_args()

    if not PYTHON.is_file():
        print(f"NO se encuentra el intérprete del venv: {PYTHON}", file=sys.stderr)
        return 2

    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(BRIDGE_DIR), env["PYTHONPATH"]] if env.get("PYTHONPATH") else [str(BRIDGE_DIR)]
    )

    print(f"python : {PYTHON}")
    print(f"engine : {ENGINE_DIR}")
    print(f"cwd    : {args.workspace}")
    print()

    rows: list[tuple[str, float]] = []
    with closing(Sidecar(Path(args.workspace), env, trace=args.trace)) as sidecar:
        print(f"{'spawn':<22}{fmt(sidecar.spawn_ms)} ms")
        rows.append(("spawn", sidecar.spawn_ms))

        if args.first:
            ms, msg = sidecar.request(args.first, {})
            ok = "err: " + str(msg.get("error", {}).get("message", ""))[:40] if "error" in msg else ""
            label = f"first:{args.first}"
            print(f"{label:<22}{fmt(ms)} ms  {ok}")
            rows.append((label, ms))

        for i in range(args.repeat):
            tag = "" if args.repeat == 1 else f" #{i + 1}"
            for method, params in BASIC_METHODS:
                ms, msg = sidecar.request(method, params)
                ok = "err: " + str(msg.get("error", {}).get("message", ""))[:40] if "error" in msg else ""
                label = f"rpc:{method}{tag}"
                print(f"{label:<22}{fmt(ms)} ms  {ok}")
                rows.append((label, ms))
                if method == "session.new" and "result" in msg:
                    sidecar.session_id = msg["result"].get("sessionId")

        if args.models:
            sid = sidecar.session_id
            if sid is None:
                _, msg = sidecar.request("initialize", {})
                sid = msg.get("result", {}).get("defaultSessionId")
            for i in (1, 2):
                ms, msg = sidecar.request("models.list", {"sessionId": sid})
                result = msg.get("result") or {}
                note = "(cache)" if result.get("cached") else "(red)"
                note = (msg.get("error") or {}).get("message", note) or note
                label = f"models.list #{i}"
                print(f"{label:<22}{fmt(ms)} ms  {note}")
                rows.append((label, ms))

        if args.turn:
            sid = sidecar.session_id
            if sid is None:
                _, msg = sidecar.request("initialize", {})
                sid = msg.get("result", {}).get("defaultSessionId")
            ttft, done, status, timeline = sidecar.turn_ttft(sid, args.turn, args.turn_timeout)
            print(f"{'turn.ttft':<22}{fmt(ttft)} ms  (primer token/razonamiento)")
            print(f"{'turn.total':<22}{fmt(done)} ms  ({status})")
            rows.append(("turn.ttft", ttft or -1.0))
            rows.append(("turn.total", done or -1.0))
            print("\nTimeline del turno (ms desde turn.run):")
            for at, name in timeline[:25]:
                print(f"  {at:8.0f}  {name}")
            if len(timeline) > 25:
                print(f"  … {len(timeline) - 25} eventos más")

        # Descarga de eventos: cuántas notificaciones genera un turno (presión IPC).
        events = sidecar.drain_notifications(0.2)
        print(f"\nnotificaciones residuales: {len(events)}")

        if args.trace:
            print("\nstderr del sidecar (logs):")
            for line in sidecar.stderr_lines[-40:]:
                print(f"  {line}")

    print("\nResumen (nombre, ms):")
    for name, ms in rows:
        print(f"  {name:<20} {ms:8.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
