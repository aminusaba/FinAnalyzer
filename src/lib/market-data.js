// Fetches market data only for symbols tradeable on Alpaca (ALPACA_SCAN_SYMBOLS)
// Alpaca snapshot is primary source; Finnhub is fallback for symbols with no Alpaca data

import { ALPACA_SCAN_SYMBOLS } from "./universe.js";
import { getSnapshots } from "./alpaca.js";

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

async function finnhubQuote(symbol) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d?.c) return { price: d.c, change_pct: d.dp ?? 0 };
  } catch {}
  return null;
}

// Concurrency limiter — avoids Finnhub rate-limit (30 req/s free tier)
async function withConcurrency(fns, limit = 5) {
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

// Finnhub fallback — only for ALPACA_SCAN_SYMBOLS that Alpaca snapshot missed
async function fetchFinnhubFallback(missingSymbols) {
  if (!missingSymbols.length || !FINNHUB_KEY) return [];
  const tasks = missingSymbols.map(({ symbol, assetClass, market }) => async () => {
    const q = await finnhubQuote(symbol);
    if (!q) return null;
    return { symbol, ...q, assetClass, market };
  });
  const results = await withConcurrency(tasks, 5);
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
      const price     = snap.dailyBar?.c || snap.latestTrade?.p || 0;
      const prevClose = snap.prevDailyBar?.c;
      const change_pct = prevClose && price ? ((price - prevClose) / prevClose) * 100 : 0;
      return price > 0 ? { symbol, price, change_pct, assetClass, market } : null;
    }).filter(Boolean);
  } catch {}
  return [];
}

export async function fetchAllMarketData(settings) {
  // Primary: Alpaca batch snapshot (real-time, accurate)
  const alpacaData = await fetchAlpacaSnapshots(settings);
  const alpacaSet = new Set(alpacaData.map(s => s.symbol));

  // Fallback: Finnhub for any ALPACA_SCAN_SYMBOLS that Alpaca didn't return
  const missing = ALPACA_SCAN_SYMBOLS.filter(s => !alpacaSet.has(s.symbol));
  const finnhubData = await fetchFinnhubFallback(missing);

  // Merge — Alpaca takes priority
  const map = new Map();
  for (const s of finnhubData) map.set(s.symbol, s);
  for (const s of alpacaData)  map.set(s.symbol, s);

  // Return only Alpaca-tradeable symbols, sorted by biggest movers first
  return [...map.values()]
    .filter(s => s.price > 0)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}
