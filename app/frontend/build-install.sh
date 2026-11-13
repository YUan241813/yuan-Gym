#!/bin/sh
# Gradle + install only (dist/ and android assets already synced by build-step2).
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend/android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
export TMP="D:/Self-developedSoftware/yg-tmp"
export TEMP="D:/Self-developedSoftware/yg-tmp"
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
LOG=/d/Self-developedSoftware/yg-tmp/build-install.log
: > "$LOG"

echo "=== gradle assembleSideloadRelease ===" | tee -a "$LOG"
./gradlew --stop --console=plain > /dev/null 2>&1 || true
./gradlew assembleSideloadRelease --console=plain --max-workers=8 >>"$LOG" 2>&1 || true
if ! grep -q "BUILD SUCCESSFUL" "$LOG"; then echo "GRADLE FAILED" | tee -a "$LOG"; exit 1; fi
echo "gradle OK" | tee -a "$LOG"

echo "=== adb install -r ===" | tee -a "$LOG"
"$ADB" kill-server 2>/dev/null; sleep 1; "$ADB" start-server 2>/dev/null; sleep 4
"$ADB" devices -l | tee -a "$LOG"
APK=app/build/outputs/apk/sideload/release/app-sideload-release.apk
"$ADB" install -r "$APK" 2>&1 | tee -a "$LOG" || echo "INSTALL FAILED" | tee -a "$LOG"
"$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | tee -a "$LOG"
echo "DONE" | tee -a "$LOG"
