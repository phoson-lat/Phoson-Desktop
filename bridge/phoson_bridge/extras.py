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

Si el equipo no tiene ninguno, se descarga el binario oficial de ``uv`` (versión
fija, verificado contra su sha256) a ``~/.phoson/tools/``: ``uv`` trae su propio
Python de la versión del sidecar si hace falta, así que la instalación funciona
en un equipo sin Python. La app abierta desde Finder hereda el ``PATH`` mínimo
de launchd (``/usr/bin:/bin:…``), así que antes se buscan también las rutas
habituales (Homebrew, ``~/.local/bin``…).
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

#: Distribución del engine: es la que declara los extras en sus metadatos.
ENGINE_DIST = "phoson-engine-minimal"

#: Extras "hermanos" por plataforma: ``[computeruse]`` arrastra el backend del
#: sistema (Quartz en macOS, GDI en Windows, Wayland en Linux).
_PLATFORM_SIBLINGS: dict[str, dict[str, str]] = {
    "computeruse": {"darwin": "computeruse-macos", "win32": "computeruse-windows"},
}

#: Tope de la instalación (una descarga de `onnxruntime` puede tardar minutos).
_INSTALL_TIMEOUT = 900.0

#: Versión de `uv` que se descarga cuando el equipo no tiene instalador.
UV_VERSION = "0.13.0"

#: Asset oficial de `uv` por plataforma → sha256 (publicado junto al release).
#: Fijado aquí, no leído de la red: un asset alterado no pasa la verificación.
_UV_ASSETS: dict[tuple[str, str], tuple[str, str]] = {
    ("darwin", "arm64"): (
        "uv-aarch64-apple-darwin.tar.gz",
        "a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6",
    ),
    ("darwin", "x86_64"): (
        "uv-x86_64-apple-darwin.tar.gz",
        "5f44dcbde809b632f47c36fadb241cb4d6f9af71d0c8f172b5d2026d3dde742c",
    ),
    ("linux", "x86_64"): (
        "uv-x86_64-unknown-linux-gnu.tar.gz",
        "1468ebd5a5541121837c5a2817b9972ba6090fa6caa3d142620850a47fb75154",
    ),
    ("linux", "aarch64"): (
        "uv-aarch64-unknown-linux-gnu.tar.gz",
        "3ccfb6af6e242433eb552f7d9676abd5412c6595c497e990d9c8cb7b5bd4d2c3",
    ),
    ("win32", "amd64"): (
        "uv-x86_64-pc-windows-msvc.zip",
        "088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c",
    ),
    ("win32", "arm64"): (
        "uv-aarch64-pc-windows-msvc.zip",
        "cb54028b59aa87f11cf6dec293ce000420043a49a8aea522e822a671321f8932",
    ),
}

#: Tope de la descarga de `uv` (~20 MB).
_UV_DOWNLOAD_TIMEOUT = 120.0

#: Fases que reporta `install_extra` (la UI las traduce).
Progress = Callable[[str], None]

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


def tools_root() -> Path:
    """Donde vive el `uv` descargado por la app (``~/.phoson/tools``)."""
    return Path("~/.phoson/tools").expanduser()


def _search_path() -> str:
    """El ``PATH`` del sidecar más las rutas donde suelen vivir Python y uv.

    La app abierta desde Finder/el dock hereda el ``PATH`` de launchd
    (``/usr/bin:/bin:/usr/sbin:/sbin``): ni Homebrew ni ``~/.local/bin`` (donde
    el instalador oficial deja ``uv``) aparecen, y el sidecar concluía que no
    había instalador aunque el usuario lo tuviera.
    """
    home = Path.home()
    extra = [
        home / ".local" / "bin",
        home / ".cargo" / "bin",
    ]
    if sys.platform == "darwin":
        extra += [Path("/opt/homebrew/bin"), Path("/usr/local/bin")]
    elif sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
        extra += [local / "Programs" / "Python" / f"Python{sys.version_info[0]}{sys.version_info[1]}"]
    else:
        extra += [Path("/usr/local/bin")]
    parts = [p for p in (os.environ.get("PATH") or "").split(os.pathsep) if p]
    for path in extra:
        text = str(path)
        if text not in parts:
            parts.append(text)
    return os.pathsep.join(parts)


def _which(name: str) -> str | None:
    return shutil.which(name, path=_search_path())


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
        f"python{wanted[0]}.{wanted[1]}",
        "python3",
        "python",
    ):
        found = _which(name)
        if found and found not in candidates:
            candidates.append(found)
    matching = [c for c in candidates if _python_version(c) == wanted]
    # El propio intérprete del sidecar va siempre primero: si su versión
    # coincidiera, es el mejor candidato (es el que ejecuta el engine).
    if not getattr(sys, "frozen", False) and sys.executable in matching:
        matching.remove(sys.executable)
        matching.insert(0, sys.executable)
    return matching


def _uv_asset() -> tuple[str, str] | None:
    """``(asset, sha256)`` de `uv` para esta plataforma, o ``None`` si no hay."""
    plat = "darwin" if sys.platform == "darwin" else "win32" if sys.platform == "win32" else "linux"
    return _UV_ASSETS.get((plat, platform.machine().lower()))


def _bundled_uv() -> Path:
    """Ruta del `uv` que descarga la app (exista o no)."""
    name = "uv.exe" if sys.platform == "win32" else "uv"
    return tools_root() / f"uv-{UV_VERSION}" / name


