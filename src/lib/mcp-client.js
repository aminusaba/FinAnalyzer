// MCP Streamable-HTTP client for Alpaca MCP Server

const state = {
  url: "http://localhost:8000/mcp",
  sessionId: null,
  initialized: false,
  reqId: 0,
};

async function request(method, params = {}, isNotification = false) {
  const body = {
    jsonrpc: "2.0",
    ...(!isNotification && { id: ++state.reqId }),
    method,
    params,
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (state.sessionId) headers["Mcp-Session-Id"] = state.sessionId;

  const res = await fetch(state.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSession = res.headers.get("Mcp-Session-Id");
  if (newSession) state.sessionId = newSession;

  if (isNotification || res.status === 204) return null;
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);

  const ct = res.headers.get("Content-Type") || "";
  let data;

  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const dataLine = text.split("\n").reverse().find(l => l.startsWith("data: "));
    if (!dataLine) throw new Error("Empty SSE response");
    data = JSON.parse(dataLine.slice(6));
  } else {
    data = await res.json();
  }

  if (data.error) throw new Error(data.error.message || "MCP error");
  return data.result;
}

export async function initialize(url) {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  state.url = isLocalhost ? "/mcp" : (url || "http://localhost:8000") + "/mcp";
  state.sessionId = null;
  state.initialized = false;
  state.reqId = 0;

  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "FinAnalyzer", version: "1.0.0" },
  });

  await request("notifications/initialized", {}, true);
  state.initialized = true;
}

export async function callTool(name, args = {}) {
  if (!state.initialized) throw new Error("MCP not initialized");
  const result = await request("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error("No content in MCP response");
  try { return JSON.parse(text); } catch { return text; }
}

export function isReady() { return state.initialized; }

export function reset() {
  state.sessionId = null;
  state.initialized = false;
}

// Ping to check if server is reachable (without initializing)
export async function ping(url) {
  try {
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const base = isLocalhost ? "/mcp" : (url || "http://localhost:8000") + "/mcp";
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ping", version: "1" },
      }}),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}
