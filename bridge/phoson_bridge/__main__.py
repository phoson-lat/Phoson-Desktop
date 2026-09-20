"""Entry point del sidecar ``phoson-bridge``.

CRÍTICO: stdout es el canal del protocolo. Cualquier ``print`` del engine o de
los plugins lo rompería, así que aquí duplicamos el fd original para el
protocolo y reasignamos ``sys.stdout`` a stderr. A partir de este punto, todo lo
que los plugins escriban "a stdout" irá a stderr (visible en logs, no en framing).
"""

from __future__ import annotations

import os
import sys


def run() -> None:
    protocol_fd = os.dup(sys.stdout.fileno())
    protocol_out = os.fdopen(protocol_fd, "w", buffering=1, encoding="utf-8")
    sys.stdout = sys.stderr  # aísla prints accidentales del framing

    from .server import main

    main(protocol_out)


if __name__ == "__main__":
    run()
