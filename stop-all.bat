@echo off
set LOCK=%~dp0finanalyzer.lock

echo Stopping FinAnalyzer...

:: 1. Stop daemon via lock file PID (most reliable)
if exist "%LOCK%" (
    set /p DAEMON_PID=<"%LOCK%"
    taskkill /F /PID %DAEMON_PID% >nul 2>&1
    del /F /Q "%LOCK%" >nul 2>&1
    echo  [OK] Daemon stopped.
) else (
    echo  [--] No lock file — daemon may not be running.
)

:: 2. Kill any remaining node process running scan-daemon.js (fallback)
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*scan-daemon*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

:: 3. Kill Vite dev server (node process with vite in command line)
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*vite*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
echo  [OK] UI stopped.

:: 4. Stop Alpaca MCP server
taskkill /F /IM "alpaca-mcp-server.exe" >nul 2>&1
echo  [OK] MCP server stopped.

echo Done.
