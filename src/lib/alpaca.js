const PAPER_URL = "https://paper-api.alpaca.markets";
const LIVE_URL = "https://api.alpaca.markets";

async function alpacaFetch(path, method = "GET", body = null, settings) {
  const base = settings.alpacaMode === "live" ? LIVE_URL : PAPER_URL;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "APCA-API-KEY-ID": settings.alpacaKey,
      "APCA-API-SECRET-KEY": settings.alpacaSecret,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca error ${res.status}`);
  return data;
}

export async function getAccount(settings) {
  return alpacaFetch("/v2/account", "GET", null, settings);
}

export async function getPositions(settings) {
  return alpacaFetch("/v2/positions", "GET", null, settings);
}

export async function getOrders(settings) {
  return alpacaFetch("/v2/orders?status=all&limit=50", "GET", null, settings);
}

// notional = dollar amount (supports fractional shares)
// stopPrice / takeProfitPrice are optional — if provided, places a bracket order
export async function placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice } = {}) {
  const useBracket = settings.bracketOrdersEnabled && stopPrice && takeProfitPrice;

  const body = {
    symbol,
    notional: notional.toFixed(2),
    side,
    type: "market",
    time_in_force: "day",
    ...(useBracket && {
      order_class: "bracket",
      take_profit: { limit_price: takeProfitPrice.toFixed(4) },
      stop_loss:   { stop_price: stopPrice.toFixed(4) },
    }),
  };

  return alpacaFetch("/v2/orders", "POST", body, settings);
}

export async function closePosition(symbol, settings) {
  return alpacaFetch(`/v2/positions/${encodeURIComponent(symbol)}`, "DELETE", null, settings);
}

// Only Equity and ETF are supported on Alpaca paper trading
export function isAlpacaSupported(assetClass) {
  return assetClass === "Equity" || assetClass === "ETF";
}
