"""Reglas de `~/.phoson/mcps.json`: fusionar secretos y limpiar la spec.

Vive aparte de `server.py` por dos razones: el sidecar importa `phoson_cli` (que
no está en todos los entornos de CI) y estas son justo las operaciones que
pueden romper una configuración existente — perder un token guardado o dejar un
servidor con campos de otro transporte.
"""

from __future__ import annotations

from typing import Any


def merge_secret_map(
    spec: dict[str, Any], incoming: dict[str, Any], key: str, remove_key: str
) -> None:
    """Fusiona ``env``/``headers`` de ``incoming`` en ``spec``.

    La UI nunca recibe los valores (son tokens), así que al editar llega un
    diccionario con las claves y el valor vacío salvo en las que el usuario
    escribió algo:

    - valor no vacío → se guarda (crea o pisa);
    - clave con valor vacío → **conserva** el valor guardado (clave nueva: se
      ignora, no tiene sentido guardar ``TOKEN=""``);
    - ``remove_key`` (``envRemove`` / ``headersRemove``) → borra esas claves,
      que es como se quita un secreto sin verlo.

    Si no queda ninguna clave, el campo desaparece de la spec (mcps.json limpio).
    """
    current = spec.get(key)
    merged = dict(current) if isinstance(current, dict) else {}
    for raw_key, value in (incoming.get(key) or {}).items():
        name = str(raw_key).strip()
        if not name:
            continue
        text = "" if value is None else str(value).strip()
        if text:
            merged[name] = text
    for raw_key in incoming.get(remove_key) or []:
        merged.pop(str(raw_key).strip(), None)
    if merged:
        spec[key] = merged
    else:
        spec.pop(key, None)


def sanitize_spec(spec: dict[str, Any]) -> None:
    """Deja en la spec solo los campos de su transporte.

    ``transport`` manda; si falta (specs antiguas) se deduce de ``url``, igual
    que hace `_mcp_summary`. Un servidor stdio no usa ``url`` ni ``headers`` y
    uno remoto no usa ``command`` ni ``args``.
    """
    transport = str(spec.get("transport") or ("sse" if spec.get("url") else "stdio"))
    if transport != "stdio":
        spec.pop("command", None)
        spec.pop("args", None)
    else:
        spec.pop("url", None)
        spec.pop("headers", None)


def clean_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Quita los campos vacíos y sanea el transporte (antes de guardar)."""
    for key in ("command", "url", "args"):
        if not spec.get(key):
            spec.pop(key, None)
    sanitize_spec(spec)
    return spec
