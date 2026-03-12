@echo off
title FinAnalyzer — Remove Auto-Start
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FinAnalyzer.bat"

del /f "%SHORTCUT%" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] Auto-start removed.
) else (
    echo  [--] Not found (already removed).
)
echo.
pause
