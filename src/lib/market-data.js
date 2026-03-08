// Fetches market data from ALL sources in parallel (Finnhub + Alpaca + MCP crypto)
// Merges by symbol — Alpaca data takes priority over Finnhub for equity/ETF

import { UNIVERSE, CRYPTO_SYMBOLS, ALPACA_SCAN_SYMBOLS } from "./universe.js";
import { getSnapshots } from "./alpaca.js";
import { isReady as mcpReady, callTool as mcpCall } from "./mcp-client.js";

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

async function finnhubQuote(symbol) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d?.c) return { price: d.c, change_pct: d.dp ?? 0 };
  } catch {}
  return null;
}



async function fetchFinnhubEquities() {
  const entries = Object.entries(UNIVERSE);
  const results = await Promise.all(
    entries.flatMap(([category, symbols]) =>
      symbols.map(async symbol => {
        const q = await finnhubQuote(symbol);
        if (!q) return null;
        const assetClass = category === "US ETFs" ? "ETF"
          : category === "Commodities" ? "Commodity"
          : category.includes("Europe") ? "Europe"
          : category.includes("Asia") ? "Asia"
          : "Equity";
        return { symbol, ...q, assetClass, market: category };
      })
    )
  );
  return results.filter(Boolean);
}

async function fetchAlpacaEquities(settings) {
  if (!settings.alpacaKey || !settings.alpacaSecret) return [];
  try {
    const symbols = ALPACA_SCAN_SYMBOLS.map(s => s.symbol);
    const snapshots = await getSnapshots(symbols, settings);
    return ALPACA_SCAN_SYMBOLS.map(({ symbol, assetClass, market }) => {
      const snap = snapshots[symbol];
      if (!snap) return null;
      const price     = snap.dailyBar?.c || snap.latestTrade?.p || 0;
      const prevClose = snap.prevDailyBar?.c;
      const change_pct = prevClose && price ? ((price - prevClose) / prevClose) * 100 : 0;
      return price > 0 ? { symbol, price, change_pct, assetClass, market } : null;
    }).filter(Boolean);
  } catch {}
  return [];
}

async function fetchCrypto() {
  if (!mcpReady()) return []; // Crypto requires MCP (Finnhub crypto API is premium-only)
  return (await Promise.all(
    CRYPTO_SYMBOLS.map(async ({ display }) => {
      try {
        const bars = await mcpCall("get_crypto_bars", { symbol: display, timeframe: "1Day", limit: 2 });
        const list = Array.isArray(bars) ? bars : (bars?.bars?.[display] || null);
        if (Array.isArray(list) && list.length >= 2) {
          const price = list[list.length - 1].c ?? list[list.length - 1].close;
          const prev  = list[list.length - 2].c ?? list[list.length - 2].close;
          if (price && prev)
            return { symbol: display, price, change_pct: ((price - prev) / prev) * 100, assetClass: "Crypto", market: "Crypto" };
        }
      } catch {}
      return null;
    })
  )).filter(Boolean);
}

export async function fetchAllMarketData(settings) {
  // Run all sources in parallel
  const [finnhubEquities, alpacaEquities, crypto] = await Promise.all([
    fetchFinnhubEquities(),
    fetchAlpacaEquities(settings),
    fetchCrypto(),
  ]);

  // Merge into map — lower priority first, higher overwrites
  const map = new Map();
  for (const s of [...finnhubEquities, ...crypto]) map.set(s.symbol, s);
  // Alpaca overwrites Finnhub for equity/ETF (real-time, more accurate)
  for (const s of alpacaEquities) map.set(s.symbol, s);

  // Return sorted by absolute change% — biggest movers first
  return [...map.values()]
    .filter(s => s.price > 0)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}
