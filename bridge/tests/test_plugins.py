"""Sección «Plugins» de Ajustes: catálogo del bridge y toggles de config.

Cubre `phoson_bridge.plugins` (catálogo + `set_enabled`) tal como lo ve el
usuario: qué plugins oficiales salen, con qué mecanismo se activan, cuáles no se
pueden tocar desde aquí y **qué queda escrito en `config.toml`** al activar o
desactivar — que es lo que el engine leerá al arrancar.

No toca el `config.toml` real ni construye el engine: `HOME` apunta a un
directorio temporal (el engine resuelve `~/.phoson` con `expanduser`) y se
limpian los `PHOSON_*` del entorno para que el archivo sea la única fuente.

    python bridge/tests/test_plugins.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import tomllib
import tempfile
import importlib
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# HOME temporal ANTES de importar el engine: `~/.phoson/config.toml` se resuelve
# por expanduser, así que esto aísla el test del config del usuario (y de sus
# claves en el entorno, que se limpian igualmente).
_TMP = tempfile.mkdtemp(prefix="phoson-plugins-test-")
for _var in ("HOME", "USERPROFILE"):
    os.environ[_var] = _TMP
for _key in [k for k in os.environ if k.startswith("PHOSON_")]:
    os.environ.pop(_key)

from phoson_cli.config import load_config  # noqa: E402
from phoson_cli.labels import PLUGIN_LABELS, PLUGIN_REQUIRED_EXTRAS  # noqa: E402
from phoson_bridge import plugins as P  # noqa: E402
from phoson_bridge.server import Bridge, SessionManager  # noqa: E402

CONFIG = Path(_TMP) / ".phoson" / "config.toml"
CONFIG.parent.mkdir(parents=True, exist_ok=True)

failures: list[str] = []


def _check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {name}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(name)


def _fresh(text: str = "") -> object:
    """config.toml nuevo (o ausente) + la config que cargaría el bridge."""
    CONFIG.unlink(missing_ok=True)
    if text:
        CONFIG.write_text(text, encoding="utf-8")
    return load_config()


def _defaults() -> dict:
    return tomllib.loads(CONFIG.read_text(encoding="utf-8"))["defaults"]


def _entry(cfg: object, plugin_id: str) -> dict:
    return next(e for e in P.catalog(cfg) if e["id"] == plugin_id)


# 1) Catálogo: los plugins oficiales, con el nombre y la descripción del engine.
cfg = _fresh()
entries = P.catalog(cfg)
_check(
    "el catálogo trae todos los plugins oficiales",
    {e["id"] for e in entries} == set(PLUGIN_LABELS),
    f"{sorted(e['id'] for e in entries)}",
)
_check(
    "nombre y descripción salen de phoson_cli.labels",
    all(
        (e["name"], e["description"]) == PLUGIN_LABELS[e["id"]]
        for e in entries
        if e["id"] in PLUGIN_LABELS
    ),
)
_check(
    "sin config.toml ningún plugin del catálogo está activo",
    all(not e["enabled"] for e in entries),
    str([e["id"] for e in entries if e["enabled"]]),
)

# 2) Estado: la lista de specs, los flags y lo que no se gobierna desde aquí.
cfg = _fresh(
    "[defaults]\n"
    "enable_monitors = true\n"
    "enable_ssh = true\n"
    'theme = "dark"  # no gestionado por Plugins\n'
    'plugins = ["otro-plugin", { name = "phoson-plugin-memory", config = { db = "redis://x" } }]\n'
    'disabled_plugins = ["phoson-plugin-bgjobs"]\n'
)
monitors = _entry(cfg, "phoson-plugin-monitor")
_check(
    "un flag activo marca el plugin activo por flag (no por lista)",
    monitors["enabled"] and monitors["mechanism"] == "flag" and not monitors["listed"],
    str(monitors),
)
ssh = _entry(cfg, "phoson-plugin-ssh")
_check(
    "un flag que save_config no persiste bloquea el toggle y nombra la fuente",
    ssh["enabled"] and ssh["locked"] and ssh["lockReason"] == "file:enable_ssh",
    str(ssh),
)
memory = _entry(cfg, "phoson-plugin-memory")
_check(
    "una spec de la lista está activa por lista",
    memory["enabled"] and memory["mechanism"] == "list" and memory["listed"],
    str(memory),
)
bgjobs = _entry(cfg, "phoson-plugin-bgjobs")
_check(
    "una spec en disabled_plugins se muestra inactiva",
    not bgjobs["enabled"] and bgjobs["mechanism"] == "flag",
    str(bgjobs),
)
stt = _entry(cfg, "phoson-plugin-stt")
_check(
    "el dictado se muestra y se marca como no gobernable aquí",
    stt["locked"] and stt["lockReason"] == "dictation" and not stt["enabled"],
    str(stt),
)
third = _entry(cfg, "otro-plugin")
_check(
    "una spec desconocida también se lista, marcada como no oficial",
    third["enabled"]
    and third["name"] == "otro-plugin"
    and not third["locked"]
    and third["official"] is False
    and memory["official"] is True,
    str(third),
)

# 3) Origen del flag activo: el entorno gana y se nombra tal cual.
os.environ["PHOSON_ENABLE_OTEL"] = "1"
cfg = _fresh("[defaults]\n")
otel = _entry(cfg, "phoson-plugin-otel")
_check(
    "un flag activo por entorno se nombra como env:VAR",
    otel["enabled"] and otel["locked"] and otel["lockReason"] == "env:PHOSON_ENABLE_OTEL",
    str(otel),
)
os.environ.pop("PHOSON_ENABLE_OTEL")

# 4) Activar un plugin con flag: escribe el flag y NO la lista (si estuviera en
#    las dos, el engine lo cargaría dos veces: la lista y el builder del flag).
cfg = _fresh("[defaults]\ntheme = \"dark\"\n# comentario que debe sobrevivir\n")
result = P.set_enabled(cfg, "phoson-plugin-monitor", True)
text = CONFIG.read_text(encoding="utf-8")
_check(
    "activar un plugin con flag persiste el flag y no toca las listas",
    result["ok"]
    and result["fields"] == ["enable_monitors"]
    and cfg.enable_monitors is True
    and _defaults()["enable_monitors"] is True
    and "plugins" not in _defaults()
    and "disabled_plugins" not in _defaults(),
    f"{result} · {text!r}",
)
_check(
    "la escritura conserva los ajustes y comentarios ajenos a Plugins",
    'theme = "dark"' in text and "# comentario que debe sobrevivir" in text,
    repr(text),
)
_check(
    "reactivar lo ya activo no reescribe el archivo",
    P.set_enabled(cfg, "phoson-plugin-monitor", True) == {"ok": True, "fields": []},
)

# 5) Desactivar ese mismo plugin: apaga el flag y no lo aparca en la lista.
cfg = _fresh("[defaults]\nenable_monitors = true\n")
result = P.set_enabled(cfg, "phoson-plugin-monitor", False)
_check(
    "desactivar un plugin con flag apaga solo el flag",
    result["ok"]
    and result["fields"] == ["enable_monitors"]
    and cfg.enable_monitors is False
    and _defaults()["enable_monitors"] is False
    and "disabled_plugins" not in _defaults(),
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)
_check(
    "desactivar lo ya desactivado no reescribe el archivo",
    P.set_enabled(cfg, "phoson-plugin-monitor", False) == {"ok": True, "fields": []},
)

# 6) Activar un plugin sin flag: entra en la lista de specs.
cfg = _fresh("[defaults]\ntheme = \"dark\"\n")
result = P.set_enabled(cfg, "phoson-plugin-memory", True)
_check(
    "activar un plugin sin flag lo añade a plugins",
    result["ok"]
    and result["fields"] == ["plugins"]
    and cfg.plugins == ["phoson-plugin-memory"]
    and _defaults()["plugins"] == ["phoson-plugin-memory"]
    and "disabled_plugins" not in _defaults(),
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)

# 7) Ida y vuelta con una tabla inline: la config del plugin no se pierde.
cfg = _fresh(
    '[defaults]\nplugins = [{ name = "phoson-plugin-memory", config = { db = "redis://x" } }]\n'
)
result = P.set_enabled(cfg, "phoson-plugin-memory", False)
_check(
    "desactivar mueve la spec entera (con su config) a disabled_plugins",
    result["ok"]
    and _defaults()["plugins"] == []
    and _defaults()["disabled_plugins"]
    == [{"name": "phoson-plugin-memory", "config": {"db": "redis://x"}}],
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)
cfg = load_config()
result = P.set_enabled(cfg, "phoson-plugin-memory", True)
_check(
    "reactivar restaura la spec original con su config",
    result["ok"]
    and _defaults()["plugins"] == [{"name": "phoson-plugin-memory", "config": {"db": "redis://x"}}]
    and _defaults()["disabled_plugins"] == [],
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)

# 8) Pasar a flag un plugin aparcado en la lista no deja rastro mentiroso.
cfg = _fresh(
    '[defaults]\ndisabled_plugins = ["phoson-plugin-monitor"]\n'
)
result = P.set_enabled(cfg, "phoson-plugin-monitor", True)
_check(
    "activar por flag descarta la spec aparcada (plugin list no mentiría)",
    result["ok"]
    and cfg.enable_monitors is True
    and cfg.disabled_plugins == []
    and _defaults().get("disabled_plugins", []) == [],
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)

# 9) Lo que la UI no puede gobernar.
cfg = _fresh("[defaults]\nenable_ssh = true\n")
result = P.set_enabled(cfg, "phoson-plugin-ssh", False)
_check(
    "no se puede apagar un flag que save_config no persiste",
    result == {"ok": False, "reason": "locked", "detail": "file:enable_ssh"},
    str(result),
)
result = P.set_enabled(cfg, "phoson-plugin-stt", True)
_check(
    "el dictado no se activa desde Plugins",
    result["ok"] is False and result["reason"] == "locked" and result["detail"] == "dictation",
    str(result),
)

# 10) Primera escritura: sin config.toml (usuario nuevo) se crea el archivo.
cfg = _fresh()
_check("sin config.toml no hay nada que leer", not CONFIG.exists())
result = P.set_enabled(cfg, "phoson-plugin-memory", True)
_check(
    "la primera escritura crea el config.toml con el plugin activo",
    result["ok"] and CONFIG.exists() and _defaults()["plugins"] == ["phoson-plugin-memory"],
    f"{result} · {CONFIG.read_text(encoding='utf-8')!r}",
)

# 11) Error de uso: una spec vacía no puede escribir nada.
try:
    P.set_enabled(cfg, "   ", True)
    empty_ok, detail = False, "no lanzó"
except ValueError as exc:
    empty_ok, detail = True, str(exc)
_check("una spec vacía se rechaza", empty_ok, detail)

# 12) Extras opcionales: el sondeo es el mismo que hace el wizard.
def _has_module(module: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


_check(
    "un extra que falta se reporta con su nombre",
    P._missing_extra("x", {"x": ("phoson_modulo_que_no_existe", "the-extra")}) == "the-extra",
)
_check(
    "un módulo presente no reporta extra",
    P._missing_extra("json", {"json": ("json", "the-extra")}) == "",
)
missing = [
    spec
    for spec, (module, extra) in PLUGIN_REQUIRED_EXTRAS.items()
    if _entry(cfg, spec)["missingExtra"] != ("" if _has_module(module) else extra)
]
_check(
    "missingExtra sale de PLUGIN_REQUIRED_EXTRAS del engine",
    missing == [],
    str(missing),
)

# 13) Instalación: no hay `uv` en el sidecar congelado y se dice sin intentarlo.
try:
    sys.frozen = True
    frozen = P.installable()
finally:
    del sys.frozen
_check("un sidecar congelado no puede instalar", frozen == (False, "frozen"), str(frozen))

# 14) `install` delega en el engine (con un espía: nada sale a la red) y el
#     plugin recién instalado aparece activo en el catálogo.
_manager = importlib.import_module("phoson_cli.plugin_manager")
_seen: dict[str, str] = {}


def _fake_install(source: str, config: object) -> str:  # pragma: no cover - espía
    _seen["source"] = source
    config.plugins.append("entrypoint:demo-plugin")
    return "demo-plugin"


_real_install = _manager.install_plugin
_manager.install_plugin = _fake_install
try:
    cfg = _fresh("[defaults]\n")
    name = P.install(cfg, "  git+https://example.invalid/demo  ")
    catalog_ids = {e["id"]: e["enabled"] for e in P.catalog(cfg)}
finally:
    _manager.install_plugin = _real_install
_check(
    "install delega en el engine con el origen ya recortado",
    name == "demo-plugin" and _seen["source"] == "git+https://example.invalid/demo",
    f"{name} {_seen}",
)
_check(
    "el plugin instalado aparece en el catálogo",
    catalog_ids.get("entrypoint:demo-plugin") is True,
    str(catalog_ids),
)

# 15) Propagación: los plugins son estado global (`config.toml`), así que el
#     espejo del toggle tiene que alcanzar a todas las sesiones — a las que ya
#     tienen engine y a las abiertas que todavía no se construyeron. Con una
#     copia vieja, esa sesión arrancaría sin el plugin recién activado (el bug
#     del toggle que «no daba tools» a las otras sesiones).
async def _propagation_case() -> tuple[bool, str]:
    base = _fresh('[defaults]\nplugins = ["phoson-plugin-memory"]\n')
    mgr = SessionManager(base, lambda *_a, **_k: None)
    otra = mgr.create()  # abierta antes del cambio y aún sin engine
    toggled = mgr.create()
    # `get()` mueve la sesión de `_pending` a `_repls` al construir su engine;
    # aquí basta con simular ese paso: el espejo solo lee la config.
    cfg_toggled = mgr._pending.pop(toggled)[0]
    repl = SimpleNamespace(config=cfg_toggled)
    mgr._repls[toggled] = repl

    cfg_toggled.enable_computeruse = True  # el toggle del usuario
    Bridge._mirror_config_fields(
        SimpleNamespace(config=base),
        cfg_toggled,
        ["enable_computeruse"],
        mgr.session_configs(),
    )

    configs = mgr.session_configs()
    ok = (
        base.enable_computeruse is True
        and mgr.config_for(otra).enable_computeruse is True
        and mgr.built_repls() == [repl]
        and cfg_toggled in configs
        and mgr.config_for(otra) in configs
    )
    return ok, (
        f"base={base.enable_computeruse} otra={mgr.config_for(otra).enable_computeruse} "
        f"built={len(mgr.built_repls())} configs={len(configs)}"
    )


_passed, _detail = asyncio.run(_propagation_case())
_check(
    "el espejo del toggle alcanza a las sesiones vivas y a las no construidas",
    _passed,
    _detail,
)

CONFIG.unlink(missing_ok=True)
print("-" * 40)
print("FAILED:", failures) if failures else print("todo OK")
sys.exit(1 if failures else 0)