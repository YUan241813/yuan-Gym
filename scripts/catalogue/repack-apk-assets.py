"""在已签名的旧 APK 上原地换掉网页资源包（assets/public），不跑 Gradle。

背景：这台机器上 Gradle 会因为 maven 网络与沙箱文件锁反复卡死。本轮改动全部落在
前端产物（dist/）里——JS bundle、三维皮肤资产、6554 个动作动画——安卓侧的 Java 代码
一行没动，所以完全可以拿上一个已构建好的 APK 做「只换资源」的重打包。

做法：
  1. 逐个搬运旧 APK 的条目，跳过 assets/public/* 和旧签名（META-INF 里的 v1 签名）
  2. 把 dist/ 整个装进 assets/public/（webp 用 STORED，本身已压缩，省时间也省 CPU）
  3. 之后由 zipalign + apksigner 重新对齐签名
"""
import os
import sys
import zipfile

SRC = sys.argv[1]
DST = sys.argv[2]
DIST = sys.argv[3]

SKIP_PREFIX = 'assets/public/'
# 已经压缩过的后缀：直接 STORED，避免白跑 deflate（6554 个 webp 会慢十分钟）
STORED_EXT = ('.webp', '.png', '.jpg', '.jpeg', '.gif', '.woff', '.woff2', '.zip', '.mp3', '.mp4')

kept = dropped = added = 0
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zout:
    for info in zin.infolist():
        name = info.filename
        if name.startswith(SKIP_PREFIX):
            dropped += 1
            continue
        if name.startswith('META-INF/') and (
            name.endswith('.RSA') or name.endswith('.SF') or name.endswith('MANIFEST.MF')
        ):
            dropped += 1
            continue
        data = zin.read(name)
        zout.writestr(info, data, compress_type=info.compress_type)
        kept += 1
    print(f'保留 {kept} 个条目，丢弃 {dropped} 个（旧网页资源 + 旧签名）', flush=True)

    for root, _dirs, files in os.walk(DIST):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, DIST).replace('\\', '/')
            zi = zipfile.ZipInfo(SKIP_PREFIX + rel, date_time=(2026, 11, 10, 23, 0, 0))
            zi.compress_type = zipfile.ZIP_STORED if f.lower().endswith(STORED_EXT) else zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(full, 'rb') as fh:
                zout.writestr(zi, fh.read())
            added += 1
            if added % 2000 == 0:
                print(f'  已加入 {added} 个文件…', flush=True)

print(f'新增 {added} 个网页资源', flush=True)
print('完成：' + DST, flush=True)
