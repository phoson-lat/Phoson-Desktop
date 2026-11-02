"""Reglas de mcps.json: no perder tokens al editar y no mezclar transportes.

El sidecar nunca devuelve los valores de ``env``/``headers`` (son tokens), así
que la UI edita a ciegas: manda las claves con el valor vacío salvo las que el
usuario escribió. Estas pruebas fijan esa semántica —y la limpieza de la spec,
que evita dejar un `command` colgado en un servidor remoto.

No importa `server.py` a propósito: ese módulo necesita el engine instalado.

    python bridge/tests/test_mcp_config.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from phoson_bridge.mcp_config import clean_spec, merge_secret_map, sanitize_spec  # noqa: E402

failures: list[str] = []


def _check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


def _merge(spec: dict[str, Any], incoming: dict[str, Any], key: str = "env") -> dict[str, Any]:
    merge_secret_map(spec, incoming, key, f"{key}Remove")
    return spec


# 1) Un valor vacío conserva el secreto guardado; una clave nueva vacía no se guarda.
spec: dict[str, Any] = {"transport": "stdio", "env": {"TOKEN": "guardado"}}
_merge(spec, {"env": {"TOKEN": "", "NUEVA": ""}})
_check(
    "editar sin reescribir el token lo conserva",
    spec["env"] == {"TOKEN": "guardado"},
    str(spec["env"]),
)

# 2) Escribir un valor lo pisa.
_merge(spec, {"env": {"TOKEN": "nuevo"}})
_check("un valor escrito pisa al guardado", spec["env"]["TOKEN"] == "nuevo", str(spec["env"]))

# 3) `envRemove` borra lo que el usuario quitó del formulario.
_merge(spec, {"envRemove": ["TOKEN"]})
_check("borrar la clave quita el campo vacío", "env" not in spec, str(spec))

# 4) Las claves se recortan (una línea con espacios no crea un duplicado).
spec = {"transport": "stdio", "env": {"TOKEN": "guardado"}}
_merge(spec, {"env": {" TOKEN ": "nuevo"}})
_check("la clave se recorta antes de fusionar", spec["env"] == {"TOKEN": "nuevo"}, str(spec))

# 5) Cabeceras: misma semántica (Authorization no se puede mostrar).
spec = {"transport": "http", "url": "https://a/mcp", "headers": {"Authorization": "Bearer x"}}
merge_secret_map(spec, {"headers": {"Authorization": ""}, "headersRemove": []}, "headers", "headersRemove")
_check(
    "una cabecera sin valor conserva el Bearer guardado",
    spec["headers"] == {"Authorization": "Bearer x"},
    str(spec["headers"]),
)
merge_secret_map(spec, {"headersRemove": ["Authorization"]}, "headers", "headersRemove")
_check("quitar la cabecera la elimina", "headers" not in spec, str(spec))

# 6) Limpieza por transporte.
stdio: dict[str, Any] = {
    "transport": "stdio",
    "command": "npx",
    "url": "https://sobra/mcp",
    "headers": {"X": "1"},
}
sanitize_spec(stdio)
_check(
    "stdio se queda con el comando y pierde url/cabeceras",
    stdio == {"transport": "stdio", "command": "npx"},
    str(stdio),
)

remote: dict[str, Any] = {
    "transport": "http",
    "url": "https://a/mcp",
    "command": "npx",
    "args": ["-y", "x"],
    "headers": {"Authorization": "Bearer x"},
}
sanitize_spec(remote)
_check(
    "remoto se queda con url/cabeceras y pierde comando/args",
    remote
    == {"transport": "http", "url": "https://a/mcp", "headers": {"Authorization": "Bearer x"}},
    str(remote),
)

legacy: dict[str, Any] = {"url": "https://a/mcp", "headers": {"Authorization": "Bearer x"}}
sanitize_spec(legacy)
_check(
    "una spec antigua con url y sin transport cuenta como remota",
    legacy == {"url": "https://a/mcp", "headers": {"Authorization": "Bearer x"}},
    str(legacy),
)

# 7) `clean_spec` quita los campos vacíos antes de sanear y devuelve la spec.
spec = {"transport": "stdio", "command": "npx", "args": [], "url": "", "enabled": True}
cleaned = clean_spec(spec)
_check(
    "los campos vacíos no llegan a mcps.json",
    cleaned == {"transport": "stdio", "command": "npx", "enabled": True},
    str(cleaned),
)

# 8) Ida y vuelta del formulario de edición (lo que hace la UI al guardar).
saved: dict[str, Any] = {
    "transport": "http",
    "url": "https://a/mcp",
    "enabled": True,
    "headers": {"Authorization": "Bearer guardado", "X-Trace": "1"},
    "env": {"REGION": "eu"},
}
incoming = {
    "transport": "http",
    "url": "https://a/mcp",
    "enabled": True,
    "headers": {"Authorization": "", "X-Trace": "2"},  # solo se reescribe la traza
    "headersRemove": [],
    "env": {"REGION": ""},
    "envRemove": [],
}
merge_secret_map(saved, incoming, "env", "envRemove")
merge_secret_map(saved, incoming, "headers", "headersRemove")
clean_spec(saved)
_check(
    "guardar sin tocar un token lo conserva y actualiza el resto",
    saved["headers"] == {"Authorization": "Bearer guardado", "X-Trace": "2"}
    and saved["env"] == {"REGION": "eu"},
    str(saved),
)

print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)
