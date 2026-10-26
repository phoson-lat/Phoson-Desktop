"""Extras del engine: resolverlos, instalarlos y que el plugin los encuentre.

Un plugin del engine puede depender de un **extra** opcional (`[stt]`,
`[computeruse]`…): si faltan sus dependencias, el motor carga el plugin pero lo
salta. Este test cubre la parte que no toca la red:

1. los requisitos del extra se resuelven desde los **metadatos del engine**
   (no hay una lista de pines duplicada en el bridge);
2. el plan B (evaluar los markers a mano, sin `packaging` — el sidecar
   congelado no lo lleva) coincide con el plan A;
3. el hermano de plataforma se suma (`[computeruse]` arrastra `[computeruse-macos]`
   en macOS);
4. `bootstrap_paths` deja los extras instalados en el `sys.path` (idempotente);
5. un extra desconocido se rechaza sin tocar nada.

No instala nada (eso necesita red): el resto de pruebas del bridge comprueban
el camino real.

    python bridge/tests/test_extras.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# HOME temporal: `~/.phoson/extras` se resuelve con `expanduser`, así que esto
# aísla el test de los extras que tenga instalados el usuario.
_TMP = tempfile.mkdtemp(prefix="phoson-extras-test-")
for _var in ("HOME", "USERPROFILE"):
    os.environ[_var] = _TMP

from phoson_bridge import extras as E  # noqa: E402

failures: list[str] = []


def _check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


# 1) Los requisitos salen de los metadatos del engine instalado.
stt = E.requirements_for("stt")
_check(
    "el extra [stt] trae su requisito (moonshine-voice)",
    any(r.startswith("moonshine-voice") for r in stt),
    str(stt),
)
computeruse = E.requirements_for("computeruse")
_check(
    "el extra [computeruse] trae mss y pillow",
    any(r.startswith("mss") for r in computeruse)
    and any(r.startswith("pillow") for r in computeruse),
    str(computeruse),
)
_check(
    "los requisitos no arrastran el marker (pip lo saltaría)",
    all(";" not in r and "extra ==" not in r for r in stt + computeruse),
    str(stt + computeruse),
)

# 2) El hermano de plataforma: en macOS, [computeruse] arrastra Quartz.
siblings = E._extra_family("computeruse")
_check(
    "el extra de computeruse suma su hermano de plataforma",
    ("computeruse-macos" in siblings) == (sys.platform == "darwin"),
    str(siblings),
)

# 3) Plan B (sin `packaging`): los mismos requisitos que el plan A.
same = all(
    E._requirements_without_packaging(name) == E._requirements_with_packaging(name)
    for name in ("stt", "computeruse", "ssh", "mcp", "memory", "checkpoint")
)
_check("el plan B coincide con el plan A", same)

# 4) Un marker con `and`/`or` se evalúa bien a mano.
env = E._local_env("stt")
_check(
    "un marker con `or` se evalúa",
    E._eval_marker("(sys_platform != 'zzz' or platform_machine != 'zzz')", env) is True,
)
_check(
    "un marker con `and` se evalúa",
    E._eval_marker("sys_platform == 'zzz' and extra == 'stt'", env) is False,
)
_check(
    "la cláusula `extra == 'x'` se quita con su conector",
    E._strip_extra_clause("(sys_platform != 'darwin' or platform_machine != 'x86_64') and extra == 'stt'")
    == "(sys_platform != 'darwin' or platform_machine != 'x86_64')",
    E._strip_extra_clause(
        "(sys_platform != 'darwin' or platform_machine != 'x86_64') and extra == 'stt'"
    ),
)

# 5) `bootstrap_paths` mete los extras en el `sys.path` y es idempotente.
root = E.extras_root()
(root / "stt").mkdir(parents=True, exist_ok=True)
added = E.bootstrap_paths()
_check("bootstrap_paths añade el extra al sys.path", str(root / "stt") in sys.path, str(added))
_check("bootstrap_paths es idempotente", E.bootstrap_paths() == [], str(E.bootstrap_paths()))

# 6) Un extra que el engine no declara se rechaza sin instalar nada.
result = E.install_extra("no-existe-este-extra")
_check(
    "un extra desconocido se rechaza",
    result.get("ok") is False and result.get("reason") == "unknownExtra",
    str(result),
)

# 7) Con el PATH mínimo de launchd (app abierta desde Finder) se buscan también
#    las rutas habituales de uv/Python.
os.environ["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
search = E._search_path().split(os.pathsep)
_check(
    "el PATH de búsqueda suma ~/.local/bin (donde vive uv)",
    str(Path.home() / ".local" / "bin") in search,
    str(search),
)
if sys.platform == "darwin":
    _check("el PATH de búsqueda suma Homebrew", "/opt/homebrew/bin" in search, str(search))

# 8) Sin pip ni uv en el equipo, el instalador es la descarga de uv.
_orig_candidates, _orig_which = E._interpreter_candidates, E._which
E._interpreter_candidates = lambda: []
E._which = lambda _name: None
kind, prefix, blocked = E.installer()
_check(
    "sin instalador en el equipo se ofrece descargar uv",
    (kind, prefix, blocked) == ("uv-download", [], "") if E._uv_asset() else kind == "",
    str((kind, prefix, blocked)),
)
_check("instalable aunque el equipo no tenga pip ni uv", E.installable() == (True, "") or not E._uv_asset())

# 9) La descarga de uv verifica el sha256 y solo extrae el ejecutable.
import hashlib  # noqa: E402
import io  # noqa: E402
import tarfile  # noqa: E402
import urllib.request  # noqa: E402

_payload = io.BytesIO()
with tarfile.open(fileobj=_payload, mode="w:gz") as _tf:
    for _name, _data in (("uv-x/uv", b"#!/bin/sh\necho uv\n"), ("uv-x/uvx", b"no")):
        _info = tarfile.TarInfo(_name)
        _info.size = len(_data)
        _tf.addfile(_info, io.BytesIO(_data))
_archive = _payload.getvalue()
_orig_asset, _orig_urlopen = E._uv_asset, urllib.request.urlopen
urllib.request.urlopen = lambda *_a, **_k: io.BytesIO(_archive)  # type: ignore[assignment]

E._uv_asset = lambda: ("uv-test.tar.gz", "0" * 64)
try:
    E.download_uv()
    bad_sum = "no lanzó"
except RuntimeError as exc:
    bad_sum = str(exc)
_check(
    "una suma sha256 distinta se rechaza sin instalar uv",
    "sha256" in bad_sum and not E._bundled_uv().exists(),
    bad_sum,
)

E._uv_asset = lambda: ("uv-test.tar.gz", hashlib.sha256(_archive).hexdigest())
uv_path = E.download_uv()
_check(
    "uv se descarga a ~/.phoson/tools y queda ejecutable",
    uv_path == E._bundled_uv() and uv_path.read_bytes().startswith(b"#!/bin/sh")
    and os.access(uv_path, os.X_OK),
    str(uv_path),
)
_check(
    "solo se extrae el ejecutable uv (nada más del archivo)",
    sorted(p.name for p in uv_path.parent.iterdir()) == [uv_path.name],
    str(list(uv_path.parent.iterdir())),
)
_check("con uv descargado el instalador es uv", E.installer()[0] == "uv", str(E.installer()))
urllib.request.urlopen = _orig_urlopen  # type: ignore[assignment]

# 10) uv instala los wheels de la versión de Python del sidecar (`--python X.Y`)
#     y la fase se reporta.
import subprocess  # noqa: E402

_calls: list[list[str]] = []
_orig_run = E.subprocess.run


def _fake_run(args, **_kw):
    _calls.append(list(args))
    return subprocess.CompletedProcess(args, 0, "ok", "")


E.subprocess.run = _fake_run  # type: ignore[assignment]
_orig_module_for = E.module_for
E.module_for = lambda _extra: ""
phases: list[str] = []
result = E.install_extra("stt", phases.append)
wanted = "%d.%d" % sys.version_info[:2]
_check(
    "uv recibe --python con la versión del sidecar",
    bool(_calls) and "--python" in _calls[-1] and _calls[-1][_calls[-1].index("--python") + 1] == wanted,
    str(_calls[-1:]),
)
_check("la instalación con uv termina ok", result.get("ok") is True, str(result))
_check("se reporta la fase de instalación", phases == ["installing"], str(phases))

# 11) Sin uv local, la instalación pasa por la descarga (y la reporta).
uv_path.unlink()
E._uv_asset = lambda: ("uv-test.tar.gz", "0" * 64)
urllib.request.urlopen = lambda *_a, **_k: io.BytesIO(_archive)  # type: ignore[assignment]
phases.clear()
result = E.install_extra("stt", phases.append)
_check(
    "una descarga de uv fallida se reporta con su motivo",
    result.get("reason") == "uvDownloadFailed" and phases == ["downloadingInstaller"],
    str((result, phases)),
)
urllib.request.urlopen = _orig_urlopen  # type: ignore[assignment]
E.subprocess.run = _orig_run  # type: ignore[assignment]
E._interpreter_candidates, E._which = _orig_candidates, _orig_which
E._uv_asset, E.module_for = _orig_asset, _orig_module_for

print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)
