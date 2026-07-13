@echo off
setlocal
cd /d "%~dp0"
title Annot

if not exist node_modules (
  echo [Annot] Installing required packages...
  call npm.cmd install
  if errorlevel 1 goto :error
)

echo [Annot] Updating the optimized build...
call npm.cmd run build
if errorlevel 1 goto :error

echo [Annot] Starting at http://localhost:3000
call npm.cmd run start
goto :eof

:error
echo.
echo Annot could not start. Review the message above.
pause
exit /b 1
