@echo off
title Armenia O&M Reporting
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed or Windows has not detected it yet.
  echo Install the LTS version from https://nodejs.org/en/download
  echo Then restart the computer and run START_APP.bat again.
  echo.
  pause
  exit /b 1
)

if exist "dist\server\index.js" (
  echo.
  echo Starting the prebuilt Armenia O&M Reporting...
  echo Keep this window open while using the app.
  echo.
  node windows-server.mjs
) else (
  echo.
  echo Preparing the Armenia O&M Reporting source package...
  if not exist "node_modules" call npm install
  if errorlevel 1 goto :failed
  call npm run dev
)

if errorlevel 1 (
:failed
  echo.
  echo The app could not start. Please take a screenshot of this window.
)
pause
