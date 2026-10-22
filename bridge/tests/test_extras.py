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

print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)
