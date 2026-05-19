"""Generate the marketplace icon (128×128 PNG) from the brand SVG.

The source of truth is ``media/icon-source.svg`` (concept B: navy
shield with a teal accent border + teal check). This script is a
pure-Python renderer that produces the matching PNG so contributors
don't need to install Inkscape / Cairo / a browser to read the icon.

Implementation notes
--------------------

* Renders at 4× supersampling (512×512) and downsamples to 128×128
  with Lanczos resampling. PIL's straight ``ImageDraw`` antialiasing is
  blocky on diagonal strokes; the supersample → downsample pipeline
  gives clean edges that match what a real SVG renderer would produce.

* The shield path uses two quadratic Beziers (top-left and top-right
  arcs at the base) — sampled into polygon points for ``ImageDraw``.

* The check uses ``ImageDraw.line`` with ``joint="curve"`` for the
  vertex join, plus explicit circles at the two endpoints to simulate
  ``stroke-linecap="round"``.

Dependencies: Pillow (``pip install pillow``). Run once after the
brand mark changes; the resulting ``icon.png`` is committed alongside
this script.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# Output size + supersample factor. The renderer composes everything in
# the supersampled space then downsizes — keeps the diagonal stroke of
# the check from going staircase-blocky.
ICON_SIZE = 128
SS = 4
SCALE = SS  # design SVG viewBox is already 128×128, so we just scale by SS

# Pipeline-Check design tokens (mirrors media/icon-source.svg and
# pipeline_check/core/_design_tokens.css).
NAVY_950 = "#04101a"
TEAL = "#1ba3a9"

OUT_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = OUT_DIR / "icon.png"


def _quadratic_bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    steps: int = 48,
) -> list[tuple[float, float]]:
    """Sample a quadratic Bezier curve into ``steps + 1`` polygon points."""
    out: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0]
        y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def _shield_outline() -> list[tuple[float, float]]:
    """Shield polygon in the design's 128×128 viewBox coords.

    Mirrors media/icon-source.svg::

        M 64 12 L 110 26 L 110 62 Q 110 92 64 116 Q 18 92 18 62 L 18 26 Z
    """
    pts: list[tuple[float, float]] = [
        (64.0, 12.0),     # top-centre cusp
        (110.0, 26.0),    # top-right
        (110.0, 62.0),    # right-side straight down
    ]
    # Bottom-right curve down to the apex.
    pts.extend(_quadratic_bezier((110.0, 62.0), (110.0, 92.0), (64.0, 116.0)))
    # Bottom-left curve back up.
    pts.extend(_quadratic_bezier((64.0, 116.0), (18.0, 92.0), (18.0, 62.0)))
    pts.append((18.0, 26.0))  # left-side straight up
    return pts


def _scaled(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return [(x * SCALE, y * SCALE) for x, y in pts]


def _round_cap(
    draw: ImageDraw.ImageDraw,
    centre: tuple[float, float],
    width: float,
    fill: str,
) -> None:
    """Draw a filled circle to simulate ``stroke-linecap="round"``."""
    r = width / 2.0
    draw.ellipse(
        (centre[0] - r, centre[1] - r, centre[0] + r, centre[1] + r),
        fill=fill,
    )


def main() -> None:
    big_size = ICON_SIZE * SS
    img = Image.new("RGBA", (big_size, big_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    shield = _scaled(_shield_outline())

    # Fill the navy shield.
    draw.polygon(shield, fill=NAVY_950)

    # Stroke the teal accent border (width 4 in viewBox space).
    border_width = 4 * SCALE
    draw.line(
        shield + [shield[0]],
        fill=TEAL,
        width=border_width,
        joint="curve",
    )
    # Round-cap the implicit "close path" join at the top cusp so it
    # doesn't read as a notch.
    _round_cap(draw, shield[0], border_width, TEAL)

    # Inner ribbon at 25% opacity. Implemented by drawing the path at
    # full opacity onto a transparent layer, then alpha-compositing
    # with reduced opacity onto the main image.
    ribbon = _scaled(
        [(64.0, 22.0), (100.0, 32.0), (100.0, 62.0)]
        + _quadratic_bezier((100.0, 62.0), (100.0, 86.0), (64.0, 106.0))
        + _quadratic_bezier((64.0, 106.0), (28.0, 86.0), (28.0, 62.0))
        + [(28.0, 32.0)]
    )
    ribbon_layer = Image.new("RGBA", (big_size, big_size), (0, 0, 0, 0))
    ribbon_draw = ImageDraw.Draw(ribbon_layer, "RGBA")
    ribbon_draw.line(
        ribbon + [ribbon[0]],
        fill=TEAL,
        width=1 * SCALE,
        joint="curve",
    )
    # Reduce to 25% opacity.
    alpha = ribbon_layer.split()[-1].point(lambda v: int(v * 0.25))
    ribbon_layer.putalpha(alpha)
    img.alpha_composite(ribbon_layer)

    # Check mark.
    check_pts = _scaled([(40.0, 64.0), (56.0, 80.0), (88.0, 48.0)])
    check_width = 11 * SCALE
    draw.line(check_pts, fill=TEAL, width=check_width, joint="curve")
    _round_cap(draw, check_pts[0], check_width, TEAL)
    _round_cap(draw, check_pts[-1], check_width, TEAL)

    # Downsample with Lanczos for smooth edges.
    img = img.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    img.save(OUT_PATH, "PNG", optimize=True)
    print(f"wrote {OUT_PATH} ({ICON_SIZE}×{ICON_SIZE}) from media/icon-source.svg")


if __name__ == "__main__":
    main()
