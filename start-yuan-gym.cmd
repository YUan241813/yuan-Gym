@echo off
REM yuan-Gym — start the account/sync server and the Cloudflare tunnel that publishes it.
REM
REM   server\server.mjs   the app itself + /api (accounts, sync, AI proxy) on 127.0.0.1:8080
REM   cloudflared         exposes that port as https://yuan-gym.yuanzq.top
REM
REM Both run in their own minimised windows; closing this window does not stop them.
REM Logs: server.log / tunnel.log next to this file.

cd /d "%~dp0"

set NODE="C:\Users\张钦源\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set CF="D:\Self-developedSoftware\tools\cloudflared\cloudflared.exe"

echo [%date% %time%] starting server >> server.log
start "yuan-Gym server" /min cmd /c %NODE% server\server.mjs >> server.log 2>&1

echo [%date% %time%] starting tunnel >> tunnel.log
start "yuan-Gym tunnel" /min cmd /c %CF% tunnel run yuangym >> tunnel.log 2>&1

echo.
echo   yuan-Gym is starting.
echo   Local:  http://127.0.0.1:8080
echo   Public: https://yuan-gym.yuanzq.top
echo   Admin:  http://127.0.0.1:8080/admin
echo.
echo   Close this window whenever you like - both keep running.
timeout /t 6 >nul
