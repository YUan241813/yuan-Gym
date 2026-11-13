#!/bin/sh
# 1.4.10 构建 + 装机（正式版 sideloadRelease）。
# 只修一件事：BodyModel3D 漏了解构 `lang` prop，导致渲染期 ReferenceError，
# 错误边界把「探索肌肉 / 按肌肉」整页替换成「出了点问题」——用户反馈「建模打不开」。
# 版本号 1.4.10 / versionCode 37。
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe

echo "=== [1/4] vite build $(date +%H:%M:%S) ==="
VITE_MOBILE=1 VITE_CLIP_EXT=webp npx vite build

echo "=== [2/4] bundle 校验 + 增量同步到 android assets $(date +%H:%M:%S) ==="
node scripts/check-mobile-bundle.mjs
node syncpub.mjs

echo "=== [3/4] gradle assembleSideloadRelease $(date +%H:%M:%S) ==="
cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
export TMP="D:/Self-developedSoftware/yg-tmp"
export TEMP="D:/Self-developedSoftware/yg-tmp"
mkdir -p /d/Self-developedSoftware/yg-tmp
./gradlew --stop --console=plain > /dev/null 2>&1 || true
./gradlew assembleSideloadRelease --console=plain --max-workers=8 > ../gradle-1410.log 2>&1
tail -8 ../gradle-1410.log

echo "=== [4/4] 安装 + 校验 $(date +%H:%M:%S) ==="
if grep -q "BUILD SUCCESSFUL" ../gradle-1410.log; then
  cd app/build/outputs/apk/sideload/release
  "$ADB" install -r app-sideload-release.apk 2>&1
  "$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|lastUpdateTime" | head -3
else
  echo "BUILD FAILED —— 见 gradle-1410.log"
  exit 1
fi
echo "=== 完成 $(date +%H:%M:%S) ==="
