// Unified trading layer — uses Alpaca MCP Server when available, falls back to direct REST API

import * as MCP from "./mcp-client.js";
import * as Alpaca from "./alpaca.js";

function mcpReady() { return MCP.isReady(); }

export async function getAccount(settings) {
  if (mcpReady()) return MCP.callTool("get_account_info");
  return Alpaca.getAccount(settings);
}

export async function getPositions(settings) {
  if (mcpReady()) {
    const result = await MCP.callTool("get_all_positions");
    return Array.isArray(result) ? result : [];
  }
  return Alpaca.getPositions(settings);
}

export async function getOrders(settings) {
  if (mcpReady()) {
    const result = await MCP.callTool("get_orders", { status: "all", limit: 50, nested: true });
    return Array.isArray(result) ? result : [];
  }
  return Alpaca.getOrders(settings);
}

export async function placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice, price } = {}) {
  if (mcpReady() && Alpaca.isAlpacaSupported(settings._assetClass)) {
    const qty = price ? parseFloat((notional / price).toFixed(6)) : undefined;
    if (!qty) return Alpaca.placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice });

    const useBracket = settings.bracketOrdersEnabled && stopPrice && takeProfitPrice;
    return MCP.callTool("place_stock_order", {
      symbol,
      side,
      quantity: qty,
      type: "market",
      time_in_force: "day",
      ...(useBracket && {
        order_class: "bracket",
        take_profit_price: parseFloat(takeProfitPrice.toFixed(4)),
        stop_loss_price: parseFloat(stopPrice.toFixed(4)),
      }),
    });
  }
  return Alpaca.placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice });
}

export async function closePosition(symbol, settings) {
  if (mcpReady()) return MCP.callTool("close_position", { symbol });
  return Alpaca.closePosition(symbol, settings);
}

export { isAlpacaSupported } from "./alpaca.js";
