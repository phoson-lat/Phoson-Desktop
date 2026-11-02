"""Catálogo de servidores MCP: búsqueda en el **registro oficial**.

`allmcpservers.com` no publica API propia: agrega el *Official MCP Registry*
(``registry.modelcontextprotocol.io``) y el directorio de conectores de Claude.
Aquí se consulta el primero —público, sin clave y con CORS abierto— para que la
app ofrezca un catálogo siempre al día en vez de una lista de plantillas
congelada en el binario.

El registro devuelve **una entrada por versión**: `normalize` deduplica por
nombre (se queda con la última), elige cómo se ejecuta el servidor (primer
paquete stdio, o su remoto) y traduce el manifiesto al comando que arrancaría el
engine. La UI solo pinta lo que sale de aquí: este módulo **no instala ni
guarda nada**, y nunca devuelve valores de tokens —solo los nombres de las
variables y cabeceras que el usuario debe rellenar.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger("phoson_bridge")

#: Endpoint de búsqueda del registro oficial (v0, estable desde 2025).
REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers"

#: TTL de la caché en memoria: el registro cambia a diario, no por minuto.
_CACHE_TTL = 600.0

#: Consultas cacheadas como máximo (cada una son ~30 entradas ya normalizadas).
_CACHE_MAX = 32

#: Tope de la petición HTTP: la UI espera con un spinner, no una eternidad.
DEFAULT_TIMEOUT = 15.0

#: Entradas por consulta (el catálogo pagina en cliente).
MAX_RESULTS = 60

#: Partes de un nombre invertido que no aportan nada al nombre sugerido.
_GENERIC_LABELS = {
    "com",
    "io",
    "org",
    "net",
    "dev",
    "ai",
    "app",
    "sh",
    "ac",
    "github",
    "gitlab",
    "mcp",
    "server",
}

#: Colas de nombre que tampoco sirven como identificador del servidor.
_GENERIC_TAILS = {"", "mcp", "server", "mcp-server", "sse", "http"}

#: Transportes remotos del registro → los que entiende el engine.
_REMOTE_TRANSPORT = {"streamable-http": "http", "http": "http", "sse": "sse"}

#: Caché ``clave → (monotonic, entradas)``. Vive lo que vive el sidecar.
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def search(query: str, limit: int = 30, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Busca ``query`` en el registro y devuelve las entradas ya normalizadas.

    El resultado siempre tiene la misma forma (``ok``/``entries``/``reason``)
    para que la UI no tenga que distinguir entre «sin red» y «sin resultados»:
    ``ok=False`` con un ``reason`` corto y traducible.
    """
    q = (query or "").strip()
    if len(q) < 2:
        return {"ok": True, "entries": [], "query": q, "reason": None, "cached": False}
    limit = max(1, min(int(limit or 30), MAX_RESULTS))

    key = f"{q.lower()}|{limit}"
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < _CACHE_TTL:
        return {"ok": True, "entries": hit[1], "query": q, "reason": None, "cached": True}

    try:
        # El registro devuelve una entrada por VERSIÓN: se piden de más para que
        # tras deduplicar queden `limit` servidores distintos.
        raw = _fetch(q, min(limit * 3, MAX_RESULTS), timeout)
    except urllib.error.HTTPError as exc:
        log.warning("registro MCP respondió %s", exc.code)
        return _failed(q, "http", f"HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        log.warning("registro MCP inalcanzable: %s", exc)
        return _failed(q, "network", str(exc))
    except ValueError as exc:  # incluye JSONDecodeError
        log.warning("respuesta ilegible del registro MCP: %s", exc)
        return _failed(q, "badResponse", str(exc))

    entries = normalize(raw)[:limit]
    _remember(key, entries)
    return {"ok": True, "entries": entries, "query": q, "reason": None, "cached": False}


def _failed(query: str, reason: str, detail: str) -> dict[str, Any]:
    return {
        "ok": False,
        "entries": [],
        "query": query,
        "reason": reason,
        "error": detail,
        "cached": False,
    }


def _fetch(query: str, limit: int, timeout: float) -> list[dict[str, Any]]:
    """GET al registro. En su propio hilo (`asyncio.to_thread`), nunca en el loop."""
    params = urllib.parse.urlencode({"search": query, "limit": limit})
    request = urllib.request.Request(  # noqa: S310 — URL fija (https) + query citada
        f"{REGISTRY_URL}?{params}",
        headers={
            "Accept": "application/json",
            "User-Agent": "Phoson-Desktop (MCP catalog)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        payload = json.loads(response.read().decode("utf-8"))
    servers = payload.get("servers") if isinstance(payload, dict) else None
    return servers if isinstance(servers, list) else []


def _remember(key: str, entries: list[dict[str, Any]]) -> None:
    _cache[key] = (time.monotonic(), entries)
    while len(_cache) > _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)


def clear_cache() -> None:
    """Vacía la caché (pruebas y «Reintentar» desde la UI)."""
    _cache.clear()


# ── Normalización ─────────────────────────────────────────────────────────────


def _official_meta(entry: dict[str, Any]) -> dict[str, Any]:
    meta = entry.get("_meta")
    if not isinstance(meta, dict):
        return {}
    official = meta.get("io.modelcontextprotocol.registry/official")
    return official if isinstance(official, dict) else {}


def _version_key(version: Any) -> tuple[int, ...]:
    """Compara versiones sin empaquetar: ``1.2.10`` > ``1.2.9``."""
    parts = re.split(r"[.+-]", str(version or ""))
    return tuple(int(p) if p.isdigit() else 0 for p in parts)


def _pick_latest(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplica por nombre de servidor quedándose con su versión más reciente."""
    picked: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        server = entry.get("server")
        if not isinstance(server, dict):
            continue
        name = str(server.get("name") or "").strip()
        if not name:
            continue
        if _official_meta(entry).get("status") not in (None, "active"):
            continue
        current = picked.get(name)
        if current is None:
            picked[name] = entry
            continue
        latest = bool(_official_meta(entry).get("isLatest"))
        was_latest = bool(_official_meta(current).get("isLatest"))
        if latest != was_latest:
            if latest:
                picked[name] = entry
            continue
        if _version_key(server.get("version")) > _version_key(
            (current.get("server") or {}).get("version")
        ):
            picked[name] = entry
    return list(picked.values())


def _stdio_package(server: dict[str, Any]) -> dict[str, Any] | None:
    """Primer paquete que se pueda lanzar por stdio (npm > pypi > docker)."""
    best: tuple[int, dict[str, Any]] | None = None
    for package in server.get("packages") or []:
        if not isinstance(package, dict):
            continue
        transport = package.get("transport")
        kind = str(transport.get("type") or "stdio") if isinstance(transport, dict) else "stdio"
        if kind != "stdio":
            continue
        # `npx`/`uvx`/`docker` ya vienen de `runtimeHint`; el orden solo desempata.
        rank = {"npm": 0, "pypi": 1, "oci": 2}.get(str(package.get("registryType") or ""), 9)
        if best is None or rank < best[0]:
            best = (rank, package)
    return best[1] if best else None


def _remote(server: dict[str, Any]) -> dict[str, Any] | None:
    """Primer remoto soportado (streamable-http antes que sse, como el registry)."""
    remotes = [r for r in (server.get("remotes") or []) if isinstance(r, dict)]
    for wanted in ("streamable-http", "sse"):
        for remote in remotes:
            kind = str(remote.get("type") or "")
            mapped = _REMOTE_TRANSPORT.get(kind)
            if not mapped:
                continue
            if kind == wanted or (wanted == "streamable-http" and mapped == "http"):
                return remote
    return None


def _arg_list(values: Any) -> list[str]:
    """``[{"type":"positional","value":"-y"}]`` → ``["-y"]`` (y los nombrados)."""
    out: list[str] = []
    for arg in values or []:
        if not isinstance(arg, dict) or arg.get("value") is None:
            continue
        value = str(arg.get("value"))
        if arg.get("type") == "named" and arg.get("name"):
            out.extend([f"--{arg['name']}", value])
        else:
            out.append(value)
    return out


def _stdio_command(package: dict[str, Any]) -> tuple[str, list[str]]:
    """Traduce el manifiesto del paquete al comando que arrancaría el engine."""
    kind = str(package.get("registryType") or "")
    identifier = str(package.get("identifier") or "")
    version = str(package.get("version") or "")
    pinned = f"{identifier}@{version}" if kind == "npm" and version else identifier
    runtime = str(package.get("runtimeHint") or "")
    runtime_args = _arg_list(package.get("runtimeArguments"))
    package_args = _arg_list(package.get("packageArguments"))

    if kind == "oci":
        return runtime or "docker", ["run", "-i", "--rm", *runtime_args, pinned, *package_args]
    command = runtime or ("uvx" if kind == "pypi" else "npx")
    if command == "npx" and "-y" not in runtime_args:
        # `npx` sin `-y` se queda esperando confirmación en un proceso sin TTY.
        runtime_args = ["-y", *runtime_args]
    return command, [*runtime_args, pinned, *package_args]


def _suggest_name(registry_name: str) -> str:
    """``com.pulsemcp/remote-filesystem`` → ``remote-filesystem``.

    El nombre es la clave en ``mcps.json``: se queda con la cola del nombre
    invertido y, si esa cola es genérica (``/mcp``), con la parte identificativa
    del dominio (``ac.inference.sh/mcp`` → ``inference``).
    """
    head, _, tail = registry_name.partition("/")
    candidate = tail.strip()
    if candidate.lower() in _GENERIC_TAILS:
        labels = [b for b in re.split(r"[.\-/]", head) if b.lower() not in _GENERIC_LABELS]
        candidate = labels[-1] if labels else (tail or head)
    slug = re.sub(r"[^a-z0-9._-]+", "-", candidate.lower()).strip("-._")
    return slug or "mcp"


def _title(server: dict[str, Any]) -> str:
    title = str(server.get("title") or "").strip()
    if title:
        return title
    name = str(server.get("name") or "")
    tail = name.rpartition("/")[2] or name
    return tail.replace("-", " ").replace("_", " ").strip() or name


def normalize(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convierte las entradas del registro en lo que consume la UI.

    Cada salida es ``{id,name,title,description,transport,command,args,url,
    envKeys,headerKeys,required,source,repository,version}``. Se omiten los
    servidores sin paquete stdio ni remoto utilizable.
    """
    out: list[dict[str, Any]] = []
    for entry in _pick_latest(entries):
        server = entry.get("server") or {}
        package = _stdio_package(server)
        remote = _remote(server)
        if package is None and remote is None:
            continue

        env_vars = [
            v
            for v in (package or {}).get("environmentVariables") or []
            if isinstance(v, dict) and str(v.get("name") or "").strip()
        ]
        headers = [
            h
            for h in (remote or {}).get("headers") or []
            if isinstance(h, dict) and str(h.get("name") or "").strip()
        ]

        if package is not None:
            command, args = _stdio_command(package)
            transport, url = "stdio", ""
            source = str(package.get("registryType") or "")
        else:
            command, args = "", []
            transport = _REMOTE_TRANSPORT.get(str((remote or {}).get("type") or ""), "http")
            url = str((remote or {}).get("url") or "")
            # URLs con plantilla (`https://{tenant}.mcp.foo`) no se pueden usar
            # tal cual: se omiten en vez de ofrecer un servidor roto.
            if "{" in url:
                continue
            source = "remote"

        repository = server.get("repository")
        out.append(
            {
                "id": str(server.get("name") or ""),
                "name": _suggest_name(str(server.get("name") or "")),
                "title": _title(server),
                "description": str(server.get("description") or "").strip(),
                "transport": transport,
                "command": command,
                "args": args,
                "url": url,
                "envKeys": [str(v["name"]).strip() for v in env_vars],
                "headerKeys": [str(h["name"]).strip() for h in headers],
                # Solo las obligatorias: la tarjeta avisa de lo que falta rellenar.
                "required": [
                    str(v["name"]).strip() for v in env_vars if v.get("isRequired")
                ]
                + [str(h["name"]).strip() for h in headers if h.get("isRequired")],
                "source": source,
                "repository": str(repository.get("url") or "")
                if isinstance(repository, dict)
                else "",
                "version": str(server.get("version") or ""),
            }
        )
    return out
