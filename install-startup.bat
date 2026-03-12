@echo off
title FinAnalyzer — Install Auto-Start on Login
echo.
echo  Registering FinAnalyzer to start on login...
echo.

set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\FinAnalyzer.bat"

:: Copy start-all.bat into the Startup folder
copy /y "%DIR%\start-all.bat" "%SHORTCUT%" >nul

if %ERRORLEVEL% equ 0 (
    echo  [OK] Auto-start installed.
    echo  Location: %SHORTCUT%
    echo.
    echo  FinAnalyzer will now start automatically every time you log in.
    echo  To remove auto-start, run uninstall-startup.bat
) else (
    echo  [ERROR] Failed to install. Check permissions.
)

echo.
pause
