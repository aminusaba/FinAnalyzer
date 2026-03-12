Set oShell = CreateObject("WScript.Shell")
Dim DIR
DIR = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' MCP Server
oShell.Run """C:\Users\aminu\alpaca-mcp-server\.venv\Scripts\alpaca-mcp-server.exe"" serve --transport streamable-http --host 127.0.0.1 --port 8000 --allowed-hosts ""finanalyzer-zeta.vercel.app,localhost,localhost:5173,localhost:80,finanalyzer""", 0, False

WScript.Sleep 3000

' Vite UI (port 80 → http://finanalyzer/)
oShell.Run "cmd /c cd /d """ & DIR & """ && npm run dev", 0, False

WScript.Sleep 3000

' Scan Daemon
oShell.Run "cmd /c cd /d """ & DIR & """ && node scan-daemon.js", 0, False
