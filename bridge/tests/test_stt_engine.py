# -*- coding: utf-8 -*-
"""Regresa si el motor de dictado está operativo y con qué modelo/idioma."""
import io
import json
import os
import sys

for _root in (os.path.abspath("bridge"), os.getcwd()):
    if os.path.isdir(_root) and _root not in sys.path:
        sys.path.insert(0, _root)

try:
    from phoson_bridge.stt import SttManager
except ImportError as exc:  # pragma: no cover - falta el bridge
    print("STT SKIP:", exc)
    sys.exit(0)

try:
    import phoson_plugin_stt  # noqa: F401
except ImportError:  # pragma: no cover - CI sin engine
    print("STT SKIP: phoson_plugin_stt no instalable aquí")
    sys.exit(0)

manager = SttManager(lambda _m, _p: None)
status = manager.status()
print(json.dumps(status, ensure_ascii=False))
if not status["supported"]:
    print("STT FAIL:", status.get("reason"))
    sys.exit(1)
print("STT OK")
