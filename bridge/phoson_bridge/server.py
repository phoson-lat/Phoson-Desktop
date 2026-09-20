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

import sys
import copy
import json
import uuid
import asyncio
import logging
from typing import Any, TextIO

from phoson_cli.config import load_config, PhosonConfig
from phoson_cli.repl import PhosonRepl
from phoson_cli.session_utils import engine_masked_count, engine_visible_tools

from .sink import GuiSink
from .protocol import dump, to_jsonable
from .confirmation import GuiConfirmation

log = logging.getLogger("phoson_bridge")


class SessionManager:
    """Un ``PhosonRepl`` por sesión, compartiendo el loop del sidecar."""

    def __init__(self, base_config: PhosonConfig, emit) -> None:
        self._base_config = base_config
        self._emit = emit
        self._loop = asyncio.get_running_loop()
        self._repls: dict[str, PhosonRepl] = {}
        self._confirmations: dict[str, asyncio.Future[dict[str, Any]]] = {}

    # -- ciclo de vida --------------------------------------------------------
    def create(self) -> str:
        key = uuid.uuid4().hex
        # Config propia por sesión: el controller muta config.model/provider.
        # `copy.copy` (superficial) basta: lo que se muta son escalares; el
        # config trae un `mappingproxy` en `_secret_sources` que rompe deepcopy.
        config = copy.copy(self._base_config)
        sink = GuiSink(key, self._emit)
        confirmation = GuiConfirmation(key, self.request_user)
        self._repls[key] = PhosonRepl(config, sink=sink, confirmation=confirmation)
        return key

    def get(self, key: str) -> PhosonRepl:
        repl = self._repls.get(key)
        if repl is None:
            raise KeyError(f"sesión desconocida: {key}")
        return repl

    async def close(self, key: str) -> None:
        repl = self._repls.pop(key, None)
        if repl is not None:
            await repl.shutdown()

    async def close_all(self) -> None:
        for key in list(self._repls):
            await self.close(key)

    def keys(self) -> list[str]:
        return list(self._repls)

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


