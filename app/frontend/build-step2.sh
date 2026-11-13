#!/bin/sh
# Stage 2: assumes `vite build` already produced dist/ (lean public). Injects AGPL source zip,
# stages 16f media, syncs to android assets, builds sideload release APK, installs to phone.
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
NODE="C:/Users/张钦源/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
WEBP16=D:/Self-developedSoftware/tools/media/anim-webp-v2-16f
SRCZIP=/d/Self-developedSoftware/yg-tmp/source-hold/source/yuan-Gym-source.zip
LOG=/d/Self-developedSoftware/yg-tmp/build-step2.log
: > "$LOG"

echo "=== [1/5] inject AGPL source zip into dist ===" | tee -a "$LOG"
mkdir -p dist/source
if [ -f "$SRCZIP" ]; then cp "$SRCZIP" dist/source/yuan-Gym-source.zip && echo "source zip injected" | tee -a "$LOG"; else echo "WARN: no source zip" | tee -a "$LOG"; fi

echo "=== [2/5] stage-media 16f ===" | tee -a "$LOG"
if ! APP_MEDIA_DIR="$WEBP16" "$NODE" ../scripts/catalogue/stage-media.mjs dist >>"$LOG" 2>&1; then echo "STAGE-MEDIA FAILED" | tee -a "$LOG"; exit 1; fi
echo "stage-media OK" | tee -a "$LOG"

echo "=== [3/5] syncpub ===" | tee -a "$LOG"
if ! "$NODE" syncpub.mjs >>"$LOG" 2>&1; then echo "SYNCPUB FAILED" | tee -a "$LOG"; exit 1; fi
echo "syncpub OK" | tee -a "$LOG"

echo "=== [4/5] gradle assembleSideloadRelease ===" | tee -a "$LOG"
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

echo "=== [5/5] adb install -r ===" | tee -a "$LOG"
"$ADB" kill-server 2>/dev/null; sleep 1; "$ADB" start-server 2>/dev/null; sleep 4
"$ADB" devices -l | tee -a "$LOG"
APK=android/app/build/outputs/apk/sideload/release/app-sideload-release.apk
"$ADB" install -r "$APK" 2>&1 | tee -a "$LOG" || echo "INSTALL FAILED" | tee -a "$LOG"
"$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | tee -a "$LOG"
echo "STAGE2 DONE" | tee -a "$LOG"
