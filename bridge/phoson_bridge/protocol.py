"""Serialización de objetos del engine a JSON.

El engine usa dataclasses (``AgentEvent``, ``Message``, bloques de contenido,
``RunStep``…), enums, ``Path`` y ``datetime``. Este módulo los normaliza a tipos
JSON puros. Convención: todo dataclass lleva un campo ``type`` con el nombre de
su clase (p. ej. ``{"type": "AgentTokenEvent", ...}``), que el frontend usa para
discriminar.
"""

from __future__ import annotations

import enum
import json
import dataclasses
from datetime import date, datetime
from pathlib import Path
from typing import Any

__all__ = ["to_jsonable", "dump"]


def to_jsonable(obj: Any) -> Any:
    """Convierte recursivamente *obj* a algo serializable por json.dumps."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Path):
        return str(obj)
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        out: dict[str, Any] = {"type": type(obj).__name__}
        for field in dataclasses.fields(obj):
            out[field.name] = to_jsonable(getattr(obj, field.name, None))
        return out
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [to_jsonable(item) for item in obj]
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    # Objetos opacos (trackers, clientes): el frontend no debe depender de ellos.
    return {"type": type(obj).__name__, "repr": repr(obj)}


def dump(message: dict[str, Any]) -> str:
    """JSON compacto en una sola línea (framing NDJSON)."""
    return json.dumps(message, ensure_ascii=False, default=str, separators=(",", ":"))
