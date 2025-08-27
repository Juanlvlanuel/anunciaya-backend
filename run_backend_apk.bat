@echo off
REM === Backend DEV para APK (Capacitor) ===
cd /d "%~dp0"
set CORS_ORIGIN=capacitor://localhost,https://localhost,http://localhost,http://192.168.1.71:5173
echo [CORS] %CORS_ORIGIN%
npm run dev
