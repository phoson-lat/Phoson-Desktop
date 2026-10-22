#!/usr/bin/env python3
"""Genera los iconos de la bandeja del sistema (tray) para cada plataforma.

Por qué existe este script (y no se usa `default_window_icon`):
  * macOS dibuja la bandeja en la barra de menús, sobre fondos claros u
    oscuros. El icono de la app (cuadrado blanco a color) se ve como un
    parche. macOS espera una *template image*: monocromo negro + alfa, que
    el sistema recolorea solo. Además se renderiza a 18 pt de alto, por lo
    que conviene un PNG de 36x36 px (18 pt @2x).
  * Windows dibuja la bandeja a 16x16 px lógicos (32 px con DPI 200 %).
    Un icono de 512 px se reescala fatal y pierde detalle. Se usa un glifo
    simple de 32x32 px con fondo circular blanco para que se lea igual
    sobre la barra clara y la oscura.
  * Linux (AppIndicator/StatusNotifier) escribe el PNG y el panel lo
    escala; 32x32 px es el tamaño habitual (22-24 px de panel).

Se ejecuta a mano cuando cambie la marca:

    python3 scripts/gen-tray-icons.py

Salida: src-tauri/icons/tray/{tray-template.png,tray.png}
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "tray"

# Geometría del hexágono de la marca (viewBox 0 0 500 500 de public/icon.svg).
HEXAGON = [
    (250.0, 120.0),
    (362.6, 185.0),
    (362.6, 315.0),
    (250.0, 380.0),
    (137.4, 315.0),
    (137.4, 185.0),
]

# Caja del glifo (hexágono): 225.2 x 260 unidades centradas en (250, 250).
GLYPH_HALF_HEIGHT = 130.0
CENTER = 250.0

SUPERSAMPLE = 8


def _star(radius: float = 40.0):
    """Estrella de cuatro puntas (el destello central de la marca)."""
    r = radius
    mid = r / 2
    return [
        (CENTER, CENTER - r),
        (CENTER + mid, CENTER - mid),
        (CENTER + r, CENTER),
        (CENTER + mid, CENTER + mid),
        (CENTER, CENTER + r),
        (CENTER - mid, CENTER + mid),
        (CENTER - r, CENTER),
        (CENTER - mid, CENTER - mid),
    ]


def _fit(points, canvas: int, fill: float):
    """Escala el glifo para que su altura ocupe `fill` del lienzo."""
    k = (canvas * fill) / (GLYPH_HALF_HEIGHT * 2)
    return [((x - CENTER) * k + canvas / 2, (y - CENTER) * k + canvas / 2) for x, y in points]


def _draw_glyph(draw: ImageDraw.ImageDraw, canvas: int, fill: float, color) -> None:
    """Dibuja hexágono + estrella en un lienzo cuadrado de `canvas` px."""
    hexagon = _fit(HEXAGON, canvas, fill)
    stroke = max(1, round(canvas * 0.065))
    draw.line(hexagon + [hexagon[0]], fill=color, width=stroke, joint="curve")
    draw.polygon(_fit(_star(40.0), canvas, fill), fill=color)


def _render(size: int, *, template: bool) -> Image.Image:
    canvas = size * SUPERSAMPLE
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if template:
        # Template image de macOS: negro con alfa; el sistema lo recolorea.
        # La barra fija 18 pt de alto, así que el glifo puede llenar casi todo.
        _draw_glyph(draw, canvas, fill=0.92, color=(0, 0, 0, 255))
    else:
        # Windows/Linux: disco blanco + glifo violeta oscuro (la marca, sin
        # el cuadrado del icono de app). El disco da contraste en barras
        # claras y oscuras.
        margin = round(canvas * 0.03)
        draw.ellipse((margin, margin, canvas - margin, canvas - margin), fill=(255, 255, 255, 255))
        _draw_glyph(draw, canvas, fill=0.52, color=(40, 8, 84, 255))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # macOS: 36 px = 18 pt @2x (tray-icon fija la altura a 18 pt).
    _render(36, template=True).save(OUT_DIR / "tray-template.png", optimize=True)
    # Windows y Linux comparten el icono a color de 32 px.
    _render(32, template=False).save(OUT_DIR / "tray.png", optimize=True)

    root = OUT_DIR.parent.parent.parent
    for name in ("tray-template.png", "tray.png"):
        path = OUT_DIR / name
        print(f"wrote {path.relative_to(root)} ({path.stat().st_size} B)")


if __name__ == "__main__":
    main()
