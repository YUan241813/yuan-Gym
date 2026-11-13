import zipfile, re

z = zipfile.ZipFile("releases/yuan-Gym-1.4.4-sideload.apk")
js = [n for n in z.namelist() if n.startswith("assets/public/assets/") and n.endswith(".js")]
for n in js:
    s = z.read(n).decode("utf-8", "replace")
    if "锻炼前" in s:
        print("===", n, len(s))
        for m in re.finditer("锻炼前", s):
            print("...", s[max(0, m.start() - 700):m.start() + 300].replace("\n", " "))
            print("-----")
        # look for useState defaults
        for key in ["showSkin", "showBones"]:
            i = s.find(key)
            if i >= 0:
                print(key, "ctx:", s[max(0, i - 200):i + 200])
        break
