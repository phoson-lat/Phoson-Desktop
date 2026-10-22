"""Extras opcionales del engine: resolverlos, instalarlos y habilitarlos.

Un plugin del engine puede depender de un **extra** del paquete
``phoson-engine-minimal`` (``[stt]``, ``[computeruse]``…). Los extras son
dependencias opcionales que no vienen por defecto: si faltan, el motor carga el
plugin pero lo **salta** (sin ``moonshine_voice`` el dictado no dicta nada).

Este módulo permite arreglarlos **desde la app**:

1. **Resuelve** los requisitos del extra leyendo los metadatos del engine ya
   instalado (``importlib.metadata``): aquí no hay una lista de pines duplicada
   que se pueda quedar vieja; los pines son los del propio engine.
2. **Instala** esos requisitos en ``~/.phoson/extras/<extra>`` — no toca el
   entorno del engine: el sidecar congelado no tiene ``pip`` y el venv puede
   estar compartido con otras apps.
3. **Habilita** el directorio en el ``sys.path`` del sidecar, de modo que el
   plugin encuentra el módulo sin reiniciar la app (y al volver a arrancar, el
   bootstrap de ``server`` los añade otra vez).

El motor de instalación es ``pip`` (``python -m pip install --target``) o ``uv``
(``uv pip install --target``), el primero que se encuentre con un intérprete
real: el sidecar congelado no puede ejecutar su propio ``sys.executable``.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

#: Distribución del engine: es la que declara los extras en sus metadatos.
ENGINE_DIST = "phoson-engine-minimal"

#: Extras "hermanos" por plataforma: ``[computeruse]`` arrastra el backend del
#: sistema (Quartz en macOS, GDI en Windows, Wayland en Linux).
_PLATFORM_SIBLINGS: dict[str, dict[str, str]] = {
    "computeruse": {"darwin": "computeruse-macos", "win32": "computeruse-windows"},
}

#: Tope de la instalación (una descarga de `onnxruntime` puede tardar minutos).
_INSTALL_TIMEOUT = 900.0

#: `extra == 'x'` dentro de un marker de `Requires-Dist`.
_EXTRA_RE = re.compile(r"extra\s*==\s*['\"]([^'\"]+)['\"]")

#: Comparación simple de marker: `var == 'valor'` / `var != 'valor'`.
_CMP_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*['\"]([^'\"]*)['\"]\s*$")


def extras_root() -> Path:
    """Raíz donde viven los extras instalados (``~/.phoson/extras``)."""
    return Path("~/.phoson/extras").expanduser()


def bootstrap_paths() -> list[str]:
    """Añade los extras instalados al ``sys.path`` del sidecar (idempotente).

    Se llama al arrancar el sidecar (para que un extra instalado ayer esté
    disponible hoy) y tras cada instalación (para que esté disponible ya).
    """
    root = extras_root()
    added: list[str] = []
    if not root.is_dir():
        return added
    for path in sorted(root.iterdir()):
        if not path.is_dir():
            continue
        text = str(path)
        if text not in sys.path:
            sys.path.append(text)
            added.append(text)
    if added:
        importlib.invalidate_caches()
    return added


# ── Requisitos del extra ────────────────────────────────────────────────────


def _extra_family(extra: str) -> list[str]:
    """El extra pedido y su hermano de plataforma, si toca."""
    family = [extra]
    sibling = _PLATFORM_SIBLINGS.get(extra, {}).get(sys.platform)
    if sibling:
        family.append(sibling)
    elif extra == "computeruse" and sys.platform.startswith("linux"):
        # Wayland necesita su extra; en X11 no (el backend usa Xlib, que ya viene).
        if os.environ.get("WAYLAND_DISPLAY"):
            family.append("computeruse-wayland")
    return family


def _local_env(extra: str) -> dict[str, str]:
    """Variables para evaluar markers a mano (sin `packaging`)."""
    return {
        "extra": extra,
        "os_name": os.name,
        "sys_platform": sys.platform,
        "platform_system": platform.system(),
        "platform_machine": platform.machine(),
        "platform_release": platform.release(),
        "platform_version": platform.version(),
        "python_version": "%d.%d.%d" % sys.version_info[:3],
        "python_full_version": platform.python_version(),
        "implementation_name": sys.implementation.name,
        "implementation_version": platform.python_version(),
        "platform_python_implementation": platform.python_implementation(),
    }


def _split_top(expr: str, keyword: str) -> list[str]:
    """Parte ``expr`` por ``keyword`` (``and``/``or``) fuera de paréntesis."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    index = 0
    length = len(expr)
    while index < length:
        char = expr[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if depth == 0 and expr.startswith(keyword, index):
            before = current[-1] if current else " "
            after = expr[index + len(keyword) : index + len(keyword) + 1]
            if not before.isalnum() and not after.isalnum():
                parts.append("".join(current))
                current = []
                index += len(keyword)
                continue
        current.append(char)
        index += 1
    parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def _strip_outer_parens(expr: str) -> str:
    """Quita los paréntesis que envuelven toda la expresión."""
    expr = expr.strip()
    while expr.startswith("(") and expr.endswith(")"):
        depth = 0
        wraps_all = True
        for index, char in enumerate(expr):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(expr) - 1:
                    wraps_all = False
                    break
        if not wraps_all:
            break
        expr = expr[1:-1].strip()
    return expr


def _eval_marker(expr: str, env: dict[str, str]) -> bool:
    """Evalúa un marker (``and``/``or``/comparaciones) sin `packaging`.

    Es el plan B: `packaging` está en el venv del engine, pero no viaja en el
    sidecar congelado, así que los markers se evalúan aquí a mano.
    """
    expr = _strip_outer_parens(expr)
    if not expr:
        return True
    if _CMP_RE.match(expr):
        name, operator, expected = _CMP_RE.match(expr).groups()  # type: ignore[union-attr]
        actual = env.get(name, "")
        return actual == expected if operator == "==" else actual != expected
    # `or` tiene menos precedencia que `and`.
    for part in _split_top(expr, "or"):
        if all(_eval_marker(piece, env) for piece in _split_top(part, "and")):
            return True
    return False


def _strip_extra_clause(marker: str) -> str:
    """Quita la cláusula `extra == 'x'` (con su conector) del marker."""
    parts = _split_top(marker, "and")
    kept = [part for part in parts if not _EXTRA_RE.fullmatch(part.strip())]
    return " and ".join(kept)


def _requirements_with_packaging(extra: str) -> list[str]:
    """Requisitos del extra usando `packaging` (cuando está disponible)."""
    from importlib.metadata import distribution

    from packaging.requirements import Requirement

    dist = distribution(ENGINE_DIST)
    found: list[str] = []
    for raw in dist.requires or []:
        requirement = Requirement(raw)
        if requirement.marker is None:
            continue  # dependencia base: no es nuestra
        # `packaging` rellena el resto del entorno (sys_platform…); aquí solo
        # se le dice qué extra se está mirando.
        if requirement.marker.evaluate({"extra": extra}):
            # El marker se va: `pip` evalúa los markers con `extra=""` y se
            # saltaría el requisito entero.
            found.append(requirement.name + str(requirement.specifier))
    return found


def _requirements_without_packaging(extra: str) -> list[str]:
    """Requisitos del extra a mano (sin `packaging`)."""
    from importlib.metadata import distribution

    dist = distribution(ENGINE_DIST)
    found: list[str] = []
    for raw in dist.requires or []:
        requirement, _, marker = raw.partition(";")
        requirement = requirement.strip()
        marker = marker.strip()
        if not requirement or not marker:
            continue
        if extra not in set(_EXTRA_RE.findall(marker)):
            continue  # es el extra de otro plugin
        if not _eval_marker(_strip_extra_clause(marker), _local_env(extra)):
            continue
        found.append(requirement)
    return found


def requirements_for(extra: str) -> list[str]:
    """Requisitos (pins) del extra pedido, con sus hermanos de plataforma."""
    family = _extra_family(extra)
    found: list[str] = []
    for name in family:
        try:
            requirements = _requirements_with_packaging(name)
        except Exception:  # noqa: BLE001 — sin `packaging` se evalúa a mano
            requirements = _requirements_without_packaging(name)
        for requirement in requirements:
            if requirement not in found:
                found.append(requirement)
    return found


def module_for(extra: str) -> str:
    """Módulo que el extra aporta (para comprobar que la instalación sirvió)."""
    try:
        from phoson_cli.labels import PLUGIN_REQUIRED_EXTRAS
    except Exception:  # noqa: BLE001 — sin engine, no hay mapa
        return ""
    for module, name in PLUGIN_REQUIRED_EXTRAS.values():
        if name == extra:
            return module
    return ""


# ── Instalación ─────────────────────────────────────────────────────────────


def _has_pip(interpreter: str) -> bool:
    """¿Este intérprete tiene un `pip` usable?

    Hace falta `pip` ≥ 22: los wheels modernos (y las tags `cp312`) no los
    entiende un pip de 2021, y la instalación fallaría al compilar desde el
    código fuente.
    """
    try:
        probe = subprocess.run(
            [interpreter, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if probe.returncode != 0:
        return False
    match = re.search(r"pip\s+(\d+)\.(\d+)", probe.stdout or "")
    if not match:
        return False
    return (int(match.group(1)), int(match.group(2))) >= (22, 0)


def _python_version(interpreter: str) -> tuple[int, int] | None:
    """Versión (mayor, menor) del intérprete, o `None` si no se puede leer."""
    try:
        probe = subprocess.run(
            [interpreter, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if probe.returncode != 0:
        return None
    parts = (probe.stdout or "").strip().split(".")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    return int(parts[0]), int(parts[1])


def _interpreter_candidates() -> list[str]:
    """Intérpretes que podrían instalar (el del sidecar solo si no está congelado).

    Solo valen los de la **misma versión de Python** que el sidecar: los wheels
    que se instalan (``cp312``, …) tienen que ser los que el engine pueda
    importar.
    """
    wanted = sys.version_info[:2]
    candidates: list[str] = []
    if not getattr(sys, "frozen", False):
        candidates.append(sys.executable)
    for name in (
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ):
        found = shutil.which(name)
        if found and found not in candidates:
            candidates.append(found)
    matching = [c for c in candidates if _python_version(c) == wanted]
    # El propio intérprete del sidecar va siempre primero: si su versión
    # coincidiera, es el mejor candidato (es el que ejecuta el engine).
    if not getattr(sys, "frozen", False) and sys.executable in matching:
        matching.remove(sys.executable)
        matching.insert(0, sys.executable)
    return matching


def installer() -> tuple[str, list[str], str]:
    """El instalador disponible: ``(tipo, comando, motivo)``.

    Tipo: ``"pip"`` o ``"uv"``; el comando es el prefijo del comando a ejecutar.
    El motivo es ``""`` cuando hay instalador o ``"noPip"`` cuando no.

    El sidecar congelado no cuenta como intérprete: su ``sys.executable`` es el
    binario de la app, que no puede ejecutar ``-m pip``.
    """
    for candidate in _interpreter_candidates():
        if _has_pip(candidate):
            return "pip", [candidate, "-m", "pip", "install"], ""
    uv = shutil.which("uv")
    if uv:
        return "uv", [uv, "pip", "install"], ""
    return "", [], "noPip"


def installable() -> tuple[bool, str]:
    """¿Este sidecar puede instalar extras? ``(sí, motivo)``."""
    kind, _, blocked = installer()
    return (bool(kind), blocked)


def install_extra(extra: str) -> dict[str, Any]:
    """Instala el extra en ``~/.phoson/extras/<extra>`` y lo habilita.

    Devuelve ``{"ok": True, …}`` o ``{"ok": False, "reason": …}`` con el
    motivo (``noPip``, ``unknownExtra``, ``installFailed``…) y la salida del
    instalador.
    """
    extra = str(extra or "").strip()
    requirements = requirements_for(extra)
    if not requirements:
        return {"ok": False, "reason": "unknownExtra", "extra": extra}

    kind, prefix, blocked = installer()
    if not kind:
        return {"ok": False, "reason": blocked, "extra": extra}

    target = extras_root() / extra
    target.mkdir(parents=True, exist_ok=True)
    if kind == "pip":
        # `--ignore-installed` fuerza que las dependencias ALSO se instalen en
        # el destino: si ya estuvieran en el intérprete del sistema, el sidecar
        # congelado no las encontraría.
        args = [*prefix, "--target", str(target), "--upgrade", "--ignore-installed", *requirements]
    else:
        args = [*prefix, "--target", str(target), "--reinstall", *requirements]

    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=_INSTALL_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "timeout", "extra": extra}
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "reason": "spawnFailed", "extra": extra, "error": str(exc)}

    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if proc.returncode != 0:
        return {
            "ok": False,
            "reason": "installFailed",
            "extra": extra,
            "error": output[-2000:],
        }

    # El directorio nuevo entra en el `sys.path` de este proceso: el plugin lo
    # encuentra sin reiniciar la app.
    bootstrap_paths()
    module = module_for(extra)
    if module:
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            return {
                "ok": False,
                "reason": "notImportable",
                "extra": extra,
                "error": output[-2000:],
            }

    return {
        "ok": True,
        "extra": extra,
        "dir": str(target),
        "installed": requirements,
        "output": output[-2000:],
    }
