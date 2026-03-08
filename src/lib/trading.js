// Unified trading layer — uses Alpaca MCP Server when available, falls back to direct REST API

import * as MCP from "./mcp-client.js";
import * as Alpaca from "./alpaca.js";

function mcpReady() { return MCP.isReady(); }

// Parse buying_power from MCP account text (e.g. "Buying Power: $12,345.67" or "buying_power: 12345.67")
function parseBuyingPower(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/buying[\s_-]?power[:\s$]*([\d,]+\.?\d*)/i);
  if (match) return parseFloat(match[1].replace(/,/g, ""));
  return null;
}

export async function getAccount(settings) {
  // Try MCP first — richer context, same source of truth as trading
  if (mcpReady()) {
    try {
      const result = await MCP.callTool("get_account_info", {});
      const rawText = typeof result === "string" ? result : JSON.stringify(result);
      const bp = parseBuyingPower(rawText);
      // Return object compatible with REST response shape
      if (bp !== null) {
        const equityMatch = rawText.match(/(?:portfolio[\s_]?value|equity)[:\s$]*([\d,]+\.?\d*)/i);
        const equity = equityMatch ? parseFloat(equityMatch[1].replace(/,/g, "")) : null;
        return { buying_power: bp, equity: equity ?? bp, _source: "mcp", _raw: rawText };
      }
    } catch {}
  }
  // Fall back to direct REST
  return Alpaca.getAccount(settings);
}

export async function getPositions(settings) {
  return Alpaca.getPositions(settings);
}

export async function getOrders(settings) {
  return Alpaca.getOrders(settings);
}

export async function placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice, price } = {}) {
  const fractionalQty = price ? parseFloat((notional / price).toFixed(6)) : null;

  // Alpaca rule: fractional shares only allowed on SIMPLE orders.
  // For bracket orders, round down to whole shares. If < 1 whole share, drop bracket.
  const wantBracket = settings.bracketOrdersEnabled && stopPrice && takeProfitPrice;
  const wholeQty    = fractionalQty ? Math.floor(fractionalQty) : null;
  const canBracket  = wantBracket && wholeQty >= 1;
  const qty         = canBracket ? wholeQty : fractionalQty; // whole for bracket, fractional for simple

  if (mcpReady() && Alpaca.isAlpacaSupported(settings._assetClass)) {
    if (!qty) return Alpaca.placeOrder(symbol, side, notional, settings, { price });

    const result = await MCP.callTool("place_stock_order", {
      symbol,
      side,
      quantity: qty,
      type: "market",
      time_in_force: "day",
      ...(canBracket && {
        order_class:       "bracket",
        take_profit_price: parseFloat(takeProfitPrice.toFixed(4)),
        stop_loss_price:   parseFloat(stopPrice.toFixed(4)),
      }),
    });
    // MCP returns order JSON or a plain-text error string — detect failures
    if (typeof result === "string" && !result.includes('"id"')) {
      throw new Error(result);
    }
    if (result?.code || result?.message?.toLowerCase().includes("error")) {
      throw new Error(result.message || String(result.code));
    }
    return result;
  }

  // REST fallback — pass resolved qty so alpaca.js skips re-computing
  return Alpaca.placeOrder(symbol, side, notional, settings, { stopPrice: canBracket ? stopPrice : null, takeProfitPrice: canBracket ? takeProfitPrice : null, price, qty });
}

export async function closePosition(symbol, settings) {
  if (mcpReady()) return MCP.callTool("close_position", { symbol });
  return Alpaca.closePosition(symbol, settings);
}

// Fetch recent daily OHLCV bars for market context (equities + crypto)
export async function getMarketBars(symbol, assetClass) {
  if (!mcpReady()) return null;
  try {
    if (assetClass === "Crypto") {
      return await MCP.callTool("get_crypto_bars", { symbol, timeframe: "1Day", limit: 10 });
    } else if (assetClass === "Equity" || assetClass === "ETF") {
      return await MCP.callTool("get_stock_bars", { symbol, timeframe: "1Day", limit: 10 });
    }
  } catch {}
  return null;
}

export { isAlpacaSupported } from "./alpaca.js";
