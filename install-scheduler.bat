@echo off
title FinAnalyzer — Install Windows Scheduler Tasks
echo.
echo  FinAnalyzer Scheduler Setup
echo  This will register all FinAnalyzer services to start automatically on login.
echo.

:: Get the full path to this project directory
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: Find node.exe
for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
if "%NODE_EXE%"=="" (
    echo  [ERROR] Node.js not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo  Node.js found: %NODE_EXE%
echo  Project dir:   %PROJECT_DIR%
echo.

:: Check daemon-config.json exists
if not exist "%PROJECT_DIR%\daemon-config.json" (
    echo  [ERROR] daemon-config.json not found.
    echo  Copy daemon-config.example.json to daemon-config.json and fill in your settings first.
    pause
    exit /b 1
)

:: ── 1. Scan Daemon ─────────────────────────────────────────────────────────
echo  Registering FinAnalyzerDaemon...
schtasks /delete /tn "FinAnalyzerDaemon" /f >nul 2>&1
schtasks /create ^
  /tn "FinAnalyzerDaemon" ^
  /tr "\"%NODE_EXE%\" \"%PROJECT_DIR%\scan-daemon.js\"" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f ^
  /delay 0001:00

if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Failed to register FinAnalyzerDaemon. Try running as Administrator.
    pause
    exit /b 1
)
echo  [OK] FinAnalyzerDaemon registered.
echo.

:: ── 2. Alpaca MCP Server ───────────────────────────────────────────────────
set "MCP_DIR=C:\Users\aminu\alpaca-mcp-server"
set "MCP_EXE=%MCP_DIR%\.venv\Scripts\alpaca-mcp-server.exe"

if not exist "%MCP_EXE%" (
    echo  [SKIP] Alpaca MCP server not found at %MCP_EXE%
    echo         Edit this script to set MCP_DIR if it lives elsewhere.
    echo.
) else (
    echo  Registering FinAnalyzerMCP...
    schtasks /delete /tn "FinAnalyzerMCP" /f >nul 2>&1
    schtasks /create ^
      /tn "FinAnalyzerMCP" ^
      /tr "\"%MCP_EXE%\" serve --transport streamable-http --host 127.0.0.1 --port 8000 --allowed-hosts \"finanalyzer-zeta.vercel.app,localhost,localhost:5173\"" ^
      /sc ONLOGON ^
      /ru "%USERNAME%" ^
      /rl HIGHEST ^
      /f ^
      /delay 0000:30

    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] Failed to register FinAnalyzerMCP. Try running as Administrator.
    ) else (
        echo  [OK] FinAnalyzerMCP registered.
    )
    echo.
)

:: ── 3. Vite UI Dev Server ──────────────────────────────────────────────────
echo  Registering FinAnalyzerUI...
schtasks /delete /tn "FinAnalyzerUI" /f >nul 2>&1
schtasks /create ^
  /tn "FinAnalyzerUI" ^
  /tr "cmd /c \"%PROJECT_DIR%\start-ui.bat\"" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f ^
  /delay 0000:45

if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Failed to register FinAnalyzerUI. Try running as Administrator.
    pause
    exit /b 1
)
echo  [OK] FinAnalyzerUI registered.
echo.

:: ── Summary ────────────────────────────────────────────────────────────────
echo  ============================================================
echo  All services registered. They will auto-start on next login.
echo.
echo  Start order (staggered delays):
echo    0:30  — Alpaca MCP server  (port 8000)
echo    0:45  — Vite UI            (http://localhost:5173)
echo    1:00  — Scan daemon
echo.
echo  To start them NOW without rebooting, run:
echo    schtasks /run /tn "FinAnalyzerMCP"
echo    schtasks /run /tn "FinAnalyzerUI"
echo    schtasks /run /tn "FinAnalyzerDaemon"
echo.
echo  Other scripts:
echo    stop-daemon.bat           - Stop the daemon
echo    uninstall-scheduler.bat   - Remove all scheduled tasks
echo  ============================================================
echo.
pause
