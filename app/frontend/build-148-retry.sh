#!/bin/sh
# 1.4.8 重试：上一轮 gradle 的 compressSideloadReleaseAssets 失败。
# 根因：常驻 Gradle daemon 的 java.io.tmpdir 落到 C:\WINDOWS（系统目录，普通权限不可写），
# AGP 压缩 assets 时 File.createTempFile 直接抛 Access denied。
# 修法：gradle.properties 里 -Djava.io.tmpdir 钉到 D:/Self-developedSoftware/yg-tmp，
# 再 --stop 清掉所有旧 daemon，让新 daemon 用正确 tmpdir 启动。
# vite build / bundle 校验 / syncpub 上一轮都已成功，这里只重跑 gradle + 装机。
set -e
export PATH="/c/Program Files/Git/usr/bin:/c/Program Files/Git/bin:$PATH"
cd /d/Self-developedSoftware/yuan-Gym/app/frontend
ADB=/d/Self-developedSoftware/tools/Android/platform-tools/adb.exe
YG_TMP="D:/Self-developedSoftware/yg-tmp"
mkdir -p /d/Self-developedSoftware/yg-tmp

cd android
export JAVA_HOME="D:\\Self-developedSoftware\\tools\\jdk\\jdk-21.0.2"
export ANDROID_HOME="D:\\Self-developedSoftware\\tools\\Android"
export ANDROID_SDK_ROOT="D:\\Self-developedSoftware\\tools\\Android"
# Java 在 Windows 上从 TMP/TEMP 推导 java.io.tmpdir；钉成可写的 D 盘目录，双保险。
export TMP="$YG_TMP"
export TEMP="$YG_TMP"

echo "=== [1/3] 停掉旧 daemon $(date +%H:%M:%S) ==="
./gradlew --stop --console=plain 2>&1 | tail -5

echo "=== [2/3] 重新打包 $(date +%H:%M:%S) ==="
./gradlew assembleSideloadRelease --console=plain --max-workers=8 > ../gradle-148-retry.log 2>&1
tail -6 ../gradle-148-retry.log

echo "=== [3/3] 安装到手机 $(date +%H:%M:%S) ==="
if grep -q "BUILD SUCCESSFUL" ../gradle-148-retry.log; then
  cd app/build/outputs/apk/sideload/release
  "$ADB" install -r app-sideload-release.apk 2>&1
  "$ADB" shell dumpsys package ch.duartesantos.opengym 2>/dev/null | grep -E "versionName|versionCode|lastUpdateTime" | head -3
else
  echo "BUILD FAILED —— 见 gradle-148-retry.log"
  exit 1
fi
echo "=== 完成 $(date +%H:%M:%S) ==="
