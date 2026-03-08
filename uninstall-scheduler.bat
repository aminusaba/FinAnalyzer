@echo off
title FinAnalyzer — Uninstall Scheduler Task
echo.
echo  Removing FinAnalyzer scheduled task...
echo.

schtasks /delete /tn "FinAnalyzerDaemon" /f

if %ERRORLEVEL% equ 0 (
    echo  [OK] Scheduled task removed. Daemon will no longer start on login.
) else (
    echo  [INFO] Task was not found (already removed).
)

echo.
pause
