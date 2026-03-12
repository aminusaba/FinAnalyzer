// Unified trading layer — uses Alpaca MCP Server when available, falls back to direct REST API

import * as MCP from "./mcp-client.js";
import * as Alpaca from "./alpaca.js";
import { getDailyAdjusted } from "./alphavantage.js";

function mcpReady() { return MCP.isReady(); }

// Parse buying_power from MCP account text (e.g. "Buying Power: $12,345.67" or "buying_power: 12345.67")
function parseBuyingPower(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/buying[\s_-]?power[:\s$]*([\d,]+\.?\d*)/i);
  if (match) return parseFloat(match[1].replace(/,/g, ""));
  return null;
}

export async function getAccount(settings) {
  // Always use direct REST — account info requires structured JSON fields
  // (equity, last_equity, buying_power, cash, portfolio_value) that MCP text parsing
  // cannot reliably extract, causing wrong Day P&L and Portfolio Value displays.
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
      time_in_force: canBracket ? "gtc" : "day",
      ...(canBracket && {
        order_class:       "bracket",
        take_profit_price: parseFloat(takeProfitPrice.toFixed(2)),
        stop_loss_price:   parseFloat(stopPrice.toFixed(2)),
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
  if (mcpReady()) {
    try { return await MCP.callTool("close_position", { symbol }); } catch {}
    // MCP call failed — fall through to REST
  }
  return Alpaca.closePosition(symbol, settings);
}

// Fetch recent daily OHLCV bars for technical analysis
// US equities/ETFs: AV TIME_SERIES_DAILY_ADJUSTED (split-adjusted, 100 bars, paid tier)
// Crypto: Alpaca MCP crypto bars
export async function getMarketBars(symbol, assetClass) {
  if (assetClass === "Equity" || assetClass === "ETF") {
    // AV daily adjusted — full history, split/dividend-adjusted, needed for SMA200 (200+ bars required)
    const bars = await getDailyAdjusted(symbol, "full").catch(() => null);
    if (bars?.length) return bars;
    // Fallback to Alpaca MCP bars if AV unavailable
    if (mcpReady()) {
      try { return await MCP.callTool("get_stock_bars", { symbol, timeframe: "1Day", limit: 60 }); } catch {}
    }
    return null;
  }
  if (assetClass === "Crypto" && mcpReady()) {
    try { return await MCP.callTool("get_crypto_bars", { symbol, timeframe: "1Day", limit: 60 }); } catch {}
  }
  return null;
}

export async function getMarketClock(settings) {
  if (mcpReady()) {
    try {
      const result = await MCP.callTool("get_clock", {});
      const raw = typeof result === "string" ? result : JSON.stringify(result);
      if (raw.includes('"is_open":true') || raw.includes('"is_open": true'))  return { is_open: true };
      if (raw.includes('"is_open":false') || raw.includes('"is_open": false')) return { is_open: false };
    } catch {}
  }
  return Alpaca.getMarketClock(settings);
}

/**
 * Time-based fallback: true if current time is within US market hours (ET).
 * Used when Alpaca clock API is unavailable.
 */
export function isUSMarketHoursNow() {
  const now   = new Date();
  const day   = now.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const et    = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mins  = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins < 960; // 9:30 AM–4:00 PM ET
}

export function isPreMarketNow() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const et   = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 240 && mins < 570; // 4:00 AM–9:30 AM ET
}

/** Returns true if orders/analysis should proceed for this asset class right now. */
export function isMarketOpenForAsset(assetClass, clock) {
  if (assetClass === "Crypto") return true; // crypto trades 24/7
  // Use Alpaca clock when available, otherwise fall back to local time check
  return clock != null ? clock.is_open : isUSMarketHoursNow();
}

export { isAlpacaSupported } from "./alpaca.js";
