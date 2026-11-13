"""Generate yuan-Gym icons from the master artwork.

Removes the black corners (outside the rounded square) by flood-filling
from each corner, then exports the standard icon set + favicon.

Usage:  python tools/make_icon.py <source-image>
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIRS = [
    os.path.join(ROOT, "yuan-gym", "public", "icons"),
    os.path.join(ROOT, "design", "icons"),
]

SIZES = [512, 384, 256, 192, 180, 152, 144, 128, 120, 96, 72, 64, 48, 32]


def cut_corners(src: Image.Image) -> Image.Image:
    """Flood-fill near-black from the four corners, then make it transparent."""
    rgb = src.convert("RGB")
    w, h = rgb.size
    work = rgb.copy()
    marker = (255, 0, 255)
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(work, xy, marker, thresh=45)

    px = work.load()
    out = rgb.convert("RGBA")
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == marker:
                opx[x, y] = (0, 0, 0, 0)

    # Build a clean alpha channel: 0 outside, 255 inside, then feather 1px.
    alpha = out.split()[3]
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
    # Re-sharpen the plateau so the interior stays fully opaque.
    alpha = alpha.point(lambda v: 255 if v > 178 else (0 if v < 78 else v))
    out.putalpha(alpha)
    return out


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: make_icon.py <source-image>")
    src = Image.open(sys.argv[1]).convert("RGB")
    icon = cut_corners(src)

    # Square canvas, centered, so every size keeps the same framing.
    side = max(icon.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(icon, ((side - icon.size[0]) // 2, (side - icon.size[1]) // 2), icon)

    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)

    master = canvas.resize((1024, 1024), Image.LANCZOS)
    for d in OUT_DIRS:
        master.save(os.path.join(d, "icon-1024.png"))
    for size in SIZES:
        img = canvas.resize((size, size), Image.LANCZOS)
        for d in OUT_DIRS:
            img.save(os.path.join(d, f"icon-{size}.png"))

    ico = canvas.resize((256, 256), Image.LANCZOS)
    for d in OUT_DIRS:
        ico.save(
            os.path.join(d, "favicon.ico"),
            sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
        canvas.resize((180, 180), Image.LANCZOS).save(os.path.join(d, "apple-touch-icon.png"))

    print("ok ->", ", ".join(OUT_DIRS))


if __name__ == "__main__":
    main()