class Bridge:
    def __init__(self, protocol_out: TextIO) -> None:
        self._out_stream = protocol_out
        self._out: asyncio.Queue[str] = asyncio.Queue()
        self.config = load_config()
        self.sessions = SessionManager(self.config, self._emit)
        # Sesión inicial lista para usar.
        self._default_session = self.sessions.create()
        self._methods = {
            "initialize": self._initialize,
            "session.new": self._session_new,
            "session.list": self._session_list,
            "session.open": self._session_open,
            "session.close": self._session_close,
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
            "attachment.add": self._attachment_add,
            "attachment.clear": self._attachment_clear,
            "confirm.respond": self._confirm_respond,
            "shutdown": self._shutdown,
        }

    # ── Emisión (síncrona desde el sink, no bloquea) ──────────────────────
    def _emit(self, method: str, params: dict[str, Any]) -> None:
        self._out.put_nowait(dump({"jsonrpc": "2.0", "method": method, "params": params}))

    def _send(self, message: dict[str, Any]) -> None:
        self._out.put_nowait(dump(message))

    async def _writer(self) -> None:
        while True:
            line = await self._out.get()
            self._out_stream.write(line + "\n")
            self._out_stream.flush()

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
                asyncio.create_task(self._dispatch(message))
        finally:
            writer.cancel()
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
            self._emit(
                "session.turn.started",
                {"sessionId": params.get("sessionId"), "task": params.get("text", "")},
            )
        try:
            result = await handler(params)
            self._send({"jsonrpc": "2.0", "id": request_id, "result": result})
            if method in ("turn.run", "model.set", "provider.set"):
                self._emit("session.metrics", self._metrics(params["sessionId"]))
        except Exception as exc:  # noqa: BLE001 — el bridge nunca debe caerse
            log.exception("fallo en %s", method)
            self._send(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32000, "message": str(exc)},
                }
            )

    # ── Helpers ───────────────────────────────────────────────────────────
    def _metrics(self, session_key: str) -> dict[str, Any]:
        repl = self.sessions.get(session_key)
        metrics = repl.session_metrics
        tokens = metrics.total_input_tokens + metrics.total_output_tokens
        return {
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
        repl = self.sessions.get(self._default_session)
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
            "defaultSessionId": self._default_session,
            "metrics": self._metrics(self._default_session),
        }

    async def _session_new(self, _params: dict[str, Any]) -> dict[str, Any]:
        key = self.sessions.create()
        return {"sessionId": key}

    async def _session_list(self, _params: dict[str, Any]) -> dict[str, Any]:
        sessions = await self.sessions.storage().list_sessions()
        return {"sessions": [to_jsonable(s) for s in sessions]}

    async def _session_open(self, params: dict[str, Any]) -> dict[str, Any]:
        key = self.sessions.create()
        repl = self.sessions.get(key)
        ok = await repl.load_session(params["id"])
        if not ok:
            await self.sessions.close(key)
            raise ValueError(f"no se pudo cargar la sesión {params['id']}")
        return {"sessionId": key}

    async def _session_close(self, params: dict[str, Any]) -> dict[str, Any]:
        await self.sessions.close(params["sessionId"])
        return {"ok": True}

    async def _turn_run(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
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
        return {"cancelled": self.sessions.get(params["sessionId"]).cancel_current()}

    async def _session_undo(self, params: dict[str, Any]) -> dict[str, Any]:
        ok, message = self.sessions.get(params["sessionId"]).undo_last_turn()
        return {"ok": ok, "message": message}

    async def _session_rewind(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        ok, message = repl.jump_to_user_turn(params["userNodeId"])
        return {"ok": ok, "message": message}

    async def _session_jump_candidates(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        return {"candidates": [{"userNodeId": nid, "preview": txt} for nid, txt in repl.jump_candidates()]}

    async def _session_compact(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        before, after, ok = await repl.compact_context(params.get("profile"))
        return {"ok": ok, "before": before, "after": after}

    async def _session_plan_compact(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        return to_jsonable(repl.plan_compaction(params.get("profile")))

    async def _model_set(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        await repl.set_model(params["model"], provider=params.get("provider"))
        return {"ok": True, "model": repl.current_model}

    async def _provider_set(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        await repl.set_provider(params["provider"])
        return {"ok": True, "provider": repl.config.provider}

    async def _models_list(self, params: dict[str, Any]) -> dict[str, Any]:
        """Lista viva de modelos del proveedor activo (I-113), con overrides.

        Reutiliza `list_available_models` del CLI: consulta al proveedor en
        directo y aplica los overrides de `~/.phoson/models.json`. Si la red
        falla, degrada al modelo actual (comportamiento del engine).
        """
        from phoson_cli.model_selector import list_available_models

        repl = self.sessions.get(params["sessionId"])
        current = {"model": repl.current_model, "provider": repl.config.provider}
        try:
            options = await list_available_models(repl.config)
        except Exception as exc:  # noqa: BLE001 — la UI nunca debe caerse
            log.warning("models.list falló: %s", exc)
            return {"current": current, "models": [], "error": str(exc)}
        return {"current": current, "models": [to_jsonable(o) for o in options]}

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
    )
    #: provider id -> campo del config que guarda su clave.
    _PROVIDER_KEY = {
        "openrouter": "openrouter_api_key",
        "openai": "openai_api_key",
        "anthropic": "anthropic_api_key",
        "nvidia": "nvidia_api_key",
        "xai": "xai_api_key",
        "groq": "groq_api_key",
        "deepseek": "deepseek_api_key",
        "together": "together_api_key",
        "perplexity": "perplexity_api_key",
        "gemini": "gemini_api_key",
        "mistral": "mistral_api_key",
        "fireworks": "fireworks_api_key",
        "cohere": "cohere_api_key",
        "azure": "azure_openai_api_key",
        "omniroute": "omniroute_api_key",
        "vllm": "vllm_api_key",
    }

    async def _config_get(self, params: dict[str, Any]) -> dict[str, Any]:
        """Config efectiva para el panel. Los secretos NUNCA se envían: solo
        su procedencia (`file`/`env`/`default`) y si están presentes."""
        from phoson_cli.config import (
            has_configured_provider,
            enabled_providers_from_config,
        )

        repl = self.sessions.get(params["sessionId"])
        cfg = repl.config
        sources = dict(getattr(cfg, "_secret_sources", {}) or {})
        providers = [
            {
                "id": pid,
                "hasKey": bool(getattr(cfg, field, None)),
                "source": sources.get(field, "default"),
            }
            for pid, field in self._PROVIDER_KEY.items()
        ]
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
            "providers": providers,
            "hasProvider": has_configured_provider(cfg),
        }

    async def _config_set(self, params: dict[str, Any]) -> dict[str, Any]:
        """Persiste un patch de campos seguros y, opcionalmente, claves de API
        (write-only: entran, nunca salen)."""
        from phoson_cli.config import save_config

        repl = self.sessions.get(params["sessionId"])
        cfg = repl.config
        patch = params.get("patch") or {}
        secrets = params.get("secrets") or {}

        touched: set[str] = set()
        for field in self._SAFE_FIELDS:
            if field in patch:
                setattr(cfg, field, patch[field])
                touched.add(field)
        for pid, value in secrets.items():
            field = self._PROVIDER_KEY.get(str(pid))
            if field and value:
                setattr(cfg, field, value)
                touched.add(field)

        only = set(self._SAFE_FIELDS) | touched | {"enabled_providers"}
        path = save_config(cfg, only_fields=only, explicit_secret_fields=touched)

        # Aplicar en vivo lo que el engine necesita (cliente/modelo).
        if "provider" in patch or touched & set(self._PROVIDER_KEY.values()):
            try:
                await repl.set_provider(cfg.provider)
            except Exception as exc:  # noqa: BLE001 — guardar no debe fallar por el rebuild
                log.warning("set_provider tras config.set falló: %s", exc)

        self._emit("session.metrics", self._metrics(params["sessionId"]))
        return {"ok": True, "path": str(path), "config": await self._config_get(params)}

    async def _attachment_add(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        repl._controller.attachments.attach(params["path"])
        return {"attachments": to_jsonable(repl._controller.attachments.list_pending())}

    async def _attachment_clear(self, params: dict[str, Any]) -> dict[str, Any]:
        repl = self.sessions.get(params["sessionId"])
        repl._controller.attachments.clear()
        return {"attachments": []}

    async def _confirm_respond(self, params: dict[str, Any]) -> dict[str, Any]:
        ok = self.sessions.resolve_confirm(params["requestId"], params)
        return {"ok": ok}

    async def _shutdown(self, _params: dict[str, Any]) -> dict[str, Any]:
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
