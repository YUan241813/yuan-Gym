import zipfile, io, os
from PIL import Image, ImageChops

new = "releases/yuan-Gym-1.4.5-sideload.apk"
old = "releases/yuan-Gym-1.4.4-sideload.apk"
zn = zipfile.ZipFile(new)
zo = zipfile.ZipFile(old)


def motion(im):
    frames = []
    n = getattr(im, "n_frames", 1)
    for i in range(n):
        im.seek(i)
        frames.append(im.convert("RGB").copy())
    if len(frames) < 2:
        return 0, 0, len(frames)
    d = ImageChops.difference(frames[0], frames[len(frames) // 2])
    px = list(d.getdata())
    mean = sum(sum(p) / 3 for p in px) / len(px)
    mx = max(max(p) for p in px)
    return mean, mx, len(frames)


targets = ["0004", "0122", "0144", "0001", "0025", "2476", "2000", "3000"]
for t in targets:
    p = "assets/public/exercise-media/clip/%s.webp" % t
    line = t + "  "
    if p in zo.namelist():
        b = zo.read(p)
        im = Image.open(io.BytesIO(b))
        m, mx, n = motion(im)
        line += "OLD n=%d motion=%.2f max=%d | " % (n, m, mx)
    else:
        line += "OLD absent | "
    if p in zn.namelist():
        b = zn.read(p)
        im = Image.open(io.BytesIO(b))
        m, mx, n = motion(im)
        line += "NEW n=%d motion=%.2f max=%d" % (n, m, mx)
        im.seek(0)
        rgb = im.convert("RGB")
        # brightness of frame 0 to detect all-black
        px = list(rgb.getdata())
        avg = sum(sum(q) / 3 for q in px) / len(px)
        line += " avgLum=%.0f" % avg
    else:
        line += "NEW absent"
    print(line)

# also scan 200 new clips for zero-motion
import random
names = [n for n in zn.namelist() if "/clip/" in n]
random.seed(7)
sample = random.sample(names, 150)
zero = 0
tot = 0
vals = []
for p in sample:
    im = Image.open(io.BytesIO(zn.read(p)))
    m, mx, n = motion(im)
    vals.append((m, p, n))
    if m < 1.0:
        zero += 1
    tot += 1
vals.sort()
print("\nsample %d clips: nearly-static %d" % (tot, zero))
print("lowest 8:")
for v in vals[:8]:
    print("  %.3f %s frames=%d" % v)
