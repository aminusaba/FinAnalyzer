@echo off
title FinAnalyzer Scan Daemon
echo.
echo  FinAnalyzer Scan Daemon
echo  Runs market scans in background — no browser needed
echo.

if not exist daemon-config.json (
    echo  [ERROR] daemon-config.json not found.
    echo  Copy daemon-config.example.json to daemon-config.json and fill in your settings.
    echo.
    pause
    exit /b 1
)

node scan-daemon.js
pause
