@echo off
title FinAnalyzer — Install Windows Scheduler Task
echo.
echo  FinAnalyzer Scheduler Setup
echo  This will register the scan daemon to start automatically on login.
echo.

:: Get the full path to this project directory
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: Find node.exe
for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
if "%NODE_EXE%"=="" (
    echo  [ERROR] Node.js not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo  Node.js found: %NODE_EXE%
echo  Project dir:   %PROJECT_DIR%
echo.

:: Check daemon-config.json exists
if not exist "%PROJECT_DIR%\daemon-config.json" (
    echo  [ERROR] daemon-config.json not found.
    echo  Copy daemon-config.example.json to daemon-config.json and fill in your settings first.
    pause
    exit /b 1
)

:: Delete existing task if it exists
schtasks /delete /tn "FinAnalyzerDaemon" /f >nul 2>&1

:: Create the scheduled task — runs at login, stays running
schtasks /create ^
  /tn "FinAnalyzerDaemon" ^
  /tr "\"%NODE_EXE%\" \"%PROJECT_DIR%\scan-daemon.js\"" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f ^
  /delay 0001:00

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [ERROR] Failed to create scheduled task.
    echo  Try running this script as Administrator (right-click -> Run as administrator)
    pause
    exit /b 1
)

echo.
echo  [OK] Task "FinAnalyzerDaemon" registered successfully.
echo.
echo  The daemon will now:
echo    - Start automatically every time you log into Windows
echo    - Run silently in the background (check Task Manager to confirm)
echo    - Send Telegram alerts and place Alpaca orders per your config
echo.
echo  Useful commands:
echo    start-daemon.bat          - Start manually with a visible window
echo    stop-daemon.bat           - Stop the background daemon
echo    uninstall-scheduler.bat   - Remove the scheduled task
echo.
pause
