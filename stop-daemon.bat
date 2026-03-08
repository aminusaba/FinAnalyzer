@echo off
title FinAnalyzer — Stop Daemon
echo.
echo  Stopping FinAnalyzer scan daemon...
echo.

:: Kill any node process running scan-daemon.js
taskkill /f /fi "IMAGENAME eq node.exe" /fi "WINDOWTITLE eq FinAnalyzer*" >nul 2>&1

:: Also find and kill by command line match
for /f "tokens=2" %%i in ('tasklist /fi "IMAGENAME eq node.exe" /fo csv /nh 2^>nul') do (
    wmic process where "ProcessId=%%~i and CommandLine like '%%scan-daemon%%'" delete >nul 2>&1
)

echo  Done. Daemon stopped.
echo  (To stop the scheduled auto-start, run uninstall-scheduler.bat)
echo.
pause
