#!/bin/sh
# Full rebuild after source changes (F-3 widget deep-link rebrand + cloud dead-code removal).
# Fixes build-1414b's two bugs: stage-media path (../scripts/catalogue) and APP_MEDIA_DIR env
# (not --webp-dir). Uses exit-status checks (not tee-masked) for the critical steps.
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
NODE="C:/Users/张钦源/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
WEBP16=D:/Self-developedSoftware/tools/media/anim-webp-v2-16f
LOG=/d/Self-developedSoftware/yg-tmp/build-1414d.log
mkdir -p /d/Self-developedSoftware/yg-tmp
: > "$LOG"

echo "=== [1/7] pack:source (non-fatal) ===" | tee -a "$LOG"
"$NODE" scripts/pack-source.mjs >>"$LOG" 2>&1 || echo "PACK-SOURCE WARN (continue)" | tee -a "$LOG"

echo "=== [2/7] vite build (mobile + webp) ===" | tee -a "$LOG"
export VITE_MOBILE=1
export VITE_CLIP_EXT=webp
if ! "$NODE" node_modules/vite/bin/vite.js build >>"$LOG" 2>&1; then echo "VITE BUILD FAILED" | tee -a "$LOG"; exit 1; fi
echo "vite build OK" | tee -a "$LOG"

echo "=== [3/7] stage-media (16f via APP_MEDIA_DIR) ===" | tee -a "$LOG"
if ! APP_MEDIA_DIR="$WEBP16" "$NODE" ../scripts/catalogue/stage-media.mjs dist >>"$LOG" 2>&1; then echo "STAGE-MEDIA FAILED" | tee -a "$LOG"; exit 1; fi
echo "stage-media OK" | tee -a "$LOG"

echo "=== [4/7] syncpub ===" | tee -a "$LOG"
if ! "$NODE" syncpub.mjs >>"$LOG" 2>&1; then echo "SYNCPUB FAILED" | tee -a "$LOG"; exit 1; fi
echo "syncpub OK" | tee -a "$LOG"

echo "=== [5/7] check-mobile-bundle ===" | tee -a "$LOG"
if ! "$NODE" scripts/check-mobile-bundle.mjs >>"$LOG" 2>&1; then echo "CHECK-BUNDLE WARN (see log)" | tee -a "$LOG"; fi

echo "=== [6/7] gradle assembleSideloadRelease ===" | tee -a "$LOG"
cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
export TMP="D:/Self-developedSoftware/yg-tmp"
export TEMP="D:/Self-developedSoftware/yg-tmp"
./gradlew --stop --console=plain > /dev/null 2>&1 || true
./gradlew assembleSideloadRelease --console=plain --max-workers=8 >>"$LOG" 2>&1 || true
if ! grep -q "BUILD SUCCESSFUL" "$LOG"; then echo "GRADLE FAILED" | tee -a "$LOG"; exit 1; fi
echo "gradle OK" | tee -a "$LOG"
cd ..

echo "=== [7/7] adb install -r + verify ===" | tee -a "$LOG"
APK=android/app/build/outputs/apk/sideload/release/app-sideload-release.apk
"$ADB" install -r "$APK" 2>&1 | tee -a "$LOG" || echo "ADB INSTALL FAILED (phone connected?)" | tee -a "$LOG"
"$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | head | tee -a "$LOG"
echo "BUILD+INSTALL DONE" | tee -a "$LOG"
