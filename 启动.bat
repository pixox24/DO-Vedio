@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js not found. Please install Node.js 22+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node scripts/start.mjs %*

echo.
pause
