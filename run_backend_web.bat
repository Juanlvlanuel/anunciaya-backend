@echo off
REM === Backend DEV (navegador/cel con Vite) ===
cd /d "%~dp0"
set CORS_ORIGIN=http://192.168.1.71:5173
echo [CORS] %CORS_ORIGIN%
npm run dev
