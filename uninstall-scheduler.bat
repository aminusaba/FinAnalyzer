@echo off
title FinAnalyzer — Uninstall Scheduler Tasks
echo.
echo  Removing all FinAnalyzer scheduled tasks...
echo.

schtasks /delete /tn "FinAnalyzerDaemon" /f >nul 2>&1
if %ERRORLEVEL% equ 0 (echo  [OK] FinAnalyzerDaemon removed.) else (echo  [--] FinAnalyzerDaemon not found.)

schtasks /delete /tn "FinAnalyzerMCP" /f >nul 2>&1
if %ERRORLEVEL% equ 0 (echo  [OK] FinAnalyzerMCP removed.) else (echo  [--] FinAnalyzerMCP not found.)

schtasks /delete /tn "FinAnalyzerUI" /f >nul 2>&1
if %ERRORLEVEL% equ 0 (echo  [OK] FinAnalyzerUI removed.) else (echo  [--] FinAnalyzerUI not found.)

echo.
echo  All tasks removed. Services will no longer auto-start on login.
echo.
pause
