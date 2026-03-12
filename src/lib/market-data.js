// Fetches market data only for symbols tradeable on Alpaca (ALPACA_SCAN_SYMBOLS)
// Alpaca snapshot is primary source; Alpha Vantage is fallback for symbols with no Alpaca data

import { ALPACA_SCAN_SYMBOLS } from "./universe.js";
import { getSnapshots } from "./alpaca.js";
import { getQuote as avQuote } from "./alphavantage.js";

// Concurrency limiter — AV paid allows 75 req/min, keep headroom
async function withConcurrency(fns, limit = 15) {
  const results = new Array(fns.length);
  let idx = 0;
  async function worker() {
    while (idx < fns.length) {
      const i = idx++;
      try { results[i] = await fns[i](); } catch { results[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
  return results;
}

// AV fallback — only for ALPACA_SCAN_SYMBOLS that Alpaca snapshot missed
async function fetchFallback(missingSymbols) {
  if (!missingSymbols.length) return [];
  const tasks = missingSymbols.map(({ symbol, assetClass, market }) => async () => {
    const q = await avQuote(symbol).catch(() => null);
    if (!q) return null;
    return { symbol, ...q, assetClass, market };
  });
  const results = await withConcurrency(tasks, 15);
  return results.filter(Boolean);
}

async function fetchAlpacaSnapshots(settings) {
  if (!settings.alpacaKey || !settings.alpacaSecret) return [];
  try {
    const symbols = ALPACA_SCAN_SYMBOLS.map(s => s.symbol);
    const snapshots = await getSnapshots(symbols, settings);
    return ALPACA_SCAN_SYMBOLS.map(({ symbol, assetClass, market }) => {
      const snap = snapshots[symbol];
      if (!snap) return null;
      const price     = snap.latestTrade?.p || snap.dailyBar?.c || 0;
      const prevClose = snap.prevDailyBar?.c;
      const change_pct = prevClose && price ? ((price - prevClose) / prevClose) * 100 : 0;
      const bidPrice = snap.latestQuote?.bp ?? null;
      const askPrice = snap.latestQuote?.ap ?? null;
      const spreadPct = bidPrice && askPrice && askPrice > 0
        ? +((askPrice - bidPrice) / askPrice * 100).toFixed(4)
        : null;
      return price > 0 ? {
        symbol, price, change_pct, assetClass, market,
        dayOpen:   snap.dailyBar?.o  || null,
        dayHigh:   snap.dailyBar?.h  || null,
        dayLow:    snap.dailyBar?.l  || null,
        dayVwap:   snap.dailyBar?.vw || null,
        prevClose: prevClose         || null,
        bidPrice, askPrice, spreadPct,
      } : null;
    }).filter(Boolean);
  } catch {}
  return [];
}

export async function fetchAllMarketData(settings) {
  // Primary: Alpaca batch snapshot (real-time, accurate)
  const alpacaData = await fetchAlpacaSnapshots(settings);
  const alpacaSet = new Set(alpacaData.map(s => s.symbol));

  // Fallback: AV for any ALPACA_SCAN_SYMBOLS that Alpaca didn't return
  const missing = ALPACA_SCAN_SYMBOLS.filter(s => !alpacaSet.has(s.symbol));
  const fallbackData = await fetchFallback(missing);

  // Merge — Alpaca takes priority
  const map = new Map();
  for (const s of fallbackData) map.set(s.symbol, s);
  for (const s of alpacaData)   map.set(s.symbol, s);

  // Return only Alpaca-tradeable symbols, sorted by biggest movers first
  return [...map.values()]
    .filter(s => s.price > 0)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}
