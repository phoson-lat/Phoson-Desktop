"""Catálogo de plugins del engine para la sección «Plugins» de Ajustes.

El engine resuelve los plugins por **dos vías que conviven**:

* ``[defaults].plugins`` — la lista de specs (``phoson-plugin-x``, tablas inline
  con ``config``, ``entrypoint:``/``path:``) que escriben el wizard de
  ``phoson-cli`` y :mod:`phoson_cli.plugin_manager`. El engine la carga primero.
* Los flags ``enable_*`` (``enable_mcp``, ``enable_monitors``, …): el builder
  correspondiente devuelve una instancia *pre-configurada* del plugin.

No son aditivas: con la misma spec en la lista **y** su flag activo el plugin se
carga dos veces (el engine no deduplica), así que este módulo nunca enciende las
dos a la vez. La lista es el mecanismo al **activar** un plugin que no tiene flag
persistible y el flag lo es para los seis que sí lo tienen (``enable_mcp``,
``enable_monitors``, ``enable_bgjobs``, ``enable_computeruse``, ``enable_swarm``,
``enable_questions``); desactivar limpia justo lo que activó.

Dos flags que el engine resuelve pero ``save_config`` **no** persiste
(``enable_ssh``/``enable_otel``: solo se leen del archivo y del entorno) se
tratan como estado externo: si están activos, el plugin ya lo está por una fuente
que la UI no puede escribir, así que el toggle queda bloqueado con el motivo en
vez de mentir (el catálogo lo reporta en ``lockReason``).

El dictado y los pares no se gobiernan aquí: ``phoson-plugin-stt`` tiene su
sección de Ajustes (y el bridge importa el plugin directamente, así que la lista
no decide si hay dictado) y ``phoson-plugin-peers`` se activa con ``peer_name``.

Nada de este módulo construye el engine: opera sobre la config viva de la sesión
(``SessionManager.config_for``) y persiste con ``save_config``, igual que
``config.set`` durante el onboarding.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tomllib
from pathlib import Path
from typing import Any

#: spec → ``(campo del config, variable de entorno, ¿save_config lo persiste?)``.
#: Los tres últimos flags solo se leen del archivo/entorno: el engine los resuelve
#: pero ``save_config`` no los escribe, así que su toggle no puede apagarlos.
_FLAGS: dict[str, tuple[str, str, bool]] = {
    "phoson-plugin-mcp": ("enable_mcp", "PHOSON_ENABLE_MCP", True),
    "phoson-plugin-monitor": ("enable_monitors", "PHOSON_ENABLE_MONITORS", True),
    "phoson-plugin-bgjobs": ("enable_bgjobs", "PHOSON_ENABLE_BGJOBS", True),
    "phoson-plugin-computeruse": (
        "enable_computeruse",
        "PHOSON_ENABLE_COMPUTERUSE",
        True,
    ),
    "phoson-plugin-swarm": ("enable_swarm", "PHOSON_ENABLE_SWARM", True),
    "phoson-plugin-questions": ("enable_questions", "PHOSON_ENABLE_QUESTIONS", True),
    "phoson-plugin-ssh": ("enable_ssh", "PHOSON_ENABLE_SSH", False),
    "phoson-plugin-otel": ("enable_otel", "PHOSON_ENABLE_OTEL", False),
}

#: Specs que la UI solo **muestra**: su estado lo decide otra cosa (código de
#: motivo, no frase — el frontend traduce).
_READ_ONLY: dict[str, str] = {
    "phoson-plugin-stt": "dictation",
    "phoson-plugin-peers": "peerName",
}


def config_path() -> Path:
    """Ruta del ``config.toml`` compartido con el CLI."""
    return Path("~/.phoson/config.toml").expanduser()


def _file_defaults() -> dict[str, Any]:
    """Sección ``[defaults]`` del ``config.toml`` (``{}`` si no hay o está roto)."""
    try:
        raw = tomllib.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}
    section = raw.get("defaults")
    return section if isinstance(section, dict) else {}


def _labels() -> tuple[dict[str, tuple[str, str]], dict[str, tuple[str, str]]]:
    """Nombre/descripción de cada plugin oficial, tal como los define el engine.

    El bridge no inventa el catálogo: reutiliza ``phoson_cli.labels`` (la misma
    fuente que el wizard). Sin engine importable el catálogo queda vacío y solo se
    listan las specs que ya estén en ``config.toml``.
    """
    try:
        from phoson_cli.labels import PLUGIN_LABELS, PLUGIN_REQUIRED_EXTRAS
    except Exception:  # noqa: BLE001 — catálogo opcional, nunca tumba Ajustes
        return {}, {}
    return dict(PLUGIN_LABELS), dict(PLUGIN_REQUIRED_EXTRAS)


def _spec_name(spec: Any) -> str:
    """Identificador de una spec tal como la escribe ``config.toml``."""
    if isinstance(spec, dict):
        return str(spec.get("name", ""))
    return str(spec or "")


def _matches(spec: Any, plugin_id: str) -> bool:
    """¿La spec corresponde a ``plugin_id``? (misma regla que ``plugin_manager``)."""
    name = _spec_name(spec)
    return name == plugin_id or name == f"entrypoint:{plugin_id}"


def _listed(cfg: Any, plugin_id: str) -> bool:
    """¿La spec está activa en ``[defaults].plugins``?"""
    return any(_matches(spec, plugin_id) for spec in (getattr(cfg, "plugins", None) or []))


def _flag_on(cfg: Any, field: str) -> bool:
    return bool(getattr(cfg, field, False)) if field else False


def _flag_origin(env_var: str, field: str, defaults: dict[str, Any]) -> str:
    """De dónde sale un flag activo: ``env:VAR``, ``file:campo`` o ``""``.

    Sirve para que el bloqueo del toggle nombre la fuente exacta que hay que
    editar a mano (el engine no guarda la procedencia de los booleanos).
    """
    if os.environ.get(env_var):
        return f"env:{env_var}"
    if field and field in defaults:
        return f"file:{field}"
    return f"file:{field}" if field else ""


def _missing_extra(spec: str, extras: dict[str, tuple[str, str]]) -> str:
    """``[extra]`` opcional que falta para que el plugin importe (``""`` si está).

    Usa ``importlib.util.find_spec`` como el wizard: el extra es lo que de verdad
    falta en el entorno (p. ej. ``asyncssh`` para ``[ssh]``).
    """
    requirement = extras.get(spec)
    if requirement is None:
        return ""
    module, extra = requirement
    try:
        found = importlib.util.find_spec(module)
    except (ImportError, ValueError):
        return extra
    return "" if found is not None else extra


def catalog(cfg: Any) -> list[dict[str, Any]]:
    """Catálogo para la UI: los plugins oficiales del engine y los añadidos.

    Cada entrada lleva el estado (**activo o no**), con qué mecanismo se gobierna,
    si su toggle está bloqueado y por qué, y el extra opcional que falta. Las
    specs que no son del catálogo oficial (comunidad, ``path:…``, tablas inline,
    ``entrypoint:…``) se listan también: si están en ``config.toml`` se pueden
    desactivar desde aquí.
    """
    labels, extras = _labels()
    defaults = _file_defaults()
    entries = [
        _entry(cfg, spec, name, description, extras, defaults, official=True)
        for spec, (name, description) in labels.items()
    ]

    known = set(labels)
    seen: set[str] = set()
    for spec in [*(getattr(cfg, "plugins", None) or []), *(getattr(cfg, "disabled_plugins", None) or [])]:
        plugin_id = _spec_name(spec)
        if not plugin_id or plugin_id in known or plugin_id in seen:
            continue
        seen.add(plugin_id)
        entries.append(
            _entry(cfg, plugin_id, plugin_id, "", extras, defaults, official=False)
        )
    return entries


def _entry(
    cfg: Any,
    plugin_id: str,
    name: str,
    description: str,
    extras: dict[str, tuple[str, str]],
    defaults: dict[str, Any],
    *,
    official: bool,
) -> dict[str, Any]:
    field, env_var, persistable = _FLAGS.get(plugin_id, ("", "", False))
    flag_on = _flag_on(cfg, field)
    listed = _listed(cfg, plugin_id)
    read_only = _READ_ONLY.get(plugin_id, "")

    lock_reason = read_only
    if not lock_reason and flag_on and not persistable:
        # Activo por una fuente que la UI no puede escribir (archivo o entorno):
        # su toggle no puede apagarlo, así que se bloquea y se nombra la fuente.
        lock_reason = _flag_origin(env_var, field, defaults)

    return {
        "id": plugin_id,
        "name": name,
        "description": description,
        "enabled": listed or flag_on,
        # Mecanismo con el que se activa: un flag del config o la lista de specs.
        "mechanism": "flag" if (field and persistable) else "list",
        "flag": field,
        "listed": listed,
        # `phoson_cli.labels` describe los plugins del propio engine; el resto de
        # specs salen de `plugins`/`disabled_plugins` (instaladas por el usuario).
        "official": official,
        "locked": bool(lock_reason),
        "lockReason": lock_reason,
        # Extra opcional que falta: la UI avisa cuando el plugin está activo.
        "missingExtra": _missing_extra(plugin_id, extras),
    }


def _unpark(cfg: Any, plugin_id: str) -> bool:
    """Saca la spec de ``disabled_plugins`` sin activarla. ``True`` si la quitó."""
    parked = getattr(cfg, "disabled_plugins", None) or []
    kept = [spec for spec in parked if not _matches(spec, plugin_id)]
    if len(kept) == len(parked):
        return False
    cfg.disabled_plugins = kept
    return True


def _enable_spec(cfg: Any, plugin_id: str) -> bool:
    """Activa una spec en ``plugins``: sale de ``disabled_plugins`` si estaba ahí.

    Restaurar la spec guardada (cadena, ``path:`` o tabla inline con su
    ``config``) preserva la configuración del plugin; si nunca estuvo, se añade
    la spec desnuda (que es lo que escribe el wizard). Devuelve ``True`` cuando
    además hubo que sacarla de ``disabled_plugins``.
    """
    parked = [
        spec
        for spec in (getattr(cfg, "disabled_plugins", None) or [])
        if _matches(spec, plugin_id)
    ]
    unparked = _unpark(cfg, plugin_id)
    specs = list(cfg.plugins or [])
    if not any(_matches(spec, plugin_id) for spec in specs):
        specs.extend(parked or [plugin_id])
    cfg.plugins = specs
    return unparked


def _park_spec(cfg: Any, plugin_id: str) -> None:
    """Desactiva una spec: la mueve a ``disabled_plugins`` (misma semántica que
    ``plugin_manager.disable_plugin``, para poder reactivarla tal cual)."""
    parked = [spec for spec in (cfg.plugins or []) if _matches(spec, plugin_id)]
    cfg.plugins = [spec for spec in (cfg.plugins or []) if not _matches(spec, plugin_id)]
    disabled = list(cfg.disabled_plugins or [])
    for spec in parked:
        if not any(_matches(existing, plugin_id) for existing in disabled):
            disabled.append(spec)
    cfg.disabled_plugins = disabled


def set_enabled(cfg: Any, plugin_id: str, enabled: bool) -> dict[str, Any]:
    """Activa o desactiva un plugin y persiste el cambio en ``config.toml``.

    Devuelve ``{"ok": True, "path":…, "fields":[…]}` con los campos tocados (el
    llamador los espeja en la config base y recarga el engine) o
    ``{"ok": False, "reason": "locked", "detail":…}`` cuando el estado lo fija
    otra fuente y el toggle no puede cambiarlo.
    """
    from phoson_cli.config import save_config

    plugin_id = str(plugin_id or "").strip()
    if not plugin_id:
        raise ValueError("la spec del plugin no puede estar vacía")

    read_only = _READ_ONLY.get(plugin_id)
    if read_only:
        return {"ok": False, "reason": "locked", "detail": read_only}

    field, env_var, persistable = _FLAGS.get(plugin_id, ("", "", False))
    flag_on = _flag_on(cfg, field)
    listed = _listed(cfg, plugin_id)
    fields: set[str] = set()

    if enabled:
        if listed or flag_on:
            return {"ok": True, "fields": []}  # ya activo: idempotente
        if field and persistable:
            # El flag basta (y encenderlo con la spec en la lista la cargaría dos
            # veces, así que se excluyen mutuamente por construcción).
            setattr(cfg, field, True)
            fields.add(field)
            # Una spec aparcada de antes mentiría en `plugin list` (diría
            # «desactivado» con el plugin cargado), así que se descarta.
            if _unpark(cfg, plugin_id):
                fields.add("disabled_plugins")
        else:
            # La lista de specs es el mecanismo cuando el plugin no tiene flag
            # (memory, checkpoint, mcp de terceros, path:…). `disabled_plugins`
            # solo se escribe si de verdad había una spec aparcada que sacar.
            if _enable_spec(cfg, plugin_id):
                fields.add("disabled_plugins")
            fields.add("plugins")
    else:
        if not listed and not flag_on:
            return {"ok": True, "fields": []}  # ya desactivado: idempotente
        if flag_on and not persistable:
            return {
                "ok": False,
                "reason": "locked",
                "detail": _flag_origin(env_var, field, _file_defaults()),
            }
        if flag_on:
            setattr(cfg, field, False)
            fields.add(field)
        if listed:
            _park_spec(cfg, plugin_id)
            fields |= {"plugins", "disabled_plugins"}

    path = save_config(cfg, only_fields=fields)
    return {"ok": True, "path": str(path), "fields": sorted(fields)}


def installable() -> tuple[bool, str]:
    """¿Este sidecar puede instalar plugins? ``(sí, motivo)``.

    ``install_plugin`` del engine ejecuta ``uv pip install --python
    sys.executable`` y luego reconsulta los entry points en un **intérprete
    nuevo**: en el sidecar congelado (PyInstaller) no hay ``uv`` ni un
    ``sys.executable`` re-ejecutable, así que ahí la instalación desde la UI no
    es posible y se dice en vez de intentarlo y fallar a medias.
    """
    if getattr(sys, "frozen", False):
        return False, "frozen"
    if shutil.which("uv") is None:
        return False, "noUv"
    return True, ""


def install(cfg: Any, source: str) -> str:
    """Instala un plugin desde ``source`` y lo activa (``install_plugin``).

    Un plugin es código Python que corre con los permisos del usuario: el
    llamador **debe** confirmar antes (el handler exige ``confirmed``).
    """
    from phoson_cli.plugin_manager import install_plugin

    return install_plugin(str(source).strip(), cfg)