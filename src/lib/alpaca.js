import { getDailyAdjusted } from "./alphavantage.js";

async function alpacaFetch(path, method = "GET", body = null, settings) {
  const base = settings.alpacaMode === "live" ? "/alpaca-live" : "/alpaca-paper";
  const headers = {
    "APCA-API-KEY-ID":     settings.alpacaKey,
    "APCA-API-SECRET-KEY": settings.alpacaSecret,
  };
  if (body) headers["Content-Type"] = "application/json"; // only on requests with a body
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
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

// qty may be pre-computed by trading.js (whole shares for bracket, fractional for simple)
// stopPrice/takeProfitPrice are null when bracket was dropped due to fractional qty
export async function placeOrder(symbol, side, notional, settings, { stopPrice, takeProfitPrice, price, qty: preQty } = {}) {
  const useBracket = !!(stopPrice && takeProfitPrice); // already resolved by trading.js
  const qty = preQty ?? (price ? parseFloat((notional / price).toFixed(6)) : null);

  const body = {
    symbol,
    ...(qty ? { qty: String(qty) } : { notional: notional.toFixed(2) }),
    side,
    type: "market",
    time_in_force: useBracket ? "gtc" : "day",
    ...(useBracket && qty && {
      order_class: "bracket",
      take_profit: { limit_price: takeProfitPrice.toFixed(2) },
      stop_loss:   { stop_price: stopPrice.toFixed(2) },
    }),
  };

  return alpacaFetch("/v2/orders", "POST", body, settings);
}

export async function closePosition(symbol, settings) {
  return alpacaFetch(`/v2/positions/${encodeURIComponent(symbol)}`, "DELETE", null, settings);
}

export async function getMarketClock(settings) {
  return alpacaFetch("/v2/clock", "GET", null, settings);
}

// Batch snapshot — uses Alpaca data API (SIP feed: all US exchanges, Algo Trader Plus)
export async function getSnapshots(symbols, settings) {
  const res = await fetch(`/alpaca-data/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=sip`, {
    headers: {
      "APCA-API-KEY-ID": settings.alpacaKey,
      "APCA-API-SECRET-KEY": settings.alpacaSecret,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca data error ${res.status}`);
  return data;
}

// Fetch daily OHLCV bars for charting (normalised for lightweight-charts)
// limit defaults to 60 (~3 months) for inline charts; use 365 for popup charts
// Primary source for US equities/ETFs: AV TIME_SERIES_DAILY_ADJUSTED (split-adjusted, paid tier)
// Fallback: Alpaca SIP → IEX

// timeframe config: { alpacaTf, daysBack, limit, intraday }
// IMPORTANT: limit must EXCEED the number of bars in the daysBack window so Alpaca
// returns the full range ending at today (not the first N bars from the start date).
// Equity 1D: 250 calendar ≈ 175 trading days.  Crypto 1D: 250 calendar = 250 bars.
const TF_CONFIG = {
  "1D":  { alpacaTf: "1Day",  daysBack: 250, limit: 300, intraday: false },
  "1H":  { alpacaTf: "1Hour", daysBack: 7,   limit: 250, intraday: true  },
  "15m": { alpacaTf: "15Min", daysBack: 3,   limit: 600, intraday: true  },
  "5m":  { alpacaTf: "5Min",  daysBack: 2,   limit: 600, intraday: true  },
};

// Convert Alpaca ISO timestamp to lightweight-charts time value
// Daily bars → "YYYY-MM-DD" string; intraday → Unix seconds (number)
function toChartTime(isoStr, intraday) {
  if (!intraday) return isoStr.slice(0, 10);
  return Math.floor(new Date(isoStr).getTime() / 1000);
}

export async function getChartBars(symbol, assetClass, settings, limit = 60, timeframe = "1D") {
  const DATA = "/alpaca-data";
  const headers = {
    "APCA-API-KEY-ID":     settings.alpacaKey,
    "APCA-API-SECRET-KEY": settings.alpacaSecret,
  };

  const cfg      = TF_CONFIG[timeframe] ?? TF_CONFIG["1D"];
  const intraday = cfg.intraday;
  const start    = new Date();
  start.setDate(start.getDate() - cfg.daysBack);
  const startStr = start.toISOString();

  if (assetClass === "Crypto") {
    const res = await fetch(
      `${DATA}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${cfg.alpacaTf}&start=${startStr}&limit=${cfg.limit}`,
      { headers }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Crypto bars error");
    return (data.bars?.[symbol] ?? []).map(b => ({
      time: toChartTime(b.t, intraday), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));
  }

  // US equities/ETFs
  // Daily: use AV adjusted bars (best quality), then Alpaca fallback
  if (!intraday) {
    const outputsize = "compact";
    const avBars = await getDailyAdjusted(symbol, outputsize).catch(() => null);
    if (avBars?.length) return avBars.slice(-Math.max(limit, 60));
  }

  // Intraday or AV fallback: Alpaca SIP (Algo Trader Plus — all exchanges) → default
  const base = `${DATA}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${cfg.alpacaTf}&start=${startStr}&limit=${cfg.limit}`;
  let res  = await fetch(`${base}&feed=sip`, { headers });
  let data = await res.json().catch(() => ({}));
  if (!res.ok || !(data.bars?.length > 0)) {
    res  = await fetch(base, { headers });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Stock bars error");
  }
  return (data.bars ?? []).map(b => ({
    time: toChartTime(b.t, intraday), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}

// Fetch last 5 news articles for a symbol via Alpaca/Benzinga news feed
export async function getNews(symbol, settings) {
  if (!settings?.alpacaKey || !settings?.alpacaSecret) return [];
  try {
    const res = await fetch(
      `/alpaca-data/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=10&sort=desc`,
      { headers: { "APCA-API-KEY-ID": settings.alpacaKey, "APCA-API-SECRET-KEY": settings.alpacaSecret } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return [];
    return (data.news || []).map(a => ({
      date:     a.created_at?.slice(0, 10) ?? "",
      headline: a.headline ?? "",
      summary:  a.summary  ?? "",
    }));
  } catch { return []; }
}

// Only Equity and ETF are supported on Alpaca paper trading
export function isAlpacaSupported(assetClass) {
  return assetClass === "Equity" || assetClass === "ETF";
}
