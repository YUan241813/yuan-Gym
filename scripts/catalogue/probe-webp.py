import zipfile, io, os, sys
from PIL import Image

old = "releases/yuan-Gym-1.4.4-sideload.apk"
new = "releases/yuan-Gym-1.4.5-sideload.apk"
zo = zipfile.ZipFile(old)
zn = zipfile.ZipFile(new)

samples = ["clip/0004.webp", "clip/0122.webp", "clip/0144.webp", "clip/0001.webp", "still/0004.webp"]


def probe(blob, tag):
    try:
        im = Image.open(io.BytesIO(blob))
        n = getattr(im, "n_frames", 1)
        return f"{tag}: ok fmt={im.format} size={im.size} frames={n} dur={im.info.get('duration')}"
    except Exception as e:
        return f"{tag}: FAIL {type(e).__name__}: {e}"


for s in samples:
    p = "assets/public/exercise-media/" + s
    print("---", s)
    if p in zo.namelist():
        b = zo.read(p)
        print("  apk1.4.4", len(b), probe(b, "img"))
    else:
        print("  apk1.4.4: absent")
    if p in zn.namelist():
        b = zn.read(p)
        print("  apk1.4.5", len(b), probe(b, "img"))
    else:
        print("  apk1.4.5: absent")
    d = "app/frontend/dist/exercise-media/" + s
    if os.path.exists(d):
        b = open(d, "rb").read()
        print("  dist    ", len(b), probe(b, "img"))
