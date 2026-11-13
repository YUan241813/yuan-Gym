import sys, os, json
OUT = r"D:\Self-developedSoftware\yuan-Gym\app\frontend\_wc_out.txt"
def log(s):
    with open(OUT, "a", encoding="ascii", errors="replace") as f:
        f.write(s + "\n")
open(OUT, "w").close()
try:
    from PIL import Image
except Exception as e:
    log("PIL_MISSING: %s" % e)
    sys.exit(0)

base = r"D:\Self-developedSoftware\yuan-Gym\app\frontend\dist\exercise-media\clip"
real = sorted([f for f in os.listdir(base) if f.endswith(".webp")])[:8]
for name in real:
    p = os.path.join(base, name)
    try:
        im = Image.open(p)
        n = getattr(im, "n_frames", 1)
        durs = []
        for i in range(n):
            im.seek(i)
            durs.append(im.info.get("duration", 0))
        total = sum(durs)
        fps = (n / (total/1000.0)) if total else 0
        log("file=%s frames=%d total_ms=%d fps=%.2f first_ms=%d size=%s" % (name, n, total, fps, durs[0] if durs else 0, im.size))
    except Exception as e:
        log("file=%s ERROR %s" % (name, e))
