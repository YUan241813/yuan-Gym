import zipfile, re, os, glob

z = zipfile.ZipFile("releases/yuan-Gym-1.4.4-sideload.apk")
js = [n for n in z.namelist() if n.startswith("assets/public/assets/") and n.endswith(".js")]
print("js chunks in 1.4.4:", len(js))
hits = []
for n in js:
    s = z.read(n).decode("utf-8", "replace")
    if "bodymap3d" in s:
        hits.append((n, s))
print("chunks mentioning bodymap3d:", [h[0] for h in hits])
for n, s in hits:
    i = s.find("bodymap3d")
    print("=== ", n)
    print(s[max(0, i - 1500):i + 2500])
