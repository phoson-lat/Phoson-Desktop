"""Servidor JSON-RPC sobre NDJSON (stdio) que aloja las sesiones del engine.

Transporte
----------
- Una línea = un objeto JSON (NDJSON), en ambas direcciones.
- Requests del frontend traen ``id``; las respuestas reutilizan ese ``id``.
- Las notificaciones (streaming) no llevan ``id`` y usan ``method``.

Multi-sesión (decisión #5)
--------------------------
El ``SessionController``/``AgentEngine`` es *single-flight*: no admite dos runs
concurrentes sobre la misma instancia. Para permitir N sesiones simultáneas,
``SessionManager`` mantiene **una instancia de ``PhosonRepl`` por sesión** (cada
una con su propio ``SessionController``, su ``GuiSink`` y su
``GuiConfirmation``), todas sobre el MISMO loop asyncio del sidecar.

Reutilización de ``PhosonRepl`` (decisión #3)
---------------------------------------------
No se usa la parte prompt_toolkit (eso vive en ``PhosonRepl.run()``). Se
reutiliza ``PhosonRepl`` como *motor de sesión* headless: expone los passthroughs
(``set_model``, ``load_session``, ``compact_context``, ``undo_last_turn``,
``jump_to_user_turn``, ``shutdown``…) que los ``/comandos`` del CLI ya esperan,
de modo que un futuro ``GuiCommandHost`` + ``CommandHandler`` funciona sin tocar
el core.
"""

from __future__ import annotations

import os
import sys
import copy
import json
import time
import uuid
import asyncio
import logging
import threading
from typing import Any, TextIO

from phoson_cli.config import load_config, PhosonConfig, has_configured_provider
from phoson_cli.repl import PhosonRepl
from phoson_cli.session_utils import engine_masked_count, engine_visible_tools

from .sink import GuiSink
from .protocol import dump, to_jsonable
from .confirmation import GuiConfirmation
from .stt import SttManager

log = logging.getLogger("phoson_bridge")

#: `session.list` lee y parsea todos los `.jsonl` (~3 s con muchos historiales),
#: así que se cachea; el TTL cubre cambios hechos por OTRO sidecar (comparten
#: `sessions_dir`) y las mutaciones locales invalidan de inmediato.
_SESSION_LIST_TTL = 4.0
#: `stt.status` sondea el plugin/motor de voz (~150 ms); apenas cambia.
_STT_STATUS_TTL = 5.0
#: Métodos que pueden alterar la lista de sesiones guardadas.
_SESSION_MUTATING = frozenset(
    {"turn.run", "session.delete", "session.new", "session.undo", "session.rewind", "session.compact"}
)
#: El catálogo de modelos cambia poco y cada consulta es un round-trip de red
#: (~430 ms); el picker lo abre al instante y un turno no debe pagarlo.
_MODELS_LIST_TTL = 300.0

#: Umbrales del watchdog (segundos). Dos situaciones distintas:
#:  * arranque mudo: el handler no llega a escribir **nada** — el motor está
#:    congelado (el bug de Windows: un `git` bloqueando el event loop);
#:  * silencio prolongado: escribió y después se quedó mudo (p. ej. una llamada
#:    al proveedor colgada sin timeout).
#: Un modelo lento NO dispara nada: escribe `session.user_message`/
#: `AgentStartEvent` en los primeros ms y solo calla hasta que fluye el token.
#: Se pueden forzar con env para probar el comportamiento a mano:
#:   PHOSON_WATCHDOG_SECONDS=3 PHOSON_WATCHDOG_SILENCE_SECONDS=5
_WATCHDOG_SECONDS: dict[str, float] = {"turn.run": 15.0}
_WATCHDOG_SILENCE_SECONDS: dict[str, float] = {"turn.run": 60.0}
_WATCHDOG_DEFAULT_SECONDS = 30.0
_WATCHDOG_DEFAULT_SILENCE_SECONDS = 120.0
#: Avisos máximos por RPC en vuelo (el watchdog se reprograma mientras siga el
#: problema, pero no hasta el infinito).
_WATCHDOG_MAX_WARNINGS = 3


def _watchdog_delays(method: str) -> tuple[float, float]:
    """(umbral de arranque mudo, umbral de silencio) para un método."""
    start = float(
        os.environ.get("PHOSON_WATCHDOG_SECONDS")
        or _WATCHDOG_SECONDS.get(method, _WATCHDOG_DEFAULT_SECONDS)
    )
    silence = float(
        os.environ.get("PHOSON_WATCHDOG_SILENCE_SECONDS")
        or _WATCHDOG_SILENCE_SECONDS.get(method, _WATCHDOG_DEFAULT_SILENCE_SECONDS)
    )
    return start, silence


