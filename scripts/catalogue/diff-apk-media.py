import zipfile, collections, sys

old = "releases/yuan-Gym-1.4.4-sideload.apk"
new = "releases/yuan-Gym-1.4.5-sideload.apk"


def stats(p):
    z = zipfile.ZipFile(p)
    names = [n for n in z.namelist() if n.startswith("assets/public/")]
    media = [n for n in names if "/exercise-media/" in n]
    d = collections.Counter()
    for n in media:
        parts = n.split("/")
        i = parts.index("exercise-media")
        d["/".join(parts[i + 1:i + 2])] += 1
    return z, names, media, d


zo, no, mo, do = stats(old)
zn, nn, mn, dn = stats(new)
print("OLD entries", len(no), "media", len(mo), dict(do))
print("NEW entries", len(nn), "media", len(mn), dict(dn))
so, sn = set(mo), set(mn)
print("only in old media:", len(so - sn))
for x in sorted(so - sn)[:5]:
    i = zo.getinfo(x)
    print("  O", x, i.file_size, i.compress_type)
print("only in new media:", len(sn - so))
for x in sorted(sn - so)[:5]:
    i = zn.getinfo(x)
    print("  N", x, i.file_size, i.compress_type)
common = sorted(so & sn)
print("common media:", len(common))
for x in common[:5]:
    a, b = zo.getinfo(x), zn.getinfo(x)
    print("  C", x, "old", a.file_size, a.compress_type, "new", b.file_size, b.compress_type)
# byte-identical check on sample
same = diff = 0
import hashlib
for x in common[:400]:
    ha = hashlib.md5(zo.read(x)).hexdigest()
    hb = hashlib.md5(zn.read(x)).hexdigest()
    if ha == hb:
        same += 1
    else:
        diff += 1
print("sample400 identical:", same, "different:", diff)
