#!/bin/sh
# 1.4.14 构建 + 装机（正式版 sideloadRelease）
#
# 与 1.4.10 脚本的唯一结构性差异：前置 [0/5] pack:source。
# 本轮改了 19 个 locale、MuscleExplorer.jsx 与多个测试夹具/断言，
# 随 APK 分发的 AGPL 对应源码包（public/source/yuan-Gym-source.zip）
# 还停在 11-13 09:30，必须与二进制一致（GNU AGPL v3 §6）。
#
# 媒体说明：vite build 会清空 dist/（vite.config.js 未设 emptyOutDir），
# 但 syncpub.mjs 只增量复制、只清 assets/ 下旧 JS chunk，不动
# android/app/src/main/assets/public/exercise-media/ 的 7282 个 WebP，
# 故无需重跑 stage-media（那份需 anim-webp-v2 库且要重拷 634MB）。
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
NODE="C:/Users/张钦源/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"

echo "=== [0/5] pack:source — 重建 AGPL 对应源码 $(date +%H:%M:%S) ==="
"$NODE" scripts/pack-source.mjs
stat -c '  public/source zip: %s bytes  %y' public/source/yuan-Gym-source.zip

echo "=== [1/5] vite build $(date +%H:%M:%S) ==="
VITE_MOBILE=1 VITE_CLIP_EXT=webp npx vite build

echo "=== [2/5] bundle 校验 + 增量同步到 android assets $(date +%H:%M:%S) ==="
"$NODE" scripts/check-mobile-bundle.mjs
"$NODE" syncpub.mjs
echo "--- 源码包三处一致性 ---"
stat -c '  public/ : %s bytes  %y' public/source/yuan-Gym-source.zip
stat -c '  dist/   : %s bytes  %y' dist/source/yuan-Gym-source.zip
stat -c '  assets/ : %s bytes  %y' android/app/src/main/assets/public/source/yuan-Gym-source.zip
echo "--- 媒体计数（APK assets 应仍是 7282）---"
find android/app/src/main/assets/public -name '*.webp' | wc -l

echo "=== [3/5] gradle assembleSideloadRelease $(date +%H:%M:%S) ==="
cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
export TMP="D:/Self-developedSoftware/yg-tmp"
export TEMP="D:/Self-developedSoftware/yg-tmp"
mkdir -p /d/Self-developedSoftware/yg-tmp
./gradlew --stop --console=plain > /dev/null 2>&1 || true
./gradlew assembleSideloadRelease --console=plain --max-workers=8 > ../gradle-1414.log 2>&1
tail -8 ../gradle-1414.log

echo "=== [4/5] 安装 + 真机校验 $(date +%H:%M:%S) ==="
if grep -q "BUILD SUCCESSFUL" ../gradle-1414.log; then
  cd app/build/outputs/apk/sideload/release
  ls -l app-sideload-release.apk
  "$ADB" install -r app-sideload-release.apk 2>&1
  echo "--- dumpsys ---"
  "$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|lastUpdateTime" | head -3
else
  echo "BUILD FAILED —— 见 gradle-1414.log"
  tail -40 ../gradle-1414.log
  exit 1
fi
echo "=== 完成 $(date +%H:%M:%S) ==="
