@echo off
setlocal
cd /d "%~dp0"
title PageDock

if not exist node_modules (
  echo [PageDock] Installing developer packages...
  call npm.cmd install
  if errorlevel 1 goto :error
)

echo [PageDock] Building the web application...
call npm.cmd run build
if errorlevel 1 goto :error

echo [PageDock] Starting at http://localhost:3000
call npm.cmd run start
goto :eof

:error
echo.
echo PageDock could not start. Review the message above.
pause
exit /b 1
