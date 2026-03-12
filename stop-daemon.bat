@echo off
title FinAnalyzer — Stop Daemon
echo.
echo  Stopping FinAnalyzer scan daemon...
echo.

set LOCK=%~dp0finanalyzer.lock

:: Primary: kill via PID in lock file
if exist "%LOCK%" (
    set /p DAEMON_PID=<"%LOCK%"
    taskkill /F /PID %DAEMON_PID% >nul 2>&1
    del /F /Q "%LOCK%" >nul 2>&1
    echo  Daemon stopped (PID %DAEMON_PID%).
) else (
    echo  No lock file found — trying fallback...
    powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*scan-daemon*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
    echo  Fallback kill attempted.
)

echo.
echo  (To stop the scheduled auto-start, run uninstall-scheduler.bat)
echo.
pause