def _ssl_context():
    """Contexto TLS con los certificados de ``certifi`` si está (sidecar congelado).

    El Python congelado no siempre encuentra el almacén del sistema; ``certifi``
    viaja en el bundle (lo arrastra ``httpx``).
    """
    import ssl

    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001 — sin certifi, el almacén del sistema
        return ssl.create_default_context()


def download_uv() -> Path:
    """Descarga el `uv` fijado, verifica su sha256 y lo deja en ``~/.phoson/tools``.

    Lanza ``RuntimeError`` con un motivo legible si la plataforma no tiene
    asset, la descarga falla o la suma no coincide (en ese caso no se instala
    nada).
    """
    import urllib.request

    target = _bundled_uv()
    if target.is_file():
        return target
    asset = _uv_asset()
    if asset is None:
        raise RuntimeError(f"no hay binario de uv para {sys.platform}/{platform.machine()}")
    name, expected = asset
    url = f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{name}"
    tools_root().mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tools_root()) as tmp:
        archive = Path(tmp) / name
        with urllib.request.urlopen(  # noqa: S310 — URL fija de GitHub (https)
            url, timeout=_UV_DOWNLOAD_TIMEOUT, context=_ssl_context()
        ) as response, archive.open("wb") as out:
            shutil.copyfileobj(response, out)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != expected:
            raise RuntimeError(f"la suma sha256 de {name} no coincide ({digest})")
        # Solo se extrae el ejecutable `uv`, por nombre: nada del archivo se
        # escribe fuera de la carpeta temporal.
        wanted = target.name
        extracted = Path(tmp) / wanted
        if name.endswith(".zip"):
            with zipfile.ZipFile(archive) as zf:
                member = next(m for m in zf.namelist() if Path(m).name == wanted)
                extracted.write_bytes(zf.read(member))
        else:
            with tarfile.open(archive, "r:gz") as tf:
                member = next(m for m in tf.getmembers() if Path(m.name).name == wanted and m.isfile())
                source = tf.extractfile(member)
                if source is None:
                    raise RuntimeError(f"{name} no contiene {wanted}")
                extracted.write_bytes(source.read())
        extracted.chmod(0o755)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(extracted, target)
    return target


def installer() -> tuple[str, list[str], str]:
    """El instalador disponible: ``(tipo, comando, motivo)``.

    Tipo: ``"pip"``, ``"uv"`` o ``"uv-download"`` (no hay ninguno en el equipo,
    pero se puede descargar `uv`; el comando está vacío hasta entonces). El
    motivo es ``""`` cuando hay instalador o ``"noPip"`` cuando no.

    El sidecar congelado no cuenta como intérprete: su ``sys.executable`` es el
    binario de la app, que no puede ejecutar ``-m pip``.
    """
    for candidate in _interpreter_candidates():
        if _has_pip(candidate):
            return "pip", [candidate, "-m", "pip", "install"], ""
    for uv in (_which("uv"), str(_bundled_uv()) if _bundled_uv().is_file() else None):
        if uv:
            return "uv", [uv, "pip", "install"], ""
    if _uv_asset() is not None:
        return "uv-download", [], ""
    return "", [], "noPip"


def installable() -> tuple[bool, str]:
    """¿Este sidecar puede instalar extras? ``(sí, motivo)``."""
    kind, _, blocked = installer()
    return (bool(kind), blocked)


def install_extra(extra: str, on_progress: Progress | None = None) -> dict[str, Any]:
    """Instala el extra en ``~/.phoson/extras/<extra>`` y lo habilita.

    Devuelve ``{"ok": True, …}`` o ``{"ok": False, "reason": …}`` con el
    motivo (``noPip``, ``unknownExtra``, ``uvDownloadFailed``,
    ``installFailed``…) y la salida del instalador. ``on_progress`` recibe la
    fase en curso (``downloadingInstaller``, ``installing``).
    """
    progress = on_progress or (lambda _phase: None)
    extra = str(extra or "").strip()
    requirements = requirements_for(extra)
    if not requirements:
        return {"ok": False, "reason": "unknownExtra", "extra": extra}

    kind, prefix, blocked = installer()
    if not kind:
        return {"ok": False, "reason": blocked, "extra": extra}
    if kind == "uv-download":
        progress("downloadingInstaller")
        try:
            uv = download_uv()
        except Exception as exc:  # noqa: BLE001 — red, TLS, suma: todo es «no se pudo»
            return {"ok": False, "reason": "uvDownloadFailed", "extra": extra, "error": str(exc)}
        kind, prefix = "uv", [str(uv), "pip", "install"]

    target = extras_root() / extra
    target.mkdir(parents=True, exist_ok=True)
    if kind == "pip":
        # `--ignore-installed` fuerza que las dependencias ALSO se instalen en
        # el destino: si ya estuvieran en el intérprete del sistema, el sidecar
        # congelado no las encontraría.
        args = [*prefix, "--target", str(target), "--upgrade", "--ignore-installed", *requirements]
    else:
        # `--python X.Y`: los wheels tienen que ser los de la versión del
        # sidecar. Sin él, uv usaba el primer Python que encontrara (el 3.9 de
        # macOS) y el engine no podía importar los módulos nativos. Si no hay
        # ese Python en el equipo, uv descarga uno gestionado.
        wanted = "%d.%d" % sys.version_info[:2]
        args = [*prefix, "--target", str(target), "--python", wanted, "--reinstall", *requirements]

    progress("installing")
    env = {**os.environ, "PATH": _search_path()}
    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=_INSTALL_TIMEOUT,
            env=env,
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
