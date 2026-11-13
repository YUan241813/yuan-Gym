import zipfile, hashlib, os

z = zipfile.ZipFile("releases/yuan-Gym-1.4.4-sideload.apk")
for name in ["ecorche.json", "ecorche.bin", "ecorche-skin.json", "ecorche-skin.bin"]:
    p = "assets/public/models/" + name
    d = os.path.join("app/frontend/dist/models", name)
    old = z.read(p) if p in z.namelist() else None
    new = open(d, "rb").read() if os.path.exists(d) else None
    ho = hashlib.md5(old).hexdigest() if old else "-"
    hn = hashlib.md5(new).hexdigest() if new else "-"
    print("%-20s old=%10s %s  new=%10s %s  %s" % (
        name, len(old) if old else "-", ho, len(new) if new else "-", hn,
        "SAME" if ho == hn else "DIFF"))
