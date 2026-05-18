"""Generate the marketplace icon (128x128 PNG) from the brand SVG.

Re-run when the brand mark changes; the resulting ``icon.png`` is
committed alongside this script so contributors don't need to install
Pillow just to read it. The script depends on Pillow (``pip install
pillow``); a single one-shot, not part of the extension build.

The mark is the same shield + teal checkmark used in the
pipeline-check docs hero. Path data lifted verbatim from
``dmartinochoa/pipeline-check`` ``docs/index.md`` so the marketplace
icon, the docs hero, and the favicon share a single visual identity.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ICON_SIZE = 128
SCALE = 2  # viewBox is 64x64 in the brand SVG.

# Pipeline-Check design tokens (lifted from
# pipeline_check/core/_design_tokens.css + extra.css).
NAVY_950 = "#04101a"
WHITE = "#f0f2f5"
TEAL = "#1ba3a9"

OUT_DIR = Path(__file__).resolve().parent.parent
OUT_PATH = OUT_DIR / "icon.png"


def _cubic_bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 32,
) -> list[tuple[float, float]]:
    """Sample a cubic Bezier curve into ``steps + 1`` polygon points."""
    points: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = (
            mt ** 3 * p0[0]
            + 3 * mt ** 2 * t * p1[0]
            + 3 * mt * t ** 2 * p2[0]
            + t ** 3 * p3[0]
        )
        y = (
            mt ** 3 * p0[1]
            + 3 * mt ** 2 * t * p1[1]
            + 3 * mt * t ** 2 * p2[1]
            + t ** 3 * p3[1]
        )
        points.append((x, y))
    return points


def _shield_outline() -> list[tuple[float, float]]:
    """Return the shield polygon in viewBox (64x64) coordinates.

    Mirrors the SVG path::

        M32 6 L54 13 V31
        C54 44.5 44.5 53.5 32 58
        C19.5 53.5 10 44.5 10 31
        V13 Z

    Two cubic Beziers form the bottom curve; the rest is straight.
    """
    pts: list[tuple[float, float]] = [
        (32.0, 6.0),    # top center
        (54.0, 13.0),   # top right
        (54.0, 31.0),   # vertical line down right side
    ]
    # First bezier: down-right curve to bottom apex.
    pts.extend(_cubic_bezier(
        (54.0, 31.0), (54.0, 44.5), (44.5, 53.5), (32.0, 58.0),
    ))
    # Second bezier: bottom apex back up to left side.
    pts.extend(_cubic_bezier(
        (32.0, 58.0), (19.5, 53.5), (10.0, 44.5), (10.0, 31.0),
    ))
    pts.append((10.0, 13.0))  # vertical line up left side
    return pts


def _scaled(
    points: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    return [(x * SCALE, y * SCALE) for x, y in points]


def main() -> None:
    img = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), NAVY_950)
    draw = ImageDraw.Draw(img)

    # Shield outline, no fill, 5px stroke (≈2.5 in viewBox * SCALE).
    shield = _scaled(_shield_outline())
    draw.line(shield + [shield[0]], fill=WHITE, width=5, joint="curve")

    # Checkmark: M22 32 L29 39 L43 24, 6px stroke (3 in viewBox * SCALE).
    check = _scaled([(22.0, 32.0), (29.0, 39.0), (43.0, 24.0)])
    draw.line(check, fill=TEAL, width=6, joint="curve")

    img.save(OUT_PATH, "PNG", optimize=True)
    print(f"wrote {OUT_PATH} ({ICON_SIZE}x{ICON_SIZE})")


if __name__ == "__main__":
    main()
