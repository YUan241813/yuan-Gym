import glob, os, json, re

base = "app/frontend"
for d in ["dist", "distbuild", "db4", "db5", "db3d", "dbcheck"]:
    for f in glob.glob(os.path.join(base, d, "assets", "exercises-*.js")):
        s = open(f, encoding="utf-8", errors="replace").read()
        i = s.find("VITE_CLIP_EXT")
        print("==", f, "len", len(s))
        if i >= 0:
            print("   ctx:", s[max(0, i - 60):i + 90])
        j = s.find("exercise-media/clip/")
        print("   clipbase at", j, s[max(0, j - 40):j + 40] if j >= 0 else "")
        # find the mp4/webp decision literal
        for m in re.finditer(r'"\.(mp4|webp)"', s):
            print("   literal", m.group(0), "at", m.start(), "|", s[max(0, m.start() - 70):m.start() + 20])
            break
