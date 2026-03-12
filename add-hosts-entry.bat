@echo off
:: Run as Administrator to add finanalyzer → 127.0.0.1 to Windows hosts file
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo This script needs to run as Administrator.
    echo Right-click add-hosts-entry.bat and choose "Run as administrator".
    pause
    exit /b 1
)

findstr /c:"finanalyzer" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>&1
if %errorlevel% equ 0 (
    echo  [OK] hosts entry already exists.
) else (
    echo 127.0.0.1   finanalyzer >> "%SystemRoot%\System32\drivers\etc\hosts"
    echo  [OK] Added: 127.0.0.1  finanalyzer
)
echo.
echo  You can now access FinAnalyzer at: http://finanalyzer/
echo.
pause
