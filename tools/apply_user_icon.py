"""Apply the user's own artwork as the app icon everywhere, black corners removed.

Source of truth: design/icons/icon-1024.png (the blue-haired lifter illustration the
user supplied). The original screenshot had a black frame around the rounded square;
`cut_corners()` flood-fills that from the four corners and makes it transparent.

Run after replacing the master artwork, or on its own:

    python tools/apply_user_icon.py

It writes:
  * design/icons/icon-*.png, favicon.ico, apple-touch-icon.png (regenerated sizes)
  * app/frontend/public/icon-*.png, favicon.ico, apple-touch-icon.png (web/PWA)
  * android/.../mipmap-*/ic_launcher{,_round,_foreground,_background}.png (default launcher)
  * values/ic_launcher_background.xml + the two legacy vector drawables (no green dumbbell)

The nine *alternate* launcher variants are owned by scripts/app-icons.mjs; run
`node scripts/app-icons.mjs` after this so they all use the same cleaned master.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, 'app', 'frontend')
MASTER = os.path.join(ROOT, 'design', 'icons', 'icon-1024.png')
RES = os.path.join(FRONTEND, 'android', 'app', 'src', 'main', 'res')

SIZES = [512, 384, 256, 192, 180, 152, 144, 128, 120, 96, 72, 64, 48, 32]
DENSITIES = {'ldpi': 0.75, 'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
BG = (14, 32, 56, 255)          # #0E2038, sampled from the artwork's own dark blue


def cut_corners(src: Image.Image) -> Image.Image:
    """Flood-fill the near-black frame from the four corners, make it transparent."""
    rgb = src.convert('RGB')
    w, h = rgb.size
    work = rgb.copy()
    marker = (255, 0, 255)
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(work, xy, marker, thresh=45)
    px = work.load()
    out = rgb.convert('RGBA')
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == marker:
                opx[x, y] = (0, 0, 0, 0)
    alpha = out.split()[3].filter(ImageFilter.GaussianBlur(0.8))
    alpha = alpha.point(lambda v: 255 if v > 178 else (0 if v < 78 else v))
    out.putalpha(alpha)
    return out


def square(icon: Image.Image, side: int, round_: bool = False) -> Image.Image:
    """The artwork centred on a dark-blue ground; round_ cuts a circular mask."""
    art = icon.resize((side, side), Image.LANCZOS)
    canvas = Image.new('RGBA', (side, side), BG if not round_ else (14, 32, 56, 0))
    canvas.alpha_composite(art)
    if not round_:
        return canvas.convert('RGB')
    big = side * 4
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel('A'), mask))
    return canvas


def main() -> None:
    icon = cut_corners(Image.open(MASTER))
    side = max(icon.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(icon, ((side - icon.size[0]) // 2, (side - icon.size[1]) // 2), icon)

    # 1. Cleaned master + the standard web/PWA sizes, in both directories.
    master = canvas.resize((1024, 1024), Image.LANCZOS)
    for d in [os.path.join(ROOT, 'design', 'icons'), os.path.join(FRONTEND, 'public')]:
        os.makedirs(d, exist_ok=True)
        master.save(os.path.join(d, 'icon-1024.png'))
        for s in SIZES:
            canvas.resize((s, s), Image.LANCZOS).save(os.path.join(d, f'icon-{s}.png'))
        canvas.resize((256, 256), Image.LANCZOS).save(
            os.path.join(d, 'favicon.ico'),
            sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        canvas.resize((180, 180), Image.LANCZOS).save(os.path.join(d, 'apple-touch-icon.png'))

    # 2. The default Android launcher (the green dumbbell lived here). Adaptive XML already
    #    points at @mipmap/ic_launcher_foreground / _background, so only the PNGs need swapping.
    written = []
    for dpi, f in DENSITIES.items():
        d = os.path.join(RES, f'mipmap-{dpi}')
        os.makedirs(d, exist_ok=True)
        legacy = round(48 * f)
        adaptive = round(108 * f)
        square(master, legacy).save(os.path.join(d, 'ic_launcher.png'))
        square(master, legacy, round_=True).save(os.path.join(d, 'ic_launcher_round.png'))
        square(master, adaptive).save(os.path.join(d, 'ic_launcher_foreground.png'))
        Image.new('RGB', (adaptive, adaptive), (14, 32, 56)).save(
            os.path.join(d, 'ic_launcher_background.png'))
        written.append(f'{dpi}: {legacy}px / {adaptive}px')

    # 3. Colours + legacy vector drawables: no green, no dumbbell glyph.
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as fh:
        fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                 '    <color name="ic_launcher_background">#0E2038</color>\n</resources>\n')

    solid = ('<?xml version="1.0" encoding="utf-8"?>\n'
             '<!-- Replaced by tools/apply_user_icon.py: the launcher uses the user illustration. -->\n'
             '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
             '    android:width="108dp" android:height="108dp"\n'
             '    android:viewportWidth="108" android:viewportHeight="108">\n'
             '    <path android:fillColor="#0E2038"\n'
             '        android:pathData="M0,0h108v108h-108z" />\n'
             '</vector>\n')
    for rel in ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']:
        p = os.path.join(RES, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as fh:
            fh.write(solid)

    corners = [master.getchannel('A').getpixel(p) for p in
               [(0, 0), (1023, 0), (0, 1023), (1023, 1023)]]
    print('master corners alpha:', corners, '(0 = black frame removed)')
    print('web/PWA sizes:', ', '.join(str(s) for s in SIZES))
    print('android densities:', ', '.join(written))
    print('ok -> default launcher is now the user artwork on #0E2038')


if __name__ == '__main__':
    main()
