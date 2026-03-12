@echo off
title FinAnalyzer — Restart All Services
echo.
echo  Stopping existing services...
echo.

taskkill /f /im alpaca-mcp-server.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (echo  [OK] MCP server stopped.) else (echo  [--] MCP server was not running.)

for /f "tokens=2" %%p in ('tasklist /fi "imagename eq node.exe" /fo csv /nh 2^>nul') do (
    wmic process where "ProcessId=%%~p" get CommandLine /value 2>nul | find /i "vite" >nul && taskkill /f /pid %%~p >nul 2>&1
    wmic process where "ProcessId=%%~p" get CommandLine /value 2>nul | find /i "scan-daemon" >nul && taskkill /f /pid %%~p >nul 2>&1
)
echo  [OK] Node processes stopped.

timeout /t 3 /nobreak >nul
echo.

call "%~dp0start-all.bat"
