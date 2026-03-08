@echo off
echo Starting Alpaca MCP Server...
echo Transport: streamable-http on http://localhost:8000
echo CORS: localhost + finanalyzer-zeta.vercel.app
echo.
cd /d C:\Users\aminu\alpaca-mcp-server
.venv\Scripts\alpaca-mcp.exe serve --transport streamable-http --host 127.0.0.1 --port 8000 --allowed-hosts "finanalyzer-zeta.vercel.app,localhost"
pause