class SessionManager:
    """Un ``PhosonRepl`` por sesión, compartiendo el loop del sidecar."""

    def __init__(self, base_config: PhosonConfig, emit) -> None:
        self._base_config = base_config
        self._emit = emit
        self._loop = asyncio.get_running_loop()
        self._repls: dict[str, PhosonRepl] = {}
        # Sesiones creadas pero aún sin construir (lazy): `create` es barato y
        # `get` paga el `PhosonRepl` la primera vez que alguien lo necesita.
        self._pending: dict[str, tuple[Any, Any, Any]] = {}
        # Construcciones en curso, compartidas entre las RPC que las esperan.
        self._building: dict[str, asyncio.Task[PhosonRepl]] = {}
        self._confirmations: dict[str, asyncio.Future[dict[str, Any]]] = {}

    # -- ciclo de vida --------------------------------------------------------
    def create(self) -> str:
        """Reserva una sesión. NO construye el ``PhosonRepl`` (≈1.7 s).

        Construirlo aquí bloqueaba el event loop antes de que el sidecar
        empezara a leer stdin: la primera petición de cada workspace pagaba el
        arranque completo del engine antes de recibir ni un byte. Con lazy, las
        RPC baratas (`session.list`, `stt.status`, `fs.*`) responden al momento
        y `turn.run` emite `session.turn.started` antes de construir nada.
        """
        key = uuid.uuid4().hex
        # Config propia por sesión: el controller muta config.model/provider.
        # `copy.copy` (superficial) basta: lo que se muta son escalares; el
        # config trae un `mappingproxy` en `_secret_sources` que rompe deepcopy.
        config = copy.copy(self._base_config)
        sink = GuiSink(key, self._emit)
        confirmation = GuiConfirmation(key, self.request_user)
        # El sink puede leer el título vivo del árbol (hook `on_session_title`).
        sink.title_provider = lambda k=key: (
            self._repls[k].tree.title if k in self._repls else ""
        )
        self._pending[key] = (config, sink, confirmation)
        return key

    def _build(self, key: str, parts: tuple[Any, Any, Any]) -> PhosonRepl:
        """Construye el ``PhosonRepl`` de una sesión (segundos de CPU/IO)."""
        config, sink, confirmation = parts
        _t = time.perf_counter()
        repl = PhosonRepl(config, sink=sink, confirmation=confirmation)
        log.info("[perf] bridge.init %.0fms", (time.perf_counter() - _t) * 1000)
        return repl

    async def get(self, key: str) -> PhosonRepl:
        """Devuelve el ``PhosonRepl`` de la sesión, construyéndolo si falta.

        La construcción cuesta **segundos**, así que se hace en un hilo
        (`asyncio.to_thread`): ejecutarla sobre el event loop congelaba todo lo
        demás — en una traza real, cuatro `session.list` y el stream de otras
        sesiones esperaron 7.7 s detrás de un solo `bridge.init`. Las RPC
        concurrentes comparten la construcción en curso en vez de duplicarla.
        """
        repl = self._repls.get(key)
        if repl is not None:
            return repl
        building = self._building.get(key)
        if building is not None:
            return await building

        parts = self._pending.pop(key, None)
        if parts is None:
            raise KeyError(f"sesión desconocida: {key}")

        async def _run() -> PhosonRepl:
            try:
                built = await asyncio.to_thread(self._build, key, parts)
                self._repls[key] = built
                return built
            finally:
                self._building.pop(key, None)

        task = asyncio.create_task(_run())
        self._building[key] = task
        return await task

    async def close(self, key: str) -> None:
        self._pending.pop(key, None)
        building = self._building.get(key)
        if building is not None:
            try:
                await building  # no dejar un engine construyéndose al vuelo
            except Exception:  # noqa: BLE001 — el cierre manda
                pass
        repl = self._repls.pop(key, None)
        if repl is not None:
            await repl.shutdown()

    def ensure_any(self) -> str:
        """Garantiza que exista al menos una sesión y devuelve una clave.

        El front-end puede cerrar la sesión por defecto; sin esto, el bridge se
        queda sin sesiones y cualquier RPC que las use (initialize, fs.setCwd…)
        falla con "sesión desconocida".
        """
        # `get` saca la sesión de `_pending` mientras se construye: sin mirar
        # `_building` aquí se crearía una segunda sesión en paralelo.
        if self._building:
            return next(iter(self._building))
        if self._pending:
            return next(iter(self._pending))
        if self._repls:
            return next(iter(self._repls))
        return self.create()

    async def close_all(self) -> None:
        for key in list(self._building) + list(self._pending) + list(self._repls):
            await self.close(key)

    def keys(self) -> list[str]:
        return list(self._building) + list(self._pending) + list(self._repls)

    def storage(self):
        # Todas las sesiones comparten sessions_dir; cualquier controller sirve.
        if self._repls:
            return next(iter(self._repls.values())).storage
        from phoson_agent.sessions import JsonlStorage

        return JsonlStorage(base_path=self._base_config.sessions_dir)

    # -- confirmaciones -------------------------------------------------------
    async def request_user(self, session_key: str, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = uuid.uuid4().hex
        future: asyncio.Future[dict[str, Any]] = self._loop.create_future()
        self._confirmations[request_id] = future
        self._emit(
            "confirm.request",
            {"sessionId": session_key, "requestId": request_id, "kind": kind, **payload},
        )
        return await future

    def resolve_confirm(self, request_id: str, decision: dict[str, Any]) -> bool:
        future = self._confirmations.pop(request_id, None)
        if future is not None and not future.done():
            future.set_result(decision)
            return True
        return False


class _WatchdogHandle:
    """Watchdog de una RPC en vuelo: timer, avisos emitidos y cancelación.

    El timer va en un ``threading.Timer`` y no en una tarea asyncio a propósito:
    el bug que motivó esto **congelaba el propio event loop** (una llamada
    síncrona a `git`), así que una tarea del loop no habría llegado a ejecutarse
    nunca. El hilo, sí. El timer se reprograma mientras siga el silencio, por lo
    que hay que poder cancelar el *actual* cuando la RPC termina.
    """

    def __init__(self, bridge: "Bridge", method: str, params: Any, started: float) -> None:
        self._bridge = bridge
        self._method = method
        self._params = params
        self._started = started
        self._session_id = str(params.get("sessionId") or "") if isinstance(params, dict) else ""
        # Líneas escritas para esta sesión cuando arrancó el handler: por encima
        # de esto es el motor el que ha hablado (lo emitido antes, como
        # `session.turn.started`, va con otra clave y no cuenta).
        self._baseline = bridge._flush_seq.get(self._session_id, 0)
        self._warns = 0
        self._timer: threading.Timer | None = None
        self._cancelled = False
        self._arm()

    def _arm(self, delay: float | None = None) -> None:
        if delay is None:
            delay = _watchdog_delays(self._method)[0]
        timer = threading.Timer(delay, self._fire)
        timer.daemon = True
        self._timer = timer
        timer.start()

    def cancel(self) -> None:
        """La RPC terminó: no hace falta seguir vigilando."""
        self._cancelled = True
        if self._timer is not None:
            self._timer.cancel()

    def _fire(self) -> None:
        if self._cancelled:
            return
        warned, delay = self._bridge._watchdog_fire(
            self._method, self._params, self._started, self._baseline
        )
        if warned:
            self._warns += 1
        if delay is None or self._warns >= _WATCHDOG_MAX_WARNINGS or self._cancelled:
            return
        self._arm(delay)  # aún sin resolver: reprograma para más tarde


class Bridge:
    def __init__(self, protocol_out: TextIO) -> None:
        self._started = time.monotonic()
        self._session_list_cache: tuple[float, dict[str, Any]] | None = None
        self._session_list_task: asyncio.Task[dict[str, Any]] | None = None
        self._stt_status_cache: tuple[float, dict[str, Any]] | None = None
        # Catálogo de modelos por proveedor (red) + single-flight.
        self._models_cache: dict[str, tuple[float, list]] = {}
        self._models_task: dict[str, asyncio.Task[tuple[list, str | None]]] = {}
        # Última notificación emitida por sesión: la "señal de vida" que mira el
        # watchdog para distinguir un motor lento de uno congelado.
        # Cuándo se ESCRIBIÓ la última línea de cada sesión, y cuántas se han
        # escrito. Solo una línea real en el stream demuestra que el motor sigue
        # vivo (una encolada no: con el event loop congelado nadie la drena).
        # El **contador** manda para decidir si hubo salida: `time.monotonic()`
        # en Windows tiene ~1 ms de resolución y dos sucesos en el mismo ms
        # empatan, lo que hacía fallar la comparación por tiempos.
        self._last_flush: dict[str, float] = {}
        self._flush_seq: dict[str, int] = {}
        # Serializa las escrituras al stream de protocolo: el writer del loop y
        # el hilo del watchdog pueden escribir a la vez.
        self._out_lock = threading.Lock()
        self._out_stream = protocol_out
        self._out: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self.config = load_config()
        self.sessions = SessionManager(self.config, self._emit)
        self.stt = SttManager(self._emit)
        # Sesión inicial *reservada*: el `PhosonRepl` se construye en un hilo la
        # primera vez que alguien lo necesite (`SessionManager.get`), para que el
        # sidecar empiece a leer stdin sin pagar el arranque del engine.
        self._default_session = self.sessions.create()
        # …y se precalienta enseguida, en segundo plano: así `initialize` no paga
        # esos segundos si llega cuando el engine ya está construido.
        self._warm_task: asyncio.Task[Any] = asyncio.create_task(self._warm_default())
        self._methods = {
            "initialize": self._initialize,
            "session.new": self._session_new,
            "session.list": self._session_list,
            "session.open": self._session_open,
            "session.close": self._session_close,
            "session.delete": self._session_delete,
            "turn.run": self._turn_run,
            "turn.cancel": self._turn_cancel,
            "session.undo": self._session_undo,
            "session.rewind": self._session_rewind,
            "session.jumpCandidates": self._session_jump_candidates,
            "session.compact": self._session_compact,
            "session.planCompact": self._session_plan_compact,
            "model.set": self._model_set,
            "provider.set": self._provider_set,
            "models.list": self._models_list,
            "config.get": self._config_get,
            "config.set": self._config_set,
            "fs.cwd": self._fs_cwd,
            "fs.list": self._fs_list,
            "fs.setCwd": self._fs_set_cwd,
            "fs.read": self._fs_read,
            "fs.readImage": self._fs_read_image,
            "upload.file": self._upload_file,
            "fs.write": self._fs_write,
            "mcp.get": self._mcp_get,
            "mcp.save": self._mcp_save,
            "mcp.remove": self._mcp_remove,
            "attachment.list": self._attachment_list,
            "attachment.push": self._attachment_push,
            "attachment.remove": self._attachment_remove,
            "attachment.add": self._attachment_add,
            "attachment.clear": self._attachment_clear,
            "confirm.respond": self._confirm_respond,
            "stt.status": self._stt_status,
            "stt.start": self._stt_start,
            "stt.stop": self._stt_stop,
            "perf": self._perf,
            "shutdown": self._shutdown,
        }

    # ── Emisión (síncrona desde el sink, no bloquea) ──────────────────────
    def _emit(self, method: str, params: dict[str, Any], *, life: bool = True) -> None:
        """Encola una notificación. ``life=False`` para las que emite el propio
        bridge (p. ej. `session.turn.started`): no demuestran que el motor esté
        vivo y no deben silenciar al watchdog."""
        session_id = str(params.get("sessionId") or "")
        self._out.put_nowait((session_id if life else "-", dump({"jsonrpc": "2.0", "method": method, "params": params})))

    def _send(self, message: dict[str, Any]) -> None:
        # `"-"` = sin sesión: una respuesta RPC no cuenta como vida de ninguna.
        self._out.put_nowait(("-", dump(message)))

    async def _writer(self) -> None:
        while True:
            session_id, line = await self._out.get()
            self._last_flush[session_id] = time.monotonic()
            self._flush_seq[session_id] = self._flush_seq.get(session_id, 0) + 1
            with self._out_lock:
                self._out_stream.write(line + "\n")
                self._out_stream.flush()

    async def _warm_default(self) -> None:
        """Construye el engine de la sesión por defecto mientras no hay RPC.

        La misma construcción que haría `initialize`, pero sin que nadie la
        espere: si la primera petición llega cuando ya está hecha, no la paga.
        """
        try:
            await self.sessions.get(self._default_session)
        except Exception:  # noqa: BLE001 — un precalentado fallido no tumba nada
            log.exception("precalentado del engine falló")

    # ── Loop principal ────────────────────────────────────────────────────
    async def serve(self) -> None:
        writer = asyncio.create_task(self._writer())
        try:
            while True:
                raw = await asyncio.to_thread(sys.stdin.readline)
                if not raw:
                    break
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    log.warning("línea no-JSON ignorada: %r", raw[:200])
                    continue
                # JSON válido pero no-objeto (p. ej. `[1,2]`): `_dispatch` haría
                # `message.get` y lanzaría antes del try, perdiéndose el error
                # (el task es fire-and-forget).
                if not isinstance(message, dict):
                    log.warning("línea JSON no-objeto ignorada: %r", raw[:200])
                    continue
                asyncio.create_task(self._dispatch(message))
        finally:
            writer.cancel()
            # Cierra el micrófono antes de tumbar el loop (si no, el `asyncio.run`
            # cancela las capturas abruptamente y puede dejar audio a medias).
            await self.stt.stop_all()
            await self.sessions.close_all()

    async def _dispatch(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        method = message.get("method", "")
        params = message.get("params") or {}
        handler = self._methods.get(method)
        if handler is None:
            self._send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": f"método desconocido: {method}"},
                }
            )
            return
        if method == "turn.run":
            # `life=False`: la emite el bridge, no el motor; no demuestra vida.
            self._emit(
                "session.turn.started",
                {"sessionId": params.get("sessionId"), "task": params.get("text", "")},
                life=False,
            )
        # Watchdog (hilo aparte): avisa si la RPC se queda en silencio.
        started = time.monotonic()
        watchdog = _WatchdogHandle(self, method, params, started)
        try:
            _t = time.perf_counter()
            result = await handler(params)
            _ms = (time.perf_counter() - _t) * 1000
            # Traza de rendimiento: siempre initialize/turn.run; el resto solo si
            # es lento (evita ruido en stderr).
            if method in ("initialize", "turn.run") or _ms >= 50:
                log.info("[perf] %s %.0fms", method, _ms)
            # Una mutación (turno guardado, borrado…) invalida la lista cacheada.
            if method in _SESSION_MUTATING:
                self._session_list_cache = None
            self._send({"jsonrpc": "2.0", "id": request_id, "result": result})
            if method in ("turn.run", "model.set", "provider.set"):
                self._emit("session.metrics", await self._metrics(params["sessionId"]))
        except Exception as exc:  # noqa: BLE001 — el bridge nunca debe caerse
            log.exception("fallo en %s", method)
            self._send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32000, "message": str(exc)},
                }
            )
        finally:
            watchdog.cancel()

    def _watchdog_fire(
        self, method: str, params: Any, started: float, baseline: int
    ) -> tuple[bool, float | None]:
        """Decide si avisar y cuánto esperar para la próxima comprobación.

        Devuelve ``(avisó, retardo)``; el retardo es ``None`` cuando ya no hace
        falta seguir vigilando. Corre en el hilo del watchdog y escribe
        **directo** al stream de protocolo (con el mismo lock que `_writer`):
        con el event loop congelado la cola `_out` no se drena y el aviso no
        llegaría nunca a la app.

        "Vivo" = hubo una notificación **del motor** encolada *y* escrita
        después de arrancar el handler. Hacen falta las dos: con el loop
        congelado lo encolado no llega a escribirse, y lo emitido antes de
        arrancar el handler (p. ej. `session.turn.started`, del propio bridge)
        no demuestra que el motor siga ahí.
        """
        session_id = str(params.get("sessionId") or "") if isinstance(params, dict) else ""
        t_start, t_silence = _watchdog_delays(method)
        now = time.monotonic()

        if self._flush_seq.get(session_id, 0) <= baseline:
            # Arranque mudo: el handler no ha llegado a escribir nada.
            elapsed = now - started
            if elapsed < t_start:
                return False, t_start - elapsed
            self._warn(method, session_id, elapsed)
            return True, t_start

        # Escribió y se calló: solo avisa si el silencio es prolongado.
        silent_for = now - self._last_flush.get(session_id, started)
        if silent_for < t_silence:
            return False, t_silence - silent_for
        self._warn(method, session_id, silent_for)
        return True, t_silence

    def _warn(self, method: str, session_id: str, seconds: float) -> None:
        log.warning("watchdog: %s en silencio (%.0fs)", method, seconds)
        line = dump(
            {
                "jsonrpc": "2.0",
                "method": "notify",
                "params": {
                    "sessionId": session_id,
                    "kind": "warn",
                    "message": (
                        f"El motor lleva {seconds:.0f} s sin enviar nada ({method}). "
                        "Si crees que se ha colgado, cancela el turno o reinicia el motor "
                        "desde Ajustes."
                    ),
                },
            }
        )
        try:
            with self._out_lock:
                self._out_stream.write(line + "\n")
                self._out_stream.flush()
        except Exception:  # noqa: BLE001 — un aviso jamás debe romper el sidecar
            log.exception("watchdog: no se pudo escribir el aviso")

    # ── Helpers ───────────────────────────────────────────────────────────
    async def _perf(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Uso de recursos del sidecar (RSS + CPU), para medir desde la app."""
        try:
            import resource

            maxrss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # Linux: KB · macOS: bytes.
            rss_bytes = int(maxrss) if sys.platform == "darwin" else int(maxrss) * 1024
        except Exception:  # noqa: BLE001 — nunca tumbar la UI por medir
            rss_bytes = 0
        times = os.times()
        return {
            "pid": os.getpid(),
            "rssBytes": rss_bytes,
            "cpuUserSec": times.user,
            "cpuSystemSec": times.system,
            "uptimeSec": round(time.monotonic() - self._started, 3),
        }

    async def _metrics(self, session_key: str) -> dict[str, Any]:
        repl = await self.sessions.get(session_key)
        metrics = repl.session_metrics
        tokens = metrics.total_input_tokens + metrics.total_output_tokens
        return {
            # El frontend enruta las notificaciones por `sessionId`: sin él, las
            # métricas se descartan (y el modelo seleccionado no se actualiza).
            "sessionId": session_key,
            "costUsd": metrics.total_cost_usd,
            "credits": metrics.total_credits,
            "tokens": tokens,
            "inputTokens": metrics.total_input_tokens,
            "outputTokens": metrics.total_output_tokens,
            "steps": metrics.step_count,
            "contextTokens": repl._controller.context_tokens,
            "contextWindow": repl._controller.context_window,
            "model": repl.current_model,
            "provider": repl.config.provider,
            "isRunning": repl.is_running,
        }

    # ── Métodos RPC ───────────────────────────────────────────────────────
    async def _initialize(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Recupera la sesión por defecto si el front-end la cerró.
        self._default_session = self.sessions.ensure_any()
        repl = await self.sessions.get(self._default_session)
        visible = engine_visible_tools(repl.engine)
        return {
            "config": {
                "model": repl.current_model,
                "provider": repl.config.provider,
                "theme": repl.config.theme,
                "sessionsDir": str(repl.config.sessions_dir),
                "safeMode": repl.config.safe_mode,
            },
            "tools": {
                "visible": [getattr(t, "name", str(t)) for t in visible],
                "maskedCount": engine_masked_count(repl.engine),
            },
            "commands": [
                {"names": list(spec.names), "help": getattr(spec, "help", "")}
                for spec in repl._controller.command_catalog.specs
            ],
            # El front-end decide si lanzar el onboarding de primera ejecución.
            "onboarding": {
                "needed": not has_configured_provider(repl.config),
                "providers": self._provider_status(repl.config),
            },
            "defaultSessionId": self._default_session,
            "cwd": os.getcwd(),
            "metrics": await self._metrics(self._default_session),
        }

    async def _session_new(self, _params: dict[str, Any]) -> dict[str, Any]:
        key = self.sessions.create()
        # El cwd del proceso es el workspace del sidecar (uno por proyecto).
        return {"sessionId": key, "cwd": os.getcwd()}

    async def _session_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Historial COMPLETO: todas las sesiones guardadas, de cualquier
        # workspace. Los sidecars comparten `sessions_dir`, así que cualquiera
        # puede listarlas; el `cwd` de cada `SessionMeta` permite abrirla en su
        # propio sidecar (enrutado por workspace en el frontend).
        #
        # Listar es caro (lee y parsea todos los .jsonl). Dos protecciones:
        #  - caché con TTL (ráfagas separadas en el tiempo);
        #  - **single-flight**: `serve()` despacha en tareas concurrentes, así que
        #    varias llamadas a la vez comparten UNA sola lectura en vuelo.
        cached = self._session_list_cache
        if cached is not None and (time.monotonic() - cached[0]) < _SESSION_LIST_TTL:
            return cached[1]
        if self._session_list_task is None:
            self._session_list_task = asyncio.create_task(self._compute_session_list())
        task = self._session_list_task
        try:
            return await task
        finally:
            if self._session_list_task is task:
                self._session_list_task = None

    async def _compute_session_list(self) -> dict[str, Any]:
        sessions = await self.sessions.storage().list_sessions()
        payload = {"sessions": [to_jsonable(s) for s in sessions]}
        self._session_list_cache = (time.monotonic(), payload)
        return payload

    async def _session_delete(self, params: dict[str, Any]) -> dict[str, Any]:
        """Elimina una sesión guardada (borra su archivo JSONL).

        No afecta a las sesiones abiertas en memoria: el frontend la quita de la
        lista de guardadas.
        """
        session_id = str(params.get("id") or "")
        if not session_id:
            raise ValueError("falta el id de la sesión a eliminar")
        await self.sessions.storage().delete(session_id)
        return {"ok": True, "id": session_id}

    async def _session_open(self, params: dict[str, Any]) -> dict[str, Any]:
        key = self.sessions.create()
        repl = await self.sessions.get(key)
        ok = await repl.load_session(params["id"])
        if not ok:
            await self.sessions.close(key)
            raise ValueError(f"no se pudo cargar la sesión {params['id']}")

        # Respeta el directorio de trabajo con el que se creó la sesión: los tools
        # resuelven las rutas relativas contra el cwd del PROCESO.
        session_cwd = str(getattr(repl._controller.tree, "cwd", "") or "")
        adopted = os.getcwd()
        if session_cwd and os.path.isdir(session_cwd):
            os.chdir(session_cwd)
            adopted = session_cwd
        elif session_cwd:
            log.warning("la sesión %s apunta a un cwd inexistente: %s", params["id"], session_cwd)

        self._emit("session.info", {"sessionId": key, "cwd": adopted})
        return {
            "sessionId": key,
            "cwd": adopted,
            "sessionCwd": session_cwd,
            "cwdMissing": bool(session_cwd) and not os.path.isdir(session_cwd),
        }

    async def _session_close(self, params: dict[str, Any]) -> dict[str, Any]:
        await self.sessions.close(params["sessionId"])
        # Nunca dejamos el bridge sin sesiones: el front-end puede cerrar todas.
        self._default_session = self.sessions.ensure_any()
        return {"ok": True, "defaultSessionId": self._default_session}

    async def _turn_run(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        for path in params.get("attachments") or []:
            repl._controller.attachments.attach(path)
        outcome = await repl._run_agent(params["text"])
        self._emit(
            "session.assistant.done",
            {
                "sessionId": params["sessionId"],
                "status": outcome.status,
                "errorCode": outcome.error_code,
                "finalContent": outcome.final_content,
            },
        )
        return {
            "status": outcome.status,
            "errorCode": outcome.error_code,
            "finalContent": outcome.final_content,
        }

    async def _turn_cancel(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"cancelled": (await self.sessions.get(params["sessionId"])).cancel_current()}

    @staticmethod
    def _history_messages(repl: Any) -> list[Any]:
        """Mensajes del camino activo, para que la UI refresque tras mutar el
        historial (undo/rewind/compact). Se devuelven en la RESPUESTA RPC y no
        como notificación: así el frontend los aplica al resolver la llamada, sin
        carrera con un envío inmediato."""
        path = repl._controller._node_path()
        return [to_jsonable(n.message) for n in path]

    async def _session_undo(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        ok, message = repl.undo_last_turn()
        return {
            "ok": ok,
            "message": message,
            "history": self._history_messages(repl) if ok else None,
        }

    async def _session_rewind(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        ok, message = repl.jump_to_user_turn(params["userNodeId"])
        return {
            "ok": ok,
            "message": message,
            "history": self._history_messages(repl) if ok else None,
        }

    async def _session_jump_candidates(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        return {"candidates": [{"userNodeId": nid, "preview": txt} for nid, txt in repl.jump_candidates()]}

    async def _session_compact(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        before, after, ok = await repl.compact_context(params.get("profile"))
        return {
            "ok": ok,
            "before": before,
            "after": after,
            "history": self._history_messages(repl) if ok else None,
        }

    async def _session_plan_compact(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        return to_jsonable(repl.plan_compaction(params.get("profile")))

    async def _model_set(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        await repl.set_model(params["model"], provider=params.get("provider"))
        return {"ok": True, "model": repl.current_model}

    async def _provider_set(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        await repl.set_provider(params["provider"])
        self._invalidate_models()
        return {"ok": True, "provider": repl.config.provider}

    async def _models_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lista viva de modelos del proveedor activo (I-113), con overrides.

        Reutiliza `list_available_models` del CLI: consulta al proveedor en
        directo y aplica los overrides de `~/.phoson/models.json`. Si la red
        falla, degrada al modelo actual (comportamiento del engine).

        Cacheado por proveedor (`_MODELS_LIST_TTL`) y con single-flight: el
        picker lo abre a menudo y la respuesta solo cambia cuando cambia el
        catálogo del proveedor. Un fallo de red NO se cachea (reintenta en la
        siguiente llamada).
        """
        repl = await self.sessions.get(params["sessionId"])
        cfg = repl.config
        current = {"model": repl.current_model, "provider": cfg.provider}
        key = f"{cfg.provider}|{getattr(cfg, 'base_url', '') or ''}"

        cached = self._models_cache.get(key)
        if cached is not None and (time.monotonic() - cached[0]) < _MODELS_LIST_TTL:
            return {"current": current, "models": cached[1], "cached": True}

        task = self._models_task.get(key)
        if task is None:
            task = asyncio.create_task(self._fetch_models(cfg))
            self._models_task[key] = task
        try:
            models, error = await task
        finally:
            if self._models_task.get(key) is task:
                self._models_task.pop(key, None)

        if error is not None:
            return {"current": current, "models": [], "error": error}
        self._models_cache[key] = (time.monotonic(), models)
        return {"current": current, "models": models}

    async def _fetch_models(self, cfg: Any) -> tuple[list, str | None]:
        """Catálogo del proveedor serializado, o `(None, error)` si falla."""
        from phoson_cli.model_selector import list_available_models

        try:
            options = await list_available_models(cfg)
        except Exception as exc:  # noqa: BLE001 — la UI nunca debe caerse
            log.warning("models.list falló: %s", exc)
            return [], str(exc)
        return [to_jsonable(o) for o in options], None

    def _invalidate_models(self) -> None:
        """El catálogo depende del proveedor/base_url: un cambio los invalida."""
        self._models_cache.clear()

    # ── Configuración ─────────────────────────────────────────────────────
    # Campos que la GUI puede escribir (seguros de persistir).
    _SAFE_FIELDS = (
        "provider",
        "model",
        "subagent_model",
        "reasoning_effort",
        "safe_mode",
        "theme",
        "notify_on_completion",
        "enable_mcp",
    )
    #: provider id -> campos del config (clave y/o base_url), en el orden de
    #: presentación en la UI. `bedrock` no tiene campo propio: usa la cadena de
    #: credenciales de AWS. `ollama`/`lmstudio` solo necesitan base_url.
    _PROVIDERS: dict[str, dict[str, str]] = {
        "openrouter": {"key": "openrouter_api_key"},
        "openai": {"key": "openai_api_key"},
        "anthropic": {"key": "anthropic_api_key"},
        "ollama": {"base_url": "ollama_base_url"},
        "github": {"key": "github_token"},
        "nvidia": {"key": "nvidia_api_key"},
        "xai": {"key": "xai_api_key"},
        "groq": {"key": "groq_api_key"},
        "deepseek": {"key": "deepseek_api_key"},
        "together": {"key": "together_api_key"},
        "perplexity": {"key": "perplexity_api_key"},
        "lmstudio": {"base_url": "lmstudio_base_url"},
        "vllm": {"key": "vllm_api_key", "base_url": "vllm_base_url"},
        "azure": {"key": "azure_openai_api_key"},
        "gemini": {"key": "gemini_api_key"},
        "mistral": {"key": "mistral_api_key"},
        "bedrock": {},
        "fireworks": {"key": "fireworks_api_key"},
        "cohere": {"key": "cohere_api_key"},
        "omniroute": {"key": "omniroute_api_key", "base_url": "omniroute_base_url"},
    }

    def _provider_status(self, cfg: Any) -> list[dict[str, Any]]:
        """Estado de cada proveedor.

        Indica si tiene clave (y su procedencia, **nunca el valor**), y la
        `base_url` configurada cuando el proveedor la admite (no es secreta).
        """
        sources = dict(getattr(cfg, "_secret_sources", {}) or {})
        out: list[dict[str, Any]] = []
        for pid, fields in self._PROVIDERS.items():
            key_field = fields.get("key")
            url_field = fields.get("base_url")
            out.append(
                {
                    "id": pid,
                    "hasKey": bool(getattr(cfg, key_field, None)) if key_field else False,
                    "source": (sources.get(key_field, "default") if key_field else "default"),
                    "supportsKey": bool(key_field),
                    "supportsBaseUrl": bool(url_field),
                    "baseUrl": (getattr(cfg, url_field, None) or "") if url_field else "",
                }
            )
        return out

    async def _config_get(self, params: dict[str, Any]) -> dict[str, Any]:
        """Config efectiva para el panel. Los secretos NUNCA se envían: solo
        su procedencia (`file`/`env`/`default`) y si están presentes."""
        from phoson_cli.config import (
            has_configured_provider,
            enabled_providers_from_config,
        )

        repl = await self.sessions.get(params["sessionId"])
        cfg = repl.config
        return {
            "provider": cfg.provider,
            "model": cfg.model,
            "subagentModel": cfg.subagent_model,
            "reasoningEffort": cfg.reasoning_effort,
            "theme": cfg.theme,
            "safeMode": cfg.safe_mode,
            "notifyOnCompletion": cfg.notify_on_completion,
            "sessionsDir": str(cfg.sessions_dir),
            "enabledProviders": enabled_providers_from_config(cfg, for_persistence=True),
            "providers": self._provider_status(cfg),
            "hasProvider": has_configured_provider(cfg),
            "enableMcp": bool(getattr(cfg, "enable_mcp", False)),
            "mcpConfigFile": str(getattr(cfg, "mcp_config_file", "")),
        }

    async def _config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Persiste un patch de campos seguros y, opcionalmente, claves de API
        (write-only: entran, nunca salen)."""
        from phoson_cli.config import save_config

        repl = await self.sessions.get(params["sessionId"])
        cfg = repl.config
        patch = params.get("patch") or {}
        secrets = params.get("secrets") or {}

        touched: set[str] = set()
        for field in self._SAFE_FIELDS:
            if field in patch:
                setattr(cfg, field, patch[field])
                touched.add(field)
        for pid, value in secrets.items():
            field = self._PROVIDERS.get(str(pid), {}).get("key")
            if field and value:
                setattr(cfg, field, value)
                touched.add(field)
        for pid, value in (params.get("base_urls") or {}).items():
            field = self._PROVIDERS.get(str(pid), {}).get("base_url")
            if field is not None:
                setattr(cfg, field, value or None)
                touched.add(field)

        only = set(self._SAFE_FIELDS) | touched | {"enabled_providers"}
        path = save_config(cfg, only_fields=only, explicit_secret_fields=touched)

        # Aplicar en vivo lo que el engine necesita (cliente/modelo/base_url).
        if "provider" in patch or touched:
            try:
                await repl.set_provider(cfg.provider)
            except Exception as exc:  # noqa: BLE001 — guardar no debe fallar por el rebuild
                log.warning("set_provider tras config.set falló: %s", exc)

        self._emit("session.metrics", await self._metrics(params["sessionId"]))
        # Cambios de proveedor/base_url/clave → el catálogo cacheado ya no sirve.
        self._invalidate_models()
        return {"ok": True, "path": str(path), "config": await self._config_get(params)}

    # ── Explorador de archivos (workspace) ────────────────────────────────
    #: Directorios ruidosos que el explorador omite.
    _NOISE_DIRS = {
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    }

    async def _fs_cwd(self, _params: dict[str, Any]) -> dict[str, Any]:
        """Directorio de trabajo del sidecar (el que ven los tools)."""
        return {"cwd": os.getcwd()}

    async def _fs_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lista un directorio para el explorador.

        No expone nada que el engine no tenga ya: los tools del agente operan
        sobre el sistema de archivos completo.
        """
        from pathlib import Path

        target = Path(params.get("path") or os.getcwd()).expanduser()
        try:
            target = target.resolve()
        except OSError:
            pass
        if not target.is_dir():
            raise ValueError(f"no es un directorio: {target}")

        entries: list[dict[str, Any]] = []
        with os.scandir(target) as it:
            for entry in it:
                try:
                    is_dir = entry.is_dir()
                except OSError:
                    continue
                if is_dir and entry.name in self._NOISE_DIRS:
                    continue
                stat = None
                try:
                    stat = entry.stat()
                except OSError:
                    pass
                entries.append(
                    {
                        "name": entry.name,
                        "dir": is_dir,
                        "hidden": entry.name.startswith("."),
                        "size": None if (is_dir or stat is None) else stat.st_size,
                        "mtime": None if stat is None else int(stat.st_mtime),
                    }
                )
        entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
        return {
            "path": str(target),
            "parent": str(target.parent) if target.parent != target else None,
            "entries": entries[:400],
            "truncated": len(entries) > 400,
        }

    async def _fs_set_cwd(self, params: dict[str, Any]) -> dict[str, Any]:
        """Fija el directorio de trabajo del proceso del sidecar.

        Los tools del engine resuelven las rutas relativas contra el cwd del
        proceso, así que este es el *workspace* real del agente. Las sesiones
        nuevas registran este cwd en su metadata (`tree.cwd`).
        """
        from pathlib import Path

        target = Path(params["path"]).expanduser().resolve()
        if not target.is_dir():
            raise ValueError(f"no es un directorio: {target}")
        os.chdir(target)
        # La sesión por defecto aún puede adoptar el nuevo workspace.
        self._default_session = self.sessions.ensure_any()
        repl = await self.sessions.get(self._default_session)
        repl._controller.tree.cwd = str(target)
        self._emit("session.info", {"sessionId": self._default_session, "cwd": str(target)})
        return {"cwd": str(target)}

    #: Límite de lectura para el visor de código (512 KB).
    _MAX_READ = 512 * 1024

    async def _fs_read(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lee un archivo de texto para el visor. Detecta binarios por NUL o
        por fallo de decodificación UTF-8."""
        from pathlib import Path

        target = Path(params["path"]).expanduser().resolve()
        if not target.is_file():
            raise ValueError(f"no es un archivo: {target}")
        size = target.stat().st_size
        raw = target.read_bytes()[: self._MAX_READ]
        if b"\x00" in raw[:8192]:
            return {"path": str(target), "binary": True, "text": "", "size": size, "truncated": False}
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return {"path": str(target), "binary": True, "text": "", "size": size, "truncated": False}
        return {
            "path": str(target),
            "binary": False,
            "text": text,
            "size": size,
            "truncated": size > self._MAX_READ,
        }

    #: Extensiones de imagen que la webview puede previsualizar.
    _IMAGE_MIME: dict[str, str] = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".avif": "image/avif",
    }
    #: Límite para previsualizar (el base64 pesa ~1.33× en el JSON).
    _MAX_IMAGE_READ = 12 * 1024 * 1024

    async def _fs_read_image(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lee una imagen local como base64 para previsualizarla en la webview.

        La webview no puede abrir rutas del sistema, así que se devuelve el
        contenido embebido (data URL en el frontend). Solo imágenes y con tope de
        tamaño; el path relativo se resuelve contra el cwd del workspace.
        """
        import base64
        from pathlib import Path

        target = Path(str(params.get("path") or "")).expanduser().resolve()
        if not target.is_file():
            raise ValueError(f"no es un archivo: {target}")
        mime = self._IMAGE_MIME.get(target.suffix.lower())
        if mime is None:
            raise ValueError(f"extensión no previsualizable: {target.suffix or '(sin extensión)'}")
        size = target.stat().st_size
        if size > self._MAX_IMAGE_READ:
            raise ValueError(
                f"imagen demasiado grande para previsualizar ({size} bytes, "
                f"máx {self._MAX_IMAGE_READ})"
            )
        data = base64.b64encode(target.read_bytes()).decode("ascii")
        return {"path": str(target), "mediaType": mime, "size": size, "base64": data}

    #: Tope para subir archivos no nativos al workspace (50 MB).
    _MAX_UPLOAD = 50 * 1024 * 1024

    async def _upload_file(self, params: dict[str, Any]) -> dict[str, Any]:
        """Sube al workspace un archivo NO soportado como adjunto nativo.

        Se escribe en ``<cwd>/uploads/`` (deduplicando el nombre) y se devuelve
        la ruta **relativa** para que el prompt pueda referenciarlo y el agente
        lo lea con ``read_file``.
        """
        import base64
        from pathlib import Path

        name = Path(str(params.get("name") or "archivo")).name or "archivo"
        data = str(params.get("data") or "")
        if not data:
            raise ValueError("falta el contenido del archivo")
        try:
            payload = base64.b64decode(data, validate=False)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"contenido base64 inválido: {exc}") from exc
        if len(payload) > self._MAX_UPLOAD:
            raise ValueError(
                f"archivo demasiado grande ({len(payload)} bytes, máx {self._MAX_UPLOAD})"
            )

        workspace = Path(os.getcwd())
        dest_dir = workspace / "uploads"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / name
        counter = 1
        while dest.exists():
            dest = dest_dir / f"{Path(name).stem}-{counter}{Path(name).suffix}"
            counter += 1
        dest.write_bytes(payload)
        try:
            relative = dest.relative_to(workspace).as_posix()
        except ValueError:
            relative = str(dest)
        return {
            "ok": True,
            "path": str(dest),
            "relative": relative,
            "name": dest.name,
            "size": len(payload),
        }

    async def _fs_write(self, params: dict[str, Any]) -> dict[str, Any]:
        """Escribe un archivo de texto (editor ligero)."""
        from pathlib import Path

        target = Path(params["path"]).expanduser().resolve()
        text = params.get("text", "")
        await asyncio.to_thread(target.write_text, text, encoding="utf-8")
        return {"ok": True, "path": str(target), "size": target.stat().st_size}

    # ── MCP ───────────────────────────────────────────────────────────────
    #: Formato en disco: ~/.phoson/mcps.json → {"mcpServers": {nombre: {...}}}
    def _mcp_load(self, cfg: Any) -> dict[str, Any]:
        from pathlib import Path

        path = Path(getattr(cfg, "mcp_config_file"))
        if not path.exists():
            return {"mcpServers": {}}
        try:
            data = json.loads(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:  # noqa: BLE001 — un JSON roto no debe tumbar la UI
            log.warning("mcps.json ilegible: %s", exc)
            return {"mcpServers": {}}
        return data if isinstance(data, dict) else {"mcpServers": {}}

    @staticmethod
    def _mcp_servers(data: dict[str, Any]) -> dict[str, Any]:
        servers = data.get("mcpServers")
        if not isinstance(servers, dict):
            servers = data.get("servers")
        return servers if isinstance(servers, dict) else {}

    def _mcp_store(self, cfg: Any, data: dict[str, Any]) -> str:
        from pathlib import Path

        path = Path(getattr(cfg, "mcp_config_file"))
        path.parent.mkdir(parents=True, exist_ok=True)
        out = dict(data)
        out["mcpServers"] = self._mcp_servers(data)
        out.pop("servers", None)  # normaliza a la forma canónica
        path.write_text(
            json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return str(path)

    def _mcp_summary(self, cfg: Any) -> dict[str, Any]:
        from pathlib import Path

        try:
            from phoson_plugin_mcp._plugin import MCP_AVAILABLE
        except Exception:  # noqa: BLE001 — plugin no instalado
            MCP_AVAILABLE = False

        servers = []
        for name, spec in sorted(self._mcp_servers(self._mcp_load(cfg)).items()):
            spec = spec if isinstance(spec, dict) else {}
            env = spec.get("env") or {}
            servers.append(
                {
                    "name": name,
                    "transport": spec.get("transport") or ("sse" if spec.get("url") else "stdio"),
                    "command": spec.get("command", "") or "",
                    "args": [str(a) for a in (spec.get("args") or [])],
                    "url": spec.get("url", "") or "",
                    "enabled": bool(spec.get("enabled", True)),
                    # Solo los NOMBRES: los valores suelen ser tokens.
                    "envKeys": sorted(env.keys()) if isinstance(env, dict) else [],
                }
            )
        return {
            "enabled": bool(getattr(cfg, "enable_mcp", False)),
            "configPath": str(Path(getattr(cfg, "mcp_config_file"))),
            "sdkAvailable": bool(MCP_AVAILABLE),
            "servers": servers,
        }

    async def _mcp_get(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        return self._mcp_summary(repl.config)

    async def _mcp_save(self, params: dict[str, Any]) -> dict[str, Any]:
        """Crea o actualiza un servidor MCP, y recarga los plugins."""
        repl = await self.sessions.get(params["sessionId"])
        cfg = repl.config
        name = str(params["name"]).strip()
        if not name:
            raise ValueError("el nombre del servidor no puede estar vacío")
        incoming = params.get("server") or {}

        data = self._mcp_load(cfg)
        servers = dict(self._mcp_servers(data))
        spec = dict(servers.get(name) or {})

        for key in ("transport", "command", "url"):
            if key in incoming:
                spec[key] = incoming[key]
        if "args" in incoming:
            spec["args"] = [a for a in incoming["args"] if str(a) != ""]
        if "enabled" in incoming:
            spec["enabled"] = bool(incoming["enabled"])

        env = dict(spec.get("env") or {})
        for key, value in (incoming.get("env") or {}).items():
            if value:
                env[key] = value
            else:
                env.pop(key, None)  # vaciar un valor lo elimina
        if env:
            spec["env"] = env
        else:
            spec.pop("env", None)

        for key in ("command", "url", "args"):
            if not spec.get(key):
                spec.pop(key, None)

        servers[name] = spec
        data["mcpServers"] = servers
        path = self._mcp_store(cfg, data)
        await self._reload_plugins(repl)
        return {"ok": True, "path": path, "mcp": self._mcp_summary(cfg)}

    async def _mcp_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        cfg = repl.config
        data = self._mcp_load(cfg)
        servers = dict(self._mcp_servers(data))
        servers.pop(str(params["name"]), None)
        data["mcpServers"] = servers
        path = self._mcp_store(cfg, data)
        await self._reload_plugins(repl)
        return {"ok": True, "path": path, "mcp": self._mcp_summary(cfg)}

    # ── Adjuntos (pegar / arrastrar archivos) ─────────────────────────────
    #: Tope de tamaño al materializar un archivo enviado desde la UI.
    _MAX_PUSH = 25 * 1024 * 1024

    def _attachment_payload(self, repl: Any) -> list[dict[str, Any]]:
        """Vista normalizada de los adjuntos pendientes: ruta, nombre y tipo."""
        from pathlib import Path

        out: list[dict[str, Any]] = []
        for att in repl._controller.attachments.list_pending():
            path = str(getattr(att, "path", ""))
            block = getattr(att, "block", None)
            kind = type(block).__name__.replace("Block", "").lower() if block else "file"
            out.append({"path": path, "name": Path(path).name, "kind": kind})
        return out

    async def _attachment_list(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        return {"attachments": self._attachment_payload(repl)}

    async def _attachment_push(self, params: dict[str, Any]) -> dict[str, Any]:
        """Materializa un archivo enviado por la UI (base64) y lo adjunta.

        Pegar/arrastrar en la WebView no da rutas del sistema, así que el
        archivo viaja por contenido y el sidecar lo escribe en
        `~/.phoson/attachments/` antes de usar `AttachmentManager.attach`.
        """
        import base64
        import uuid as _uuid
        from pathlib import Path

        repl = await self.sessions.get(params["sessionId"])
        raw = base64.b64decode(params.get("data") or "")
        if not raw:
            raise ValueError("archivo vacío")
        if len(raw) > self._MAX_PUSH:
            raise ValueError("archivo demasiado grande (máx. 25 MB)")

        name = Path(str(params.get("name") or "archivo")).name or "archivo"
        dest_dir = Path(repl.config.sessions_dir).expanduser().parent / "attachments"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{_uuid.uuid4().hex[:8]}-{name}"
        dest.write_bytes(raw)
        try:
            repl._controller.attachments.attach(str(dest))
        except Exception:
            dest.unlink(missing_ok=True)  # tipo no soportado: no dejamos basura
            raise
        return {"ok": True, "attachments": self._attachment_payload(repl)}

    async def _attachment_remove(self, params: dict[str, Any]) -> dict[str, Any]:
        """Quita un adjunto pendiente.

        `AttachmentManager` no tiene remove, así que se re-adjunta el resto.
        """
        repl = await self.sessions.get(params["sessionId"])
        manager = repl._controller.attachments
        target = str(params.get("path") or "")
        keep = [str(a.path) for a in manager.list_pending() if str(a.path) != target]
        manager.clear()
        for path in keep:
            manager.attach(path)
        return {"ok": True, "attachments": self._attachment_payload(repl)}

    @staticmethod
    async def _reload_plugins(repl: Any) -> None:
        """Reconstruye el engine para que los plugins (MCP) reaccionen a los
        cambios del archivo de configuración."""
        try:
            await repl.set_provider(repl.config.provider)
        except Exception as exc:  # noqa: BLE001 — guardar no debe fallar por esto
            log.warning("recarga de plugins falló: %s", exc)

    async def _attachment_add(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        repl._controller.attachments.attach(params["path"])
        return {"attachments": to_jsonable(repl._controller.attachments.list_pending())}

    async def _attachment_clear(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = await self.sessions.get(params["sessionId"])
        repl._controller.attachments.clear()
        return {"attachments": []}

    async def _confirm_respond(self, params: dict[str, Any]) -> dict[str, Any]:
        ok = self.sessions.resolve_confirm(params["requestId"], params)
        return {"ok": ok}

    # ── Dictado por voz (STT del engine) ──────────────────────────────────
    async def _stt_status(self, _params: dict[str, Any]) -> dict[str, Any]:
        # Sondea plugin + runtime de audio; apenas cambia, así que se cachea.
        cached = self._stt_status_cache
        if cached is not None and (time.monotonic() - cached[0]) < _STT_STATUS_TTL:
            return cached[1]
        status = self.stt.status()
        self._stt_status_cache = (time.monotonic(), status)
        return status

    async def _stt_start(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.stt.start(
            str(params.get("sessionId") or ""),
            params.get("language"),
        )

    async def _stt_stop(self, params: dict[str, Any]) -> dict[str, Any]:
        return await self.stt.stop(str(params.get("sessionId") or ""))

    async def _shutdown(self, _params: dict[str, Any]) -> dict[str, Any]:
        await self.stt.stop_all()
        await self.sessions.close_all()
        return {"ok": True}


async def run_bridge(protocol_out: TextIO) -> None:
    bridge = Bridge(protocol_out)
    await bridge.serve()


def main(protocol_out: TextIO) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    try:
        asyncio.run(run_bridge(protocol_out))
    except KeyboardInterrupt:
        pass
