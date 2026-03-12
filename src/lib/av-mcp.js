/**
 * Alpha Vantage MCP client.
 * Connects to the official AV remote MCP server via the Vite /av-mcp proxy.
 * Tool names match AV REST API function names (GLOBAL_QUOTE, COMPANY_OVERVIEW, etc.)
 */

const state = {
  url:         "/av-mcp",
  sessionId:   null,
  initialized: false,
  reqId:       0,
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
    "Accept":        "application/json, text/event-stream",
  };
  if (state.sessionId) headers["Mcp-Session-Id"] = state.sessionId;

  const res = await fetch(state.url, { method: "POST", headers, body: JSON.stringify(body) });

  const newSession = res.headers.get("Mcp-Session-Id");
  if (newSession) state.sessionId = newSession;

  if (isNotification || res.status === 204) return null;
  if (!res.ok) throw new Error(`AV MCP HTTP ${res.status}`);

  const ct = res.headers.get("Content-Type") || "";
  let data;
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const line = text.split("\n").reverse().find(l => l.startsWith("data: "));
    if (!line) throw new Error("Empty SSE from AV MCP");
    data = JSON.parse(line.slice(6));
  } else {
    data = await res.json();
  }

  if (data.error) throw new Error(data.error.message || "AV MCP error");
  return data.result;
}

async function ensureInit() {
  if (state.initialized) return;
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "FinAnalyzer", version: "1.0.0" },
  });
  await request("notifications/initialized", {}, true);
  state.initialized = true;
}

/**
 * Call an Alpha Vantage MCP tool by name.
 * Returns parsed JSON object or raw text if not JSON.
 */
export async function avCall(toolName, args = {}) {
  await ensureInit();
  const result = await request("tools/call", { name: toolName, arguments: args });
  const text   = result?.content?.[0]?.text;
  if (!text) throw new Error(`No content from AV MCP tool: ${toolName}`);
  try { return JSON.parse(text); } catch { return text; }
}

export function resetAvMcp() {
  state.sessionId   = null;
  state.initialized = false;
}
