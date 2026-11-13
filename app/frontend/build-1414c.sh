#!/bin/sh
# 1.4.14 重建（仅媒体/打包/装机尾段）：用 16帧减帧库正确 stage 进 dist，再 syncpub→gradle→adb。
# 复用上一轮已编译好的 dist JS（src 未变），只重做 media 注入与打包。
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
NODE="C:/Users/张钦源/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
WEBP16=D:/Self-developedSoftware/tools/media/anim-webp-v2-16f
LOG=/d/Self-developedSoftware/yg-tmp/build-1414c.log
: > "$LOG"

echo "=== [1/5] stage-media (16帧剪辑库, 正确路径+APP_MEDIA_DIR) ===" | tee -a "$LOG"
export VITE_CLIP_EXT=webp
APP_MEDIA_DIR="$WEBP16" "$NODE" ../scripts/catalogue/stage-media.mjs dist 2>&1 | tee -a "$LOG"

echo "=== [2/5] syncpub ===" | tee -a "$LOG"
"$NODE" syncpub.mjs 2>&1 | tee -a "$LOG"

echo "=== [3/5] check-mobile-bundle ===" | tee -a "$LOG"
"$NODE" scripts/check-mobile-bundle.mjs 2>&1 | tee -a "$LOG"

echo "=== [4/5] gradle assembleSideloadRelease ===" | tee -a "$LOG"
cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
export TMP="D:/Self-developedSoftware/yg-tmp"
export TEMP="D:/Self-developedSoftware/yg-tmp"
./gradlew --stop --console=plain > /dev/null 2>&1 || true
./gradlew assembleSideloadRelease --console=plain --max-workers=8 2>&1 | tee -a "$LOG"
if ! grep -q "BUILD SUCCESSFUL" "$LOG"; then echo "GRADLE FAILED" | tee -a "$LOG"; exit 1; fi
cd ..

echo "=== [5/5] adb install -r + verify ===" | tee -a "$LOG"
APK=android/app/build/outputs/apk/sideload/release/app-sideload-release.apk
"$ADB" install -r "$APK" 2>&1 | tee -a "$LOG"
"$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | head | tee -a "$LOG"
echo "BUILD+INSTALL DONE" | tee -a "$LOG"
