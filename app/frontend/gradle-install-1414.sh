#!/bin/sh
# 1.4.14 Gradle 打包 + 装机（前半段 pack:source / vite build / check / syncpub 已完成）
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe

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
  stat -c 'APK: %s bytes  %y' app-sideload-release.apk
  "$ADB" install -r app-sideload-release.apk 2>&1
  echo "--- dumpsys ---"
  "$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|lastUpdateTime" | head -3
else
  echo "BUILD FAILED —— 见 gradle-1414.log"
  tail -40 ../gradle-1414.log
  exit 1
fi
echo "=== 完成 $(date +%H:%M:%S) ==="
