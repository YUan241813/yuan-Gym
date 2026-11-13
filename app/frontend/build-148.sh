#!/bin/sh
# 1.4.8 统一构建 + 装机（正式版 sideloadRelease）。
# 提速要点：不清空 dist 媒体、用 syncpub.mjs 增量复制避免刷新 7472 个媒体 mtime，
# 并在构建前用 Node 一次性删掉 release 的陈旧中间产物，跳过 Gradle 逐文件删除（10 个/秒）。
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
NODE="C:/Users/张钦源/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe

echo "=== [1/5] vite build $(date +%H:%M:%S) ==="
VITE_MOBILE=1 VITE_CLIP_EXT=webp npx vite build

echo "=== [2/5] 校验 bundle $(date +%H:%M:%S) ==="
node scripts/check-mobile-bundle.mjs

echo "=== [3/5] 增量同步 dist -> assets/public $(date +%H:%M:%S) ==="
node syncpub.mjs

echo "=== [4/5] 增量构建（不删中间产物） $(date +%H:%M:%S) ==="
# 上一版 00:02 已用同一份 dist 成功构建，release 的 assets/ 与 compressed_assets/ 都是新的；
# syncpub.mjs 只更新少数改名的 JS chunk，Gradle 增量合并即可。
# 若观察到 merge/compress 又开始逐文件删几千个旧文件（约 10 个/秒），再执行
#   "$NODE" _nuke_release.cjs  并重启构建。

echo "=== [5/5] gradle + 安装 $(date +%H:%M:%S) ==="
cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
./gradlew assembleSideloadRelease --console=plain --max-workers=8 > ../gradle-148.log 2>&1
tail -6 ../gradle-148.log
if grep -q "BUILD SUCCESSFUL" ../gradle-148.log; then
  cd app/build/outputs/apk/sideload/release
  "$ADB" install -r app-sideload-release.apk 2>&1
  "$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode" | head -2
fi
echo "=== 完成 $(date +%H:%M:%S) ==="
