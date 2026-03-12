/**
 * FinAnalyzer Scan Daemon
 * Runs market scans in the background — no browser required.
 * Sends Telegram alerts and optionally places Alpaca orders.
 * Start with: start-daemon.bat
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALPACA_SCAN_SYMBOLS, CRYPTO_SYMBOLS } from "./src/lib/universe.js";
import { upsertScanResult, addScanRun, addTrade, upsertPositionMeta, updatePositionHighWater, getAllPositionMeta, deletePositionMeta, setScanProgress, addDaemonLog, upsertDaemonHeartbeat } from "./server/database.js";

// Patch console so all output is also persisted to daemon_logs table in SQLite
const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);
const _fmt   = (args) => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
console.log   = (...a) => { _log(...a);   try { addDaemonLog('info',  _fmt(a)); } catch {} };
console.warn  = (...a) => { _warn(...a);  try { addDaemonLog('warn',  _fmt(a)); } catch {} };
console.error = (...a) => { _error(...a); try { addDaemonLog('error', _fmt(a)); } catch {} };
import { computeIndicators, computeATRLevels, formatIndicators, formatNewsItems } from "./src/lib/indicators.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config loading ────────────────────────────────────────────────────────

function loadEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(__dirname, ".env"), "utf8")
        .split("\n")
        .filter(l => l.includes("="))
        .map(l => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })
    );
  } catch { return {}; }
}

function loadConfig() {
  const cfgPath = path.join(__dirname, "daemon-config.json");
  if (!fs.existsSync(cfgPath)) {
    console.error("\n[ERROR] daemon-config.json not found.");
    console.error("Run: copy daemon-config.example.json daemon-config.json\nThen fill in your Alpaca keys.\n");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
}

const ENV = loadEnv();
let config = loadConfig();

const OPENAI_KEY      = ENV.VITE_OPENAI_KEY;
const AV_KEY          = ENV.VITE_ALPHA_VANTAGE_KEY;
const TELEGRAM_TOKEN  = ENV.VITE_TELEGRAM_BOT_TOKEN;

const PAPER_URL = "https://paper-api.alpaca.markets";
const LIVE_URL  = "https://api.alpaca.markets";
const DATA_URL  = "https://data.alpaca.markets";

// ─── Alpaca REST helpers ────────────────────────────────────────────────────

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID":     config.alpacaKey,
    "APCA-API-SECRET-KEY": config.alpacaSecret,
    "Content-Type":        "application/json",
  };
}

function tradeBase() {
  return config.alpacaMode === "live" ? LIVE_URL : PAPER_URL;
}

async function alpacaGet(path) {
  const res = await fetch(`${tradeBase()}${path}`, { headers: alpacaHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
  return data;
}

async function alpacaDel(path) {
  const res = await fetch(`${tradeBase()}${path}`, { method: "DELETE", headers: alpacaHeaders() });
  if (res.status === 404 || res.status === 422) return null; // already cancelled/filled
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca DELETE ${res.status}`);
  return data;
}

// Count weekday (Mon–Fri) trading days between two dates
function countTradingDays(fromDate, toDate) {
  let count = 0;
  const cur = new Date(fromDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function cancelOpenOrdersForSymbol(symbol) {
  try {
    const all = await alpacaGet("/v2/orders?status=open&limit=500");
    const matching = (Array.isArray(all) ? all : []).filter(o => o.symbol === symbol);
    if (!matching.length) return 0;
    await Promise.all(matching.map(o => alpacaDel(`/v2/orders/${o.id}`).catch(() => {})));
    // Give Alpaca a moment to process the cancellations
    await new Promise(r => setTimeout(r, 1500));
    return matching.length;
  } catch { return 0; }
}

async function alpacaPost(path, body) {
  const res = await fetch(`${tradeBase()}${path}`, {
    method: "POST",
    headers: alpacaHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
  return data;
}

// Poll an order until filled or timeout; returns filled_qty (string) or null
async function waitForFill(orderId, maxWaitMs = 10_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1_000));
    try {
      const order = await alpacaGet(`/v2/orders/${orderId}`);
      if (order.status === "filled" || order.status === "partially_filled") {
        return order.filled_qty || order.qty;
      }
      if (["canceled", "expired", "rejected", "done_for_day"].includes(order.status)) return null;
    } catch { break; }
  }
  return null;
}

async function getSnapshots(symbols) {
  // SIP feed = all US exchanges (Algo Trader Plus) — better price accuracy than IEX
  const res = await fetch(`${DATA_URL}/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=sip`, {
    headers: alpacaHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca data ${res.status}`);
  return data;
}

async function getCryptoSnapshot(symbol) {
  try {
    const res = await fetch(
      `${DATA_URL}/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(symbol)}`,
      { headers: alpacaHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const snap = data.snapshots?.[symbol] ?? data.snapshots?.[decodeURIComponent(symbol)];
    if (!snap) return null;
    return {
      dayOpen:     snap.dailyBar?.o   ?? null,
      dayHigh:     snap.dailyBar?.h   ?? null,
      dayLow:      snap.dailyBar?.l   ?? null,
      dayVwap:     snap.dailyBar?.vw  ?? null,
      prevClose:   snap.prevDailyBar?.c ?? null,
      latestPrice: snap.latestTrade?.p ?? snap.minuteBar?.c ?? null,
    };
  } catch { return null; }
}

async function getNews(symbol) {
  if (!config.alpacaKey || !config.alpacaSecret) return [];
  const cacheKey = `alpaca:${symbol}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < NEWS_CACHE_TTL) return cached.data;
  try {
    const res = await fetch(
      `https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=10&sort=desc`,
      { headers: alpacaHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return [];
    const result = (data.news || []).map(a => ({
      date:     a.created_at?.slice(0, 10) ?? "",
      headline: a.headline ?? "",
      summary:  a.summary  ?? "",
    }));
    newsCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch { return newsCache.get(cacheKey)?.data ?? []; }
}

// Fetch OPRA real-time options flow for equity symbols (Algo Trader Plus)
// Only queries near-ATM options expiring 5–60 days out to limit data volume
async function getOptionsFlow(symbol, currentPrice) {
  if (!config.alpacaKey || !config.alpacaSecret || !currentPrice) return null;
  try {
    const minStrike  = (currentPrice * 0.90).toFixed(2);
    const maxStrike  = (currentPrice * 1.10).toFixed(2);
    const today      = new Date();
    const minExp     = new Date(today); minExp.setDate(today.getDate() + 5);
    const maxExp     = new Date(today); maxExp.setDate(today.getDate() + 60);
    const minExpStr  = minExp.toISOString().slice(0, 10);
    const maxExpStr  = maxExp.toISOString().slice(0, 10);
    const params     = `underlying_symbols=${encodeURIComponent(symbol)}&strike_price_gte=${minStrike}&strike_price_lte=${maxStrike}&expiration_date_gte=${minExpStr}&expiration_date_lte=${maxExpStr}&feed=opra&limit=100`;

    const [callsRes, putsRes] = await Promise.all([
      fetch(`${DATA_URL}/v1beta1/options/snapshots?${params}&type=call`, { headers: alpacaHeaders() }),
      fetch(`${DATA_URL}/v1beta1/options/snapshots?${params}&type=put`,  { headers: alpacaHeaders() }),
    ]);
    const callsData = await callsRes.json().catch(() => ({}));
    const putsData  = await putsRes.json().catch(() => ({}));

    const callSnaps = Object.values(callsData.snapshots ?? {});
    const putSnaps  = Object.values(putsData.snapshots  ?? {});
    if (!callSnaps.length && !putSnaps.length) return null;

    const sumVol = snaps => snaps.reduce((s, snap) => s + (snap.dailyBar?.v ?? 0), 0);
    const sumOI  = snaps => snaps.reduce((s, snap) => s + (snap.details?.openInterest ?? 0), 0);
    const avgIV  = snaps => { const ivs = snaps.map(s => s.impliedVolatility).filter(v => v > 0); return ivs.length ? +(ivs.reduce((s, v) => s + v, 0) / ivs.length * 100).toFixed(1) : null; };

    const callVol = sumVol(callSnaps);
    const putVol  = sumVol(putSnaps);
    const callOI  = sumOI(callSnaps);
    const putOI   = sumOI(putSnaps);
    const totalVol = callVol + putVol;
    if (totalVol < 50) return null;

    const pcRatio = callVol > 0 ? +(putVol / callVol).toFixed(2) : null;

    // Find unusual flow: contracts with volume > 3× open interest and > 200 contracts
    const unusual = [];
    const checkUnusual = (snapsObj, type) => {
      for (const snap of Object.values(snapsObj?.snapshots ?? {})) {
        const vol = snap.dailyBar?.v ?? 0;
        const oi  = snap.details?.openInterest ?? 0;
        const iv  = snap.impliedVolatility ? +(snap.impliedVolatility * 100).toFixed(1) : null;
        if (vol > 200 && oi > 0 && vol > oi * 3) unusual.push({ type, vol, oi, ratio: +(vol / oi).toFixed(1), iv });
      }
    };
    checkUnusual(callsData, "CALL");
    checkUnusual(putsData, "PUT");
    unusual.sort((a, b) => b.ratio - a.ratio);

    return {
      callVol, putVol, totalVol, callOI, putOI,
      pcRatio,
      callIV: avgIV(callSnaps),
      putIV:  avgIV(putSnaps),
      unusual: unusual.slice(0, 3),
      bias: pcRatio === null ? "neutral" : pcRatio < 0.7 ? "bullish" : pcRatio > 1.5 ? "bearish" : "neutral",
    };
  } catch { return null; }
}

async function getCryptoBars(symbol) {
  // Use explicit start date 4 days back — ensures ≥2 completed daily bars
  // regardless of when during the day this runs (daily bar resets at midnight UTC)
  const start = new Date();
  start.setDate(start.getDate() - 4);
  const startStr = start.toISOString().slice(0, 10);
  const res = await fetch(
    `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&start=${startStr}&limit=5`,
    { headers: alpacaHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn(`[WARN] Crypto bars failed for ${symbol}: HTTP ${res.status} — ${data.message || JSON.stringify(data).slice(0, 120)}`);
    return null;
  }
  const bars = data.bars?.[symbol] ?? data.bars?.[decodeURIComponent(symbol)];
  if (!Array.isArray(bars) || bars.length < 2) {
    console.warn(`[WARN] Crypto bars insufficient for ${symbol}: got ${bars?.length ?? 0} bars (raw keys: ${Object.keys(data.bars ?? {}).join(", ") || "none"})`);
    return null;
  }
  return bars;
}

async function getStockBars(symbol) {
  try {
    // 500 bars — enough for SMA200 + buffer; real-time via IEX feed (no delay)
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&limit=500&feed=sip`,
      { headers: alpacaHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return (data.bars || []).map(b => ({ time: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  } catch { return null; }
}

async function getCryptoOHLCV(symbol) {
  try {
    // 300 bars needed for SMA200 — use explicit start date (limit alone may truncate)
    const start = new Date();
    start.setDate(start.getDate() - 420); // ~420 calendar days ≈ 300 trading days
    const startStr = start.toISOString().slice(0, 10);
    const res = await fetch(
      `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&start=${startStr}&limit=300`,
      { headers: alpacaHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const bars = data.bars?.[symbol] ?? [];
    return bars.map(b => ({ time: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  } catch { return null; }
}

async function getCryptoHourlyBars(symbol) {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 3); // 72 hours back → ~72 hourly bars
    const startStr = start.toISOString();
    const res = await fetch(
      `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Hour&start=${startStr}&limit=72`,
      { headers: alpacaHeaders() }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const bars = data.bars?.[symbol] ?? data.bars?.[decodeURIComponent(symbol)];
    if (!Array.isArray(bars) || bars.length < 14) return null; // need ≥14 bars for RSI
    return bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  } catch { return null; }
}

// Volume ratio: latest bar volume vs N-bar average (>1 = above-average volume)
function volumeAvgRatio(bars, lookback = 10) {
  if (!bars || bars.length < lookback + 1) return null;
  const recent = bars[bars.length - 1].volume;
  const avg    = bars.slice(-lookback - 1, -1).reduce((s, b) => s + b.volume, 0) / lookback;
  return avg > 0 ? +(recent / avg).toFixed(2) : null;
}

async function getCryptoFearGreed() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    const data = await res.json().catch(() => ({}));
    const entry = data?.data?.[0];
    if (!entry) return null;
    return { value: parseInt(entry.value), label: entry.value_classification };
  } catch { return null; }
}

async function getAvDailyAdjusted(symbol) {
  if (!AV_KEY) return null;
  try {
    // "full" = up to 20yr history — needed for SMA200 (requires 200+ bars)
    const d = await avCall("TIME_SERIES_DAILY_ADJUSTED", { symbol, outputsize: "full", entitlement: "delayed" });
    const ts = d?.["Time Series (Daily)"];
    if (!ts) return null;
    return Object.entries(ts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        time:   date,
        open:   parseFloat(v["1. open"]),
        high:   parseFloat(v["2. high"]),
        low:    parseFloat(v["3. low"]),
        close:  parseFloat(v["5. adjusted close"]),
        volume: parseInt(v["6. volume"]),
      }))
      .filter(b => b.close > 0);
  } catch { return null; }
}

async function getBarsByAssetClass(symbol, assetClass) {
  if (assetClass === "Crypto") return getCryptoOHLCV(symbol);
  // Alpaca first — real-time IEX feed, 500 bars (2yr history, better SMA200 + support/resistance), no delay
  const alpacaBars = await getStockBars(symbol);
  if (alpacaBars?.length >= 60) return alpacaBars;
  // Fall back to AV — split-adjusted, 20yr history, but 15-min delayed
  return getAvDailyAdjusted(symbol);
}

// ─── Alpha Vantage MCP client (daemon) ──────────────────────────────────────

const avMcpState = { sessionId: null, initialized: false, reqId: 0 };
const macroCache = { data: null, ts: 0 };
const MACRO_CACHE_TTL        = 6  * 60 * 60 * 1000; // 6 hours
const FUNDAMENTALS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const NEWS_CACHE_TTL         = 30 * 60 * 1000;       // 30 minutes
const fundamentalsCache = new Map(); // symbol → { data, ts }
const newsCache         = new Map(); // "av:symbol" | "alpaca:symbol" → { data, ts }

// AV API rate limiter — sliding window, max 70 calls/min (buffer under 75 premium limit)
const _avCallTimes = [];
async function avThrottle() {
  const now = Date.now();
  const windowStart = now - 60000;
  while (_avCallTimes.length && _avCallTimes[0] < windowStart) _avCallTimes.shift();
  if (_avCallTimes.length >= 70) {
    const waitMs = _avCallTimes[0] + 60000 - Date.now() + 100;
    await new Promise(r => setTimeout(r, Math.max(0, waitMs)));
    return avThrottle();
  }
  _avCallTimes.push(Date.now());
}

async function avMcpRequest(method, params = {}, isNotification = false) {
  if (!AV_KEY) throw new Error("VITE_ALPHA_VANTAGE_KEY not set");
  const body = { jsonrpc: "2.0", ...(!isNotification && { id: ++avMcpState.reqId }), method, params };
  const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
  if (avMcpState.sessionId) headers["Mcp-Session-Id"] = avMcpState.sessionId;

  const res = await fetch(`https://mcp.alphavantage.co/mcp?apikey=${AV_KEY}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const newSession = res.headers.get("Mcp-Session-Id");
  if (newSession) avMcpState.sessionId = newSession;
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

async function avMcpInit() {
  if (avMcpState.initialized) return;
  await avMcpRequest("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "FinAnalyzerDaemon", version: "1.0.0" } });
  await avMcpRequest("notifications/initialized", {}, true);
  avMcpState.initialized = true;
}

async function avCall(toolName, args = {}) {
  await avThrottle();
  await avMcpInit();
  const result = await avMcpRequest("tools/call", { name: toolName, arguments: args });
  const text   = result?.content?.[0]?.text;
  if (!text) throw new Error(`No content from AV MCP: ${toolName}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── AV-powered fundamentals ─────────────────────────────────────────────────

async function getFundamentals(symbol) {
  if (!AV_KEY) return null;
  const cached = fundamentalsCache.get(symbol);
  if (cached && Date.now() - cached.ts < FUNDAMENTALS_CACHE_TTL) return cached.data;
  try {
    const [overview, calResult, earningsResult, insiderResult, cfResult] = await Promise.all([
      avCall("COMPANY_OVERVIEW",      { symbol }).catch(() => null),
      avCall("EARNINGS_CALENDAR",     { symbol, horizon: "3month" }).catch(() => null),
      avCall("EARNINGS",              { symbol }).catch(() => null),
      avCall("INSIDER_TRANSACTIONS",  { symbol }).catch(() => null),
      avCall("CASH_FLOW",             { symbol }).catch(() => null),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    let upcoming = null;
    if (typeof calResult === "string") {
      upcoming = calResult.trim().split("\n").slice(1)
        .map(l => l.split(",")[2]?.trim()).filter(d => d && d >= today).sort()[0] ?? null;
    } else if (Array.isArray(calResult)) {
      upcoming = calResult.map(r => r.reportDate).filter(d => d && d >= today).sort()[0] ?? null;
    } else if (calResult?.earningsCalendar) {
      upcoming = calResult.earningsCalendar.map(r => r.reportDate ?? r.date).filter(d => d && d >= today).sort()[0] ?? null;
    }

    const d   = overview || {};
    const int = k => { const v = parseInt(d[k]);   return isNaN(v) ? null : v; };
    const flt = k => { const v = parseFloat(d[k]); return isNaN(v) || v <= 0 ? null : v; };
    const pct = k => { const v = parseFloat(d[k]); return isNaN(v) ? null : +(v * 100).toFixed(2); };

    // EPS surprise — last 4 quarters
    let earningsSurprise = null;
    const quarters = earningsResult?.quarterlyEarnings;
    if (quarters?.length) {
      const recent = quarters.slice(0, 4).map(q => ({
        date: q.fiscalDateEnding,
        reportedEPS: parseFloat(q.reportedEPS),
        estimatedEPS: parseFloat(q.estimatedEPS),
        surprisePct: parseFloat(q.surprisePercentage),
      })).filter(q => !isNaN(q.reportedEPS));
      if (recent.length) {
        const valid = recent.filter(q => !isNaN(q.surprisePct));
        const avg = valid.length ? valid.reduce((s, q) => s + q.surprisePct, 0) / valid.length : null;
        earningsSurprise = { lastQuarters: recent, avgEpsSurprisePct: avg != null ? +avg.toFixed(2) : null, beatCount: valid.filter(q => q.surprisePct > 0).length, totalQuarters: valid.length };
      }
    }

    // Insider activity — last 90 days
    let insider = null;
    const txns = insiderResult?.data;
    if (txns?.length) {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const recent = txns.filter(t => t.transaction_date >= cutoff);
      if (recent.length) {
        let buyValue = 0, sellValue = 0, buyTxns = 0, sellTxns = 0;
        for (const t of recent) {
          const val = parseFloat(t.value) || 0;
          if (t.acquisition_or_disposal === "A") { buyValue += val; buyTxns++; }
          else if (t.acquisition_or_disposal === "D") { sellValue += val; sellTxns++; }
        }
        insider = { buyValue, sellValue, buyTxns, sellTxns, netBias: buyValue > sellValue * 1.5 ? "BUYING" : sellValue > buyValue * 1.5 ? "SELLING" : "NEUTRAL" };
      }
    }

    // Free cash flow
    let cashFlow = null;
    const qtrs = cfResult?.quarterlyReports;
    if (qtrs?.length) {
      const recent = qtrs.slice(0, 4).map(q => {
        const ocf = parseFloat(q.operatingCashflow);
        const capex = parseFloat(q.capitalExpenditures);
        return { date: q.fiscalDateEnding, operatingCashflow: isNaN(ocf) ? null : ocf, fcf: !isNaN(ocf) && !isNaN(capex) ? ocf - Math.abs(capex) : null };
      }).filter(q => q.operatingCashflow != null);
      if (recent.length) {
        const fcfVals = recent.map(q => q.fcf).filter(v => v != null);
        let fcfTrend = null;
        if (fcfVals.length >= 2) {
          const prior = fcfVals.slice(1).reduce((s, v) => s + v, 0) / (fcfVals.length - 1);
          fcfTrend = fcfVals[0] > prior ? "IMPROVING" : "DECLINING";
        }
        cashFlow = { lastFcf: fcfVals[0] ?? null, fcfTrend, quarters: recent };
      }
    }

    return {
      pe:             flt("PERatio"),
      eps:            flt("EPS"),
      revenueGrowth:  pct("QuarterlyRevenueGrowthYOY"),
      earningsGrowth: pct("QuarterlyEarningsGrowthYOY"),
      profitMargin:   pct("ProfitMargin"),
      beta:           flt("Beta"),
      marketCap:      flt("MarketCapitalization"),
      analystTarget:  flt("AnalystTargetPrice"),
      dividendYield:  pct("DividendYield"),
      sector:         d.Sector   || null,
      industry:       d.Industry || null,
      analystBuy:  (int("AnalystRatingStrongBuy")  ?? 0) + (int("AnalystRatingBuy")        ?? 0),
      analystHold:  int("AnalystRatingHold")  ?? null,
      analystSell: (int("AnalystRatingSell")        ?? 0) + (int("AnalystRatingStrongSell") ?? 0),
      nextEarningsDate:     upcoming,
      nextEarningsDaysAway: upcoming ? Math.round((new Date(upcoming) - new Date()) / 86400000) : null,
      ...(earningsSurprise ? { earningsSurprise } : {}),
      ...(insider          ? { insider }          : {}),
      ...(cashFlow         ? { cashFlow }         : {}),
    };
    fundamentalsCache.set(symbol, { data: result, ts: Date.now() });
    return result;
  } catch { return fundamentalsCache.get(symbol)?.data ?? null; }
}

async function getMacroEconomics() {
  if (!AV_KEY) return null;
  if (macroCache.data && Date.now() - macroCache.ts < MACRO_CACHE_TTL) return macroCache.data;
  try {
    const [fedRes, cpiRes, gdpRes, unempRes, y2Res, y10Res, y30Res] = await Promise.allSettled([
      avCall("FEDERAL_FUNDS_RATE", { interval: "monthly" }),
      avCall("CPI",                { interval: "monthly" }),
      avCall("REAL_GDP",           { interval: "quarterly" }),
      avCall("UNEMPLOYMENT",       { interval: "monthly" }),
      avCall("TREASURY_YIELD",     { interval: "monthly", maturity: "2year" }),
      avCall("TREASURY_YIELD",     { interval: "monthly", maturity: "10year" }),
      avCall("TREASURY_YIELD",     { interval: "monthly", maturity: "30year" }),
    ]);
    const val = r => { if (r.status !== "fulfilled") return null; const v = parseFloat(r.value?.data?.[0]?.value); return isNaN(v) ? null : +v.toFixed(2); };
    let cpiYoy = null;
    if (cpiRes.status === "fulfilled" && cpiRes.value?.data?.length >= 13) {
      const cur = parseFloat(cpiRes.value.data[0].value);
      const ago = parseFloat(cpiRes.value.data[12].value);
      if (ago > 0) cpiYoy = +((cur - ago) / ago * 100).toFixed(2);
    }
    const y2v  = val(y2Res);
    const y10v = val(y10Res);
    const y30v = val(y30Res);
    let yieldCurve = null;
    if (y2v != null && y10v != null) {
      const spread = +(y10v - y2v).toFixed(2);
      yieldCurve = spread < 0 ? "INVERTED" : spread < 0.5 ? "FLAT" : "NORMAL";
    }
    const result = { fedRate: val(fedRes), cpiYoy, gdpGrowth: val(gdpRes), unemployment: val(unempRes), yield2y: y2v, yield10y: y10v, yield30y: y30v, yieldCurve };
    // Only cache if we got real data
    if (!Object.values(result).every(v => v == null)) {
      macroCache.data = result;
      macroCache.ts = Date.now();
    }
    return result;
  } catch {
    return macroCache.data; // return stale cache on error rather than null
  }
}

async function getAvNews(symbol, limit = 8) {
  if (!AV_KEY) return [];
  const cacheKey = `av:${symbol}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < NEWS_CACHE_TTL) return cached.data;
  try {
    // Crypto symbols arrive as "BTC/USD" — AV expects "CRYPTO:BTC"
    const avTicker = symbol.includes("/") ? `CRYPTO:${symbol.split("/")[0]}` : symbol;
    const d = await avCall("NEWS_SENTIMENT", { tickers: avTicker, limit, sort: "LATEST" });
    if (!d?.feed?.length) return [];
    const result = d.feed.map(item => {
      const ts   = item.ticker_sentiment?.find(t => t.ticker === avTicker);
      const raw  = item.time_published || "";
      const date = raw.length >= 8 ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : "";
      return {
        date,
        headline:       item.title || "",
        summary:        item.summary?.slice(0, 300) || "",
        sentimentScore: parseFloat(ts?.ticker_sentiment_score ?? item.overall_sentiment_score ?? 0),
        sentimentLabel: ts?.ticker_sentiment_label || item.overall_sentiment_label || "",
        relevance:      parseFloat(ts?.relevance_score ?? 1),
        topics:         (item.topics || []).map(t => t.topic).slice(0, 3),
      };
    }).filter(n => n.relevance >= 0.3).sort((a, b) => b.relevance - a.relevance).slice(0, limit);
    newsCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch { return newsCache.get(cacheKey)?.data ?? []; }
}

// ─── Concurrency limiter ─────────────────────────────────────────────────────

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

// ─── Market data ────────────────────────────────────────────────────────────

async function fetchMarketData() {
  const results = new Map();

  // Alpha Vantage bulk quotes — single call for all ALPACA_SCAN_SYMBOLS (paid tier, delayed)
  if (AV_KEY) {
    try {
      const symbols = ALPACA_SCAN_SYMBOLS.map(s => s.symbol);
      const d = await avCall("REALTIME_BULK_QUOTES", { symbols: symbols.join(","), entitlement: "delayed" }).catch(() => null);
      const rows = d?.data ?? [];
      for (const r of rows) {
        const entry = ALPACA_SCAN_SYMBOLS.find(s => s.symbol === r.symbol);
        if (!entry) continue;
        const price = parseFloat(r.price || r.close || 0);
        const prev  = parseFloat(r.previous_close || 0);
        if (price > 0) {
          results.set(r.symbol, {
            symbol: r.symbol, price,
            change_pct: prev > 0 ? ((price - prev) / prev) * 100 : parseFloat(r.change_percentage?.replace("%","") || 0),
            assetClass: entry.assetClass, market: entry.market,
          });
        }
      }
    } catch (e) { console.warn("[WARN] AV bulk quotes error:", e.message); }
  }

  // Alpaca snapshots (real-time, overwrites AV delayed quotes)
  if (config.alpacaKey && config.alpacaSecret) {
    try {
      const symbols = ALPACA_SCAN_SYMBOLS.map(s => s.symbol);
      const snaps = await getSnapshots(symbols);
      for (const { symbol, assetClass, market } of ALPACA_SCAN_SYMBOLS) {
        const snap = snaps[symbol];
        if (!snap) continue;
        const price     = snap.latestTrade?.p || snap.dailyBar?.c || 0;
        const prevClose = snap.prevDailyBar?.c;
        const change_pct = prevClose && price ? ((price - prevClose) / prevClose) * 100 : 0;
        const dayVolume = snap.dailyBar?.v || 0;
        // Bid/ask spread from SIP latestQuote — liquidity microstructure signal for GPT
        const bidPrice = snap.latestQuote?.bp ?? null;
        const askPrice = snap.latestQuote?.ap ?? null;
        const spreadPct = bidPrice && askPrice && askPrice > 0
          ? +((askPrice - bidPrice) / askPrice * 100).toFixed(4)
          : null;
        if (price > 0) results.set(symbol, {
          symbol, price, change_pct, assetClass, market,
          dayOpen:    snap.dailyBar?.o  || null,
          dayHigh:    snap.dailyBar?.h  || null,
          dayLow:     snap.dailyBar?.l  || null,
          dayVwap:    snap.dailyBar?.vw || null,
          prevClose:  prevClose         || null,
          dayVolume,
          bidPrice, askPrice, spreadPct,
        });
      }
    } catch (e) {
      console.warn("[WARN] Alpaca snapshot error:", e.message);
    }

    // Alpaca crypto bars + real-time snapshot (intraday OHLCV + latest price)
    for (const { display } of CRYPTO_SYMBOLS) {
      try {
        const [bars, snap] = await Promise.all([
          getCryptoBars(display),
          getCryptoSnapshot(display),
        ]);
        if (bars) {
          const snapPrice = snap?.latestPrice;
          const barPrice  = bars[bars.length - 1].c;
          const price     = snapPrice ?? barPrice;
          const prev      = bars[bars.length - 2].c;
          if (price && prev) {
            results.set(display, {
              symbol: display, price, change_pct: ((price - prev) / prev) * 100,
              assetClass: "Crypto", market: "Crypto",
              // Real-time intraday context from snapshot
              dayOpen:   snap?.dayOpen   ?? null,
              dayHigh:   snap?.dayHigh   ?? null,
              dayLow:    snap?.dayLow    ?? null,
              dayVwap:   snap?.dayVwap   ?? null,
              prevClose: snap?.prevClose ?? prev,
            });
            console.log(`  [crypto] ${display} $${price.toFixed(2)} (${((price-prev)/prev*100).toFixed(2)}%)${snap ? " [live]" : " [bar]"}`);
          }
        }
      } catch (e) {
        console.warn(`[WARN] Crypto fetch error for ${display}:`, e.message);
      }
    }
  }

  // Composite pre-score: |change_pct| weighted by volume conviction
  // log10(volume_M + 1) rewards liquid, high-conviction moves (e.g. 3% on 5M vol > 5% on 50K vol)
  // Crypto has no dayVolume so falls back to pure |change_pct|
  function preScore(s) {
    const volFactor = s.dayVolume > 0 ? Math.log10(s.dayVolume / 1e6 + 1) : 1;
    return Math.abs(s.change_pct) * volFactor;
  }

  return [...results.values()]
    .filter(s => s.price > 0)
    .filter(s => s.assetClass === "Crypto" || s.dayVolume === 0 || s.dayVolume >= 50_000) // liquidity floor
    .sort((a, b) => preScore(b) - preScore(a));
}

// ─── OpenAI analysis ────────────────────────────────────────────────────────

async function analyzeSymbol(sym, portfolioContext, news = [], indicators = null, atrLevels = null, fundamentals = null, macro = null, sectorCtx = null, sessionCtx = null, fearGreed = null, hourlyIndicators = null, hourlyVolRatio = null, optionsFlow = null) {
  // Technical indicators section
  const indStr = formatIndicators(indicators, atrLevels, sym.assetClass);
  const indCtx = indStr ? `\n\n=== TECHNICAL INDICATORS ===\n${indStr}` : "";

  // Fundamentals + catalyst risk section
  const fundCtx = (() => {
    if (!fundamentals) return "";
    const lines = [];
    if (fundamentals.pe || fundamentals.eps)
      lines.push(`P/E: ${fundamentals.pe ?? "—"} | EPS: ${fundamentals.eps ?? "—"} | Rev growth YoY: ${fundamentals.revenueGrowth != null ? fundamentals.revenueGrowth.toFixed(1) + "%" : "—"} | Profit margin: ${fundamentals.profitMargin != null ? fundamentals.profitMargin.toFixed(1) + "%" : "—"}`);
    if (fundamentals.analystTarget)
      lines.push(`Analyst price target: $${fundamentals.analystTarget} | Beta: ${fundamentals.beta ?? "—"} | Mkt cap: ${fundamentals.marketCap ? "$" + (fundamentals.marketCap / 1e9).toFixed(1) + "B" : "—"}`);
    if (fundamentals.nextEarningsDate) {
      const d = fundamentals.nextEarningsDaysAway;
      const urgency = d <= 3 ? "⚠ VERY HIGH RISK" : d <= 7 ? "HIGH RISK" : d <= 14 ? "MODERATE RISK" : "LOW RISK";
      lines.push(`Next earnings: ${fundamentals.nextEarningsDate} (${d} days away — ${urgency} for short-term trades)`);
    }
    if (fundamentals.earningsSurprise) {
      const es = fundamentals.earningsSurprise;
      lines.push(`EPS surprise (last ${es.totalQuarters}Q): avg ${es.avgEpsSurprisePct != null ? (es.avgEpsSurprisePct > 0 ? "+" : "") + es.avgEpsSurprisePct + "%" : "—"} | beat ${es.beatCount}/${es.totalQuarters} quarters`);
    }
    if (fundamentals.cashFlow) {
      const cf = fundamentals.cashFlow;
      lines.push(`FCF (most recent Q): ${cf.lastFcf != null ? "$" + (cf.lastFcf / 1e9).toFixed(2) + "B" : "—"} | Trend: ${cf.fcfTrend ?? "—"}`);
    }
    if (fundamentals.insider) {
      const ins = fundamentals.insider;
      lines.push(`Insider activity (90d): ${ins.netBias === "BUYING" ? "NET BUYING" : ins.netBias === "SELLING" ? "NET SELLING" : "NEUTRAL"} | Buys: ${ins.buyTxns} txns $${(ins.buyValue / 1e6).toFixed(1)}M | Sells: ${ins.sellTxns} txns $${(ins.sellValue / 1e6).toFixed(1)}M`);
    }
    if (fundamentals.analystBuy != null) {
      const total = (fundamentals.analystBuy ?? 0) + (fundamentals.analystHold ?? 0) + (fundamentals.analystSell ?? 0);
      const sentiment = fundamentals.analystBuy > fundamentals.analystSell * 2 ? "BULLISH" : fundamentals.analystSell > fundamentals.analystBuy ? "BEARISH" : "MIXED";
      lines.push(`Analysts (${total} covering): ${fundamentals.analystBuy} buy / ${fundamentals.analystHold} hold / ${fundamentals.analystSell} sell — consensus ${sentiment}`);
    }
    return lines.length ? `\n\n=== FUNDAMENTALS & CATALYST RISK ===\n${lines.join("\n")}` : "";
  })();

  // Options flow context — OPRA real-time data (Algo Trader Plus, equities only)
  const optionsFlowCtx = (() => {
    if (!optionsFlow) return "";
    const bias = optionsFlow.bias === "bullish" ? "bullish — institutions buying calls" : optionsFlow.bias === "bearish" ? "bearish — heavy put flow" : "neutral";
    let s = `\n\n=== OPTIONS FLOW (OPRA real-time) ===\n`;
    s += `Call vol: ${optionsFlow.callVol.toLocaleString()} / OI ${optionsFlow.callOI.toLocaleString()} | Put vol: ${optionsFlow.putVol.toLocaleString()} / OI ${optionsFlow.putOI.toLocaleString()}\n`;
    s += `P/C ratio: ${optionsFlow.pcRatio ?? "—"} — flow is ${bias}`;
    if (optionsFlow.callIV || optionsFlow.putIV) s += `\nAvg IV: calls ${optionsFlow.callIV ?? "—"}% | puts ${optionsFlow.putIV ?? "—"}%`;
    if (optionsFlow.unusual.length) {
      s += `\nUnusual flow (vol >> OI): ${optionsFlow.unusual.map(u => `${u.type} ${u.ratio}× OI (${u.vol.toLocaleString()} contracts${u.iv ? `, IV=${u.iv}%` : ""})`).join(" | ")}`;
    }
    return s;
  })();

  // Macro context — AV economic indicators preferred, market proxies as fallback
  const macroCtx = macro
    ? `\n\n=== MACRO ENVIRONMENT ===\n${[
        macro.fedRate      != null ? `Fed Funds Rate: ${macro.fedRate}%`    : null,
        macro.cpiYoy       != null ? `CPI YoY: ${macro.cpiYoy}%`            : null,
        macro.gdpGrowth    != null ? `Real GDP Growth: ${macro.gdpGrowth}%` : null,
        macro.unemployment != null ? `Unemployment: ${macro.unemployment}%` : null,
        macro.yield2y      != null ? `2Y Treasury: ${macro.yield2y}%`       : null,
        macro.yield10y     != null ? `10Y Treasury: ${macro.yield10y}%`     : null,
        macro.yieldCurve   != null ? `Yield curve: ${macro.yieldCurve}`     : null,
        macro.spy ? `SPY: ${macro.spy}` : null,
        macro.vxx ? `VIX proxy (VXX): ${macro.vxx}` : null,
        macro.tlt ? `Bonds (TLT): ${macro.tlt}` : null,
      ].filter(Boolean).join(" | ")}`
    : "";

  // News — extended summaries + keyword flags
  const newsCtx = news.length
    ? `\n\n=== RECENT NEWS ===\n${formatNewsItems(news, 300)}`
    : "";

  // Portfolio context
  const portCtx = portfolioContext
    ? `\n\n=== PORTFOLIO CONTEXT ===\n${portfolioContext}`
    : "";

  // Sector relative performance context
  const sectorCtxStr = sectorCtx
    ? `\n\n=== SECTOR PERFORMANCE (TODAY) ===\n${sectorCtx}`
    : "";

  // Market session time context
  const sessionCtxStr = sessionCtx
    ? `\n\n=== MARKET SESSION ===\n${sessionCtx}`
    : "";

  // Crypto-specific analysis rules (injected only for crypto assets)
  const cryptoCtx = (() => {
    if (sym.assetClass !== "Crypto") return "";
    const fgLine = fearGreed
      ? `- Fear & Greed Index: ${fearGreed.value}/100 (${fearGreed.label}) — ${fearGreed.value >= 75 ? "EXTREME GREED: elevated reversal risk, tighten targets" : fearGreed.value >= 55 ? "GREED: momentum favours longs but watch for blow-off top" : fearGreed.value <= 25 ? "EXTREME FEAR: capitulation zone, contrarian BUY signal possible" : fearGreed.value <= 45 ? "FEAR: distribution phase, weight evidence carefully" : "NEUTRAL: no strong sentiment bias"}`
      : "";
    // BTC benchmark injected via sym._btcChange (set by caller for altcoins)
    const btcLine = sym._btcChange != null && sym.symbol !== "BTC/USD"
      ? `- BTC benchmark: ${sym._btcChange >= 0 ? "+" : ""}${sym._btcChange.toFixed(2)}% today — assess if this move is BTC-driven or ${sym.symbol}-specific (altcoins typically move 1.5-3× BTC)`
      : "";
    // Crypto market regime from SMA200 (if available)
    const regimeLine = indicators?.sma200 && indicators?.vsma200Pct != null
      ? `- Crypto market regime: price is ${indicators.vsma200Pct > 0 ? `+${indicators.vsma200Pct}% ABOVE` : `${indicators.vsma200Pct}% BELOW`} SMA200 — ${indicators.vsma200Pct > 0 ? "BULL regime (SMA200 acts as major support)" : "BEAR regime (SMA200 acts as major resistance)"}`
      : "- SMA200 not yet available — use SMA50 as primary trend filter";
    // Hourly indicator summary — short-term momentum context (last 72h)
    const hourlyLine = (() => {
      if (!hourlyIndicators) return "";
      const rsi   = hourlyIndicators.rsi14 != null   ? `RSI14=${hourlyIndicators.rsi14}${hourlyIndicators.rsi14 >= 75 ? " ⚠ overbought" : hourlyIndicators.rsi14 <= 25 ? " ⚠ oversold" : ""}` : null;
      const macd  = hourlyIndicators.macdHist != null ? `MACD hist=${hourlyIndicators.macdHist > 0 ? "+" : ""}${hourlyIndicators.macdHist.toFixed(4)} (${hourlyIndicators.macdHist > 0 ? "bullish" : "bearish"} momentum)` : null;
      const vs20  = hourlyIndicators.vsma20Pct != null ? `vs SMA20: ${hourlyIndicators.vsma20Pct > 0 ? "+" : ""}${hourlyIndicators.vsma20Pct.toFixed(2)}%` : null;
      const vol   = hourlyVolRatio != null ? `vol ratio vs 10h avg: ${hourlyVolRatio}× (${hourlyVolRatio >= 1.5 ? "HIGH — confirms move" : hourlyVolRatio <= 0.7 ? "LOW — weak conviction" : "normal"})` : null;
      const parts = [rsi, macd, vs20, vol].filter(Boolean);
      return parts.length ? `- Hourly timeframe (last 72h): ${parts.join(" | ")}` : "";
    })();
    return `\n\n=== CRYPTO-SPECIFIC ANALYSIS RULES ===
- Market is 24/7: no session gaps; momentum can continue or reverse overnight without warning
- RSI thresholds: overbought=80 (not 70), oversold=20 (not 30) — crypto regularly runs to extremes
- ATR% today: ${indicators?.atrPct != null ? indicators.atrPct.toFixed(2) + "%" : "est. 3-6%"} — a daily range of 3-6% is normal; do NOT tighten stops below 1.5× ATR
- Minimum R/R ratio required: 2.5:1 (higher reward threshold needed to justify higher risk)
- No bracket orders on Alpaca crypto: stop/target managed by daemon trailing stop only
- Position size cap: allocation_pct must not exceed 5 — never over-concentrate in a single crypto
- Key psychological levels (round numbers, prior ATH/ATL) act as the strongest S/R for crypto
- On-chain data unavailable — weight technical structure + volume confirmation + macro risk appetite
${regimeLine}
${hourlyLine}
${btcLine}
${fgLine}`.trim();
  })();

  // ATR constraint hint
  const atrHint = atrLevels?.atrBuyStop
    ? `\n- Use ATR-based levels as anchors: BUY stop ≈ ${atrLevels.atrBuyStop}, BUY target ≈ ${atrLevels.atrBuyTarget}. You may adjust up to ±30% but must stay directionally correct. For crypto, keep stop within 8% of entry and target within 14% of entry.`
    : "";

  // Intraday price action from Alpaca real-time snapshot
  const intradayCtx = (() => {
    const { price, dayOpen, dayHigh, dayLow, dayVwap, prevClose } = sym;
    if (!dayOpen || !dayHigh || !dayLow) return "";
    const parts = [];
    const dayRange = dayHigh - dayLow;
    if (prevClose) {
      const gapPct = +((dayOpen - prevClose) / prevClose * 100).toFixed(2);
      parts.push(`Gap at open: ${gapPct > 0 ? "+" : ""}${gapPct}%`);
    }
    const fromOpenPct = +((price - dayOpen) / dayOpen * 100).toFixed(2);
    parts.push(`From open: ${fromOpenPct > 0 ? "+" : ""}${fromOpenPct}%`);
    if (dayRange > 0) {
      const rangePct = Math.round(((price - dayLow) / dayRange) * 100);
      parts.push(`Day range pos: ${rangePct}% (low $${dayLow.toFixed(2)} → high $${dayHigh.toFixed(2)})`);
    }
    if (dayVwap) {
      const vsVwap = +((price - dayVwap) / dayVwap * 100).toFixed(2);
      parts.push(`vs VWAP: ${vsVwap > 0 ? "+" : ""}${vsVwap}%`);
    }
    if (sym.spreadPct != null) {
      const liq = sym.spreadPct < 0.05 ? "tight/liquid" : sym.spreadPct < 0.2 ? "normal" : "wide/illiquid";
      parts.push(`Bid/ask spread: ${sym.spreadPct.toFixed(3)}% (${liq})`);
    }
    return `\n\n=== INTRADAY SESSION ===\n${parts.join(" | ")}`;
  })();

  const isCryptoAsset = sym.assetClass === "Crypto";
  const scoringInstruction = isCryptoAsset
    ? `3. Score on a CRYPTO-NATIVE scale — do NOT penalise for missing equity fundamentals (there are none for crypto):
   - 80–100: technicals bullish/bearish AND Fear & Greed aligned AND BTC regime supportive — all three crypto pillars agree
   - 65–79: two of three pillars agree, or technicals strongly one-directional with no conflicting signals
   - 50–64: mixed signals, one pillar contradicts, or low-conviction technical setup
   - below 50: conflicting signals or clearly unfavourable setup
   HIGH conviction requires score ≥ 80 with at least two pillars aligned.`
    : `3. Score based on weight of evidence — 80+ when the majority of available factors (technicals, fundamentals, macro, news) agree directionally. Full confluence across all four is ideal but not required; 2-3 strongly aligned factors with no major contradicting signal is sufficient for HIGH conviction.`;

  const thesisFormat = isCryptoAsset
    ? `"investor_thesis":"<2-3 sentence crypto thesis covering regime, sentiment, and setup>","swing_thesis":"<1-sentence short-term entry rationale>"`
    : `"swing_thesis":"<1-2 sentence short-term trade rationale>","investor_thesis":"<1-2 sentence medium-term thesis>"`;

  const prompt = `You are a senior portfolio analyst covering global markets. Perform a rigorous multi-factor analysis.

=== ASSET ===
Symbol: ${sym.symbol} | Class: ${sym.assetClass} | Market: ${sym.market}
Price: ${sym.price} (1d: ${(sym.change_pct || 0).toFixed(2)}%)
Today: ${new Date().toISOString().slice(0, 10)}${sessionCtxStr}${intradayCtx}${indCtx}${fundCtx}${optionsFlowCtx}${macroCtx}${sectorCtxStr}${newsCtx}${portCtx}${cryptoCtx}

=== INSTRUCTIONS ===
1. First, reason through each available data point (technical, fundamental, macro, news) in the "reasoning" field.
2. Produce a trading signal based on the WEIGHT OF EVIDENCE across ALL available factors.
${scoringInstruction}
4. IMPORTANT price level rules:
   - BUY: stop < entry < target (stop must be LESS than entry; target must be GREATER)
   - SELL: target < entry < stop (target must be LESS than entry; stop must be GREATER)${atrHint}
5. allocation_pct reflects conviction AND existing exposure.

Return ONLY valid JSON, no markdown:
{"reasoning":"<3-4 sentence chain-of-thought covering technicals, fundamentals, macro, news>","symbol":"${sym.symbol}","assetClass":"${sym.assetClass}","sector":"<sector or macro theme>","market":"${sym.market}","price":${sym.price},"change_pct":${sym.change_pct},"trend":"up|down|sideways","signal":"BUY|SELL|HOLD|WATCH","score":<0-100>,"conviction":"HIGH|MEDIUM|LOW","horizon":"swing|medium|long","momentum":<0-100>,"entry":<number>,"target":<number>,"stop":<number>,"allocation_pct":<1-10>,"risk_reward":<number>,${thesisFormat},"sentiment":"bullish|neutral|bearish"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: config.aiModel || "o4-mini", max_completion_tokens: 8000, reasoning_effort: "high", messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
  const text = data.choices?.[0]?.message?.content || "";
  const finishReason = data.choices?.[0]?.finish_reason;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in GPT response. Reason: ${finishReason}. Got: ${text.slice(0, 200)}`);
  const r = JSON.parse(match[0]);

  // Hard-clamp crypto stop/target to prevent GPT from generating unrealistically wide levels.
  // Crypto ATR can be 10-20% of price; enforce a max 8% stop / 14% target from entry.
  if (sym.assetClass === "Crypto" && r.entry && r.stop && r.target) {
    const ref = r.entry;
    const MAX_STOP_PCT   = 0.08;
    const MAX_TARGET_PCT = 0.14;
    if (r.signal === "BUY") {
      r.stop   = Math.max(r.stop,   +(ref * (1 - MAX_STOP_PCT)).toFixed(4));
      r.target = Math.min(r.target, +(ref * (1 + MAX_TARGET_PCT)).toFixed(4));
    } else if (r.signal === "SELL") {
      r.stop   = Math.min(r.stop,   +(ref * (1 + MAX_STOP_PCT)).toFixed(4));
      r.target = Math.max(r.target, +(ref * (1 - MAX_TARGET_PCT)).toFixed(4));
    }
  }

  // Validate R/R math
  if (r.signal === "BUY" && r.entry && r.stop && r.target) {
    r._bracketInvalid = r.stop >= r.entry || r.target <= r.entry;
  } else if (r.signal === "SELL" && r.entry && r.stop && r.target) {
    r._bracketInvalid = r.stop <= r.entry || r.target >= r.entry;
  }
  return r;
}

// ─── Telegram ───────────────────────────────────────────────────────────────

function _etMins() {
  const now = new Date();
  const yr = now.getUTCFullYear();
  const mar1 = new Date(Date.UTC(yr, 2, 1));
  const dstStart = new Date(Date.UTC(yr, 2, 8 + (7 - mar1.getUTCDay()) % 7));
  const nov1 = new Date(Date.UTC(yr, 10, 1));
  const dstEnd = new Date(Date.UTC(yr, 10, 1 + (7 - nov1.getUTCDay()) % 7));
  const offsetH = (now >= dstStart && now < dstEnd) ? -4 : -5;
  const et = new Date(now.getTime() + offsetH * 3600000);
  if (et.getUTCDay() === 0 || et.getUTCDay() === 6) return null;
  return et.getUTCHours() * 60 + et.getUTCMinutes();
}
function isUSMarketOpenNow() { const m = _etMins(); return m != null && m >= 570 && m < 960; }
function isPreMarket()       { const m = _etMins(); return m != null && m >= 240 && m < 570; }

function getETSession() {
  const mins = _etMins();
  if (mins === null)                       return "⛔ Weekend";
  if (mins < 240 || mins >= 1200)          return "🌙 Overnight (closed)";
  if (mins < 570)                          return "🌅 Pre-market";
  if (mins < 960)                          return "✅ Market open";
  if (mins < 1200)                         return "🌆 After-hours (closed)";
  return "🌙 Overnight (closed)";
}

async function tgSend(text) {
  if (!TELEGRAM_TOKEN || !config.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegramChatId, parse_mode: "HTML", text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) { console.error(`[Telegram error] ${e.message}`); }
}

async function alertSignal(r) {
  const emoji = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "🟡";
  const market = r.market || r.assetClass;
  const etTime = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true });
  await tgSend(
    `${emoji} <b>${r.signal}: ${r.symbol}</b> [${market}] · ${etTime} ET\n` +
    `🕐 ${getETSession()}\n` +
    `📊 Score: ${r.score} | Conviction: ${r.conviction}\n` +
    (r.sector ? `🏷 Sector: ${r.sector}\n` : "") +
    (r.target ? `🎯 Target: ${r.target} | 🛑 Stop: ${r.stop}\n` : "") +
    (r.swing_thesis || r.investor_thesis ? `\n💡 ${(r.swing_thesis || r.investor_thesis).slice(0, 300)}` : "")
  );
}

async function alertPremarketSignal(r) {
  const market = r.market || r.assetClass;
  await tgSend(
    `📋 <b>Pre-market watchlist: ${r.symbol}</b> [${market}]\n` +
    `🕐 ${getETSession()}\n` +
    `📊 Score: ${r.score} | Conviction: ${r.conviction}\n` +
    (r.target ? `🎯 Target: $${r.target} | 🛑 Stop: $${r.stop}\n` : "") +
    `💡 ${(r.swing_thesis || r.investor_thesis || "").slice(0, 250)}`
  );
}

async function alertOrder(symbol, side, notional, extra = "") {
  const emoji = side === "buy" ? "🛒" : "📤";
  await tgSend(`${emoji} <b>Order: ${side.toUpperCase()} ${symbol}</b>\nAmount: $${Number(notional).toFixed(2)}${extra}`);
}

// ─── Auto-trade ─────────────────────────────────────────────────────────────

// Re-anchor GPT's stop/target to the live Alpaca price at order time.
// GPT may have used a slightly stale or delayed price as reference; the live price
// from Alpaca's snapshot is what the market order will actually fill near.
// Strategy: if price drifted >0.5% from GPT's entry, shift the bracket levels
// proportionally so the R/R ratio is preserved relative to the actual fill price.
// If ATR levels are available (pre-anchored to live price), prefer those instead.
function reanchorBracket(signal, livePrice, gptEntry, gptStop, gptTarget, atrLevels) {
  if (!livePrice || !gptEntry || !gptStop || !gptTarget) {
    return { stop: gptStop, target: gptTarget, reanchored: false };
  }
  const drift = (livePrice - gptEntry) / gptEntry; // signed drift
  if (Math.abs(drift) < 0.005) {
    // Within 0.5% — GPT's levels are close enough, use as-is
    return { stop: gptStop, target: gptTarget, reanchored: false };
  }

  // Price drifted — re-anchor to live price
  if (signal === "BUY") {
    // Prefer ATR levels: they were computed from live price before GPT was called
    if (atrLevels?.atrBuyStop && atrLevels?.atrBuyTarget) {
      return { stop: atrLevels.atrBuyStop, target: atrLevels.atrBuyTarget, reanchored: true, method: "ATR" };
    }
    // Fallback: shift GPT's absolute stop/target distances to live price
    const stopDist   = gptEntry - gptStop;   // positive = below entry
    const targetDist = gptTarget - gptEntry; // positive = above entry
    return {
      stop:       +(livePrice - stopDist).toFixed(4),
      target:     +(livePrice + targetDist).toFixed(4),
      reanchored: true, method: "proportional",
    };
  } else { // SELL short
    if (atrLevels?.atrSellStop && atrLevels?.atrSellTarget) {
      return { stop: atrLevels.atrSellStop, target: atrLevels.atrSellTarget, reanchored: true, method: "ATR" };
    }
    const stopDist   = gptStop   - gptEntry;
    const targetDist = gptEntry  - gptTarget;
    return {
      stop:       +(livePrice + stopDist).toFixed(4),
      target:     +(livePrice - targetDist).toFixed(4),
      reanchored: true, method: "proportional",
    };
  }
}

// bpBuckets = { equity, crypto, initialEquity, initialCrypto } — mutated in place
async function maybeAutoTrade(r, currentPositions, bpBuckets, circuitBreaker, livePrice, atrLevels, indicators, fearGreed, marketRegime, weeklyTrend, allResults) {
  if (!config.autoTradeEnabled || !config.alpacaKey || !config.alpacaSecret) {
    console.log(`  ⚡ ${r.symbol}: autoTrade=${config.autoTradeEnabled} key=${!!config.alpacaKey} secret=${!!config.alpacaSecret}`);
    return;
  }
  const isCrypto = r.assetClass === "Crypto";
  const isEquity = r.assetClass === "Equity" || r.assetClass === "ETF";
  if (!isCrypto && !isEquity) {
    console.log(`  ⚡ ${r.symbol}: assetClass "${r.assetClass}" not supported for auto-trade`);
    return;
  }

  // No equity auto-trades during pre-market (analysis + alerts only)
  if (isEquity && isPreMarket()) {
    console.log(`  ⚡ ${r.symbol}: pre-market — analysis only, no auto-trade`);
    return;
  }

  // Per-asset-class thresholds
  const effectiveMinScore      = isCrypto ? (config.cryptoMinScore       ?? 80)     : (config.minScore      ?? 75);
  const effectiveMinConviction = isCrypto ? (config.cryptoMinConviction   ?? "HIGH") : (config.minConviction  ?? "HIGH");
  const fgMaxBuy               = isCrypto ? (config.cryptoFearGreedMaxBuy ?? 80)    : null;

  // Route to the correct bucket
  const bucketKey     = isCrypto ? "crypto" : "equity";
  const remainingBP   = bpBuckets[bucketKey];
  const initialBP     = isCrypto ? bpBuckets.initialCrypto : bpBuckets.initialEquity;

  // Use live Alpaca price for sizing; fall back to GPT's echoed price
  const orderPrice = livePrice ?? r.price;

  const existingPosition = currentPositions.get(r.symbol);
  const alreadyInvested  = existingPosition?.marketValue ?? 0;
  const targetNotional   = (initialBP || 0) * (r.allocation_pct / 100);
  const notional         = Math.max(0, targetNotional - alreadyInvested);

  if (r.signal === "BUY") {
    console.log(`  🔍 ${r.symbol}: evaluating BUY — ${bucketKey} bucket $${remainingBP?.toFixed(0) ?? "?"} remaining · target=$${targetNotional.toFixed(0)} · notional=$${notional.toFixed(0)} · held=$${alreadyInvested.toFixed(0)}`);
    if (pendingSells.has(r.symbol)) {
      console.log(`  🔄 ${r.symbol}: signal reversed to BUY — cancelling pending SELL`);
      pendingSells.delete(r.symbol);
    }
    if (circuitBreaker.tripped) { console.log(`  ⚡ ${r.symbol}: circuit breaker tripped`); return; }
    if (r.score < effectiveMinScore) { console.log(`  ⚡ ${r.symbol}: score ${r.score} < ${effectiveMinScore} (${isCrypto ? "crypto" : "equity"} threshold)`); return; }
    if (r.conviction !== "HIGH" && effectiveMinConviction === "HIGH") { console.log(`  ⚡ ${r.symbol}: conviction ${r.conviction} below ${isCrypto ? "crypto" : "equity"} threshold`); return; }
    // Fear & Greed gate — block crypto buys in Extreme Greed territory
    if (isCrypto && fgMaxBuy != null && fearGreed?.value >= fgMaxBuy) {
      console.log(`  ⚡ ${r.symbol}: Fear & Greed ${fearGreed.value} (${fearGreed.label}) >= ${fgMaxBuy} — blocking buy in Extreme Greed`);
      return;
    }
    // Market regime gate — suppress equity BUY signals in confirmed BEAR market
    if (config.regimeGateEnabled && !isCrypto && marketRegime?.regime === "BEAR") {
      console.log(`  ⚡ ${r.symbol}: BUY suppressed — market regime BEAR (SPY ${marketRegime.aboveSma200 ? "above" : "BELOW"} 200-SMA)`);
      return;
    }
    // Earnings blackout — block auto-trades within N days of earnings
    const fundsCached = fundamentalsCache.get(r.symbol);
    const daysToEarnings = fundsCached?.data?.nextEarningsDaysAway;
    const blackoutDays = config.earningsBlackoutDays ?? 2;
    if (daysToEarnings != null && daysToEarnings <= blackoutDays) {
      console.log(`  ⚡ ${r.symbol}: earnings in ${daysToEarnings}d (blackout ≤${blackoutDays}d) — auto-trade blocked`);
      return;
    }
    // Weekly trend gate — block BUY if equity is in a weekly downtrend
    if (config.weeklyTrendGateEnabled && !isCrypto && weeklyTrend?.trend === "down") {
      console.log(`  ⚡ ${r.symbol}: weekly trend DOWN (price ${weeklyTrend.priceAboveSma20 ? "above" : "below"} wkly SMA20, SMA20 ${weeklyTrend.sma20Rising ? "rising" : "falling"}) — BUY blocked`);
      return;
    }
    // Sector exposure cap — prevent over-concentration in a single sector
    if (config.maxSectorExposurePct && r.sector && allResults) {
      const sectorSyms = allResults.filter(s => s.sector === r.sector).map(s => s.symbol);
      const sectorValue = sectorSyms.reduce((sum, sym) => sum + (currentPositions.get(sym)?.marketValue ?? 0), 0);
      const totalBP = (bpBuckets?.initialEquity ?? 0) + (bpBuckets?.initialCrypto ?? 0);
      if (totalBP > 0 && sectorValue / totalBP * 100 >= config.maxSectorExposurePct) {
        console.log(`  ⚡ ${r.symbol}: sector "${r.sector}" at ${(sectorValue / totalBP * 100).toFixed(1)}% ≥ ${config.maxSectorExposurePct}% cap — skip`);
        return;
      }
    }
    if (alreadyInvested >= targetNotional * 0.9) { console.log(`  ⚡ ${r.symbol}: already holding $${alreadyInvested.toFixed(0)} (target $${targetNotional.toFixed(0)})`); return; }
    if (existingPosition && (existingPosition.unrealizedPl ?? 0) < 0) {
      console.log(`  ⚡ ${r.symbol}: skipping add — position is down $${Math.abs(existingPosition.unrealizedPl).toFixed(2)} (${existingPosition.unrealizedPlPct?.toFixed(2)}%) — no averaging down`);
      return;
    }
    if (notional < 1) { console.log(`  ⚡ ${r.symbol}: allocation too small ($${notional.toFixed(2)})`); return; }
    if (remainingBP !== null && notional > remainingBP) { console.log(`  ⚡ ${r.symbol}: insufficient ${bucketKey} bucket ($${remainingBP?.toFixed(0)} available < $${notional.toFixed(0)} needed)`); return; }

    try {
      if (isCrypto) {
        // ── Crypto order: gtc, notional, no bracket (Alpaca crypto API constraints) ──
        // Volatility-adjusted sizing: scale down notional by ATR ratio vs baseline stock ATR
        const baseAtrPct   = 1.5; // typical stock daily ATR%
        const cryptoAtrPct = Math.max(indicators?.atrPct ?? 4, 2); // floor at 2%
        const volAdj       = Math.min(1, baseAtrPct / cryptoAtrPct); // never scale UP
        // Hard cap: no single crypto position > 5% of buying power
        const maxCryptoAmt = (bpBuckets.initialCrypto || 0) * 0.05;
        const cryptoNotional = Math.min(notional * volAdj, maxCryptoAmt);
        if (cryptoNotional < 10) { console.log(`  ⚡ ${r.symbol}: crypto notional $${cryptoNotional.toFixed(2)} below Alpaca $10 minimum`); return; }
        console.log(`  ⚙ ${r.symbol}: crypto vol-adj: ATR=${cryptoAtrPct.toFixed(1)}% → ${(volAdj*100).toFixed(0)}% · $${notional.toFixed(0)} → $${cryptoNotional.toFixed(0)} (cap $${maxCryptoAmt.toFixed(0)})`);
        // Cancel any open orders for this symbol first — avoids wash-trade rejection
        const cancelled = await cancelOpenOrdersForSymbol(r.symbol);
        if (cancelled) console.log(`  🗑 ${r.symbol}: cancelled ${cancelled} open order(s) before buy`);
        let buyOrder;
        try {
          buyOrder = await alpacaPost("/v2/orders", { symbol: r.symbol, notional: cryptoNotional.toFixed(2), side: "buy", type: "market", time_in_force: "gtc" });
        } catch (washErr) {
          if (washErr.message?.toLowerCase().includes("wash trade")) {
            console.warn(`  ⚠ ${r.symbol}: wash trade rejection — waiting 5s and retrying`);
            await new Promise(r => setTimeout(r, 5000));
            buyOrder = await alpacaPost("/v2/orders", { symbol: r.symbol, notional: cryptoNotional.toFixed(2), side: "buy", type: "market", time_in_force: "gtc" });
          } else {
            throw washErr;
          }
        }
        try { addTrade({ symbol: r.symbol, side: "buy", notional: cryptoNotional, assetClass: r.assetClass, signalScore: r.score, signalConviction: r.conviction, aiModel: config.aiModel || "o4-mini" }, "daemon"); } catch {}
        const trailPct = config.cryptoTrailingStopPct || 3;

        // Place a stop_limit sell order on Alpaca once buy fills (trailing_stop not supported for crypto)
        let stopNote = `trail-stop ${trailPct}% (daemon-managed)`;
        try {
          const filledQty = await waitForFill(buyOrder.id);
          if (filledQty && parseFloat(filledQty) > 0) {
            const stopPrice  = +(orderPrice * (1 - trailPct / 100)).toFixed(4);
            const limitPrice = +(stopPrice * 0.995).toFixed(4);
            await alpacaPost("/v2/orders", {
              symbol:         r.symbol,
              qty:            filledQty,
              side:           "sell",
              type:           "stop_limit",
              time_in_force:  "gtc",
              stop_price:     stopPrice.toFixed(4),
              limit_price:    limitPrice.toFixed(4),
            });
            stopNote = `stop_limit $${stopPrice} placed on Alpaca`;
            console.log(`  🛡 ${r.symbol}: stop_limit placed · qty=${filledQty} · stop=$${stopPrice} · limit=$${limitPrice}`);
          } else {
            console.log(`  ⚠ ${r.symbol}: buy not filled within 10s — stop_limit not placed`);
          }
        } catch (e) {
          console.log(`  ⚠ ${r.symbol}: stop_limit order failed: ${e.message}`);
        }

        try {
          upsertPositionMeta(r.symbol, {
            entryPrice:   orderPrice,
            entryDate:    new Date().toISOString(),
            targetPrice:  r.target || null,
            stopPrice:    r.stop   || null,
            highWater:    orderPrice,
            trailingStop: +(orderPrice * (1 - trailPct / 100)).toFixed(4),
            bracket:      false,
          });
        } catch {}
        circuitBreaker.failures = 0;
        bpBuckets[bucketKey] -= cryptoNotional;
        currentPositions.set(r.symbol, { qty: (existingPosition?.qty ?? 0), avgPrice: orderPrice, marketValue: alreadyInvested + cryptoNotional });
        const existingNote = alreadyInvested > 0 ? ` (adding to $${alreadyInvested.toFixed(0)} existing)` : "";
        console.log(`  🪙 Bought crypto ${r.symbol} · $${cryptoNotional.toFixed(0)}${existingNote} | TP ${r.target} / ${stopNote}`);
        await alertOrder(r.symbol, "buy", cryptoNotional, `${existingNote} | ${stopNote}`);
      } else {
        // ── Equity / ETF order: day, qty-based, bracket if enabled ──
        // Re-anchor bracket levels to live price — GPT's entry may reflect delayed data
        const anchored = reanchorBracket("BUY", orderPrice, r.entry, r.stop, r.target, atrLevels);
        if (anchored.reanchored) {
          const driftPct = r.entry ? ((orderPrice - r.entry) / r.entry * 100).toFixed(2) : "?";
          console.log(`  ⚙ ${r.symbol}: price drifted ${driftPct}% from GPT entry — re-anchored bracket via ${anchored.method}: stop=$${anchored.stop} target=$${anchored.target}`);
        }

        const bracketValid  = anchored.stop < orderPrice && anchored.target > orderPrice;
        const wantBracket   = config.bracketOrdersEnabled && anchored.stop && anchored.target && bracketValid;
        const fractionalQty = parseFloat((notional / orderPrice).toFixed(6));
        const wholeQty      = Math.floor(fractionalQty);
        const canBracket    = wantBracket && wholeQty >= 1;
        const qty           = canBracket ? wholeQty : fractionalQty;
        const body = {
          symbol: r.symbol, qty, side: "buy", type: "market", time_in_force: canBracket ? "gtc" : "day",
          ...(canBracket && {
            order_class: "bracket",
            take_profit: { limit_price: anchored.target.toFixed(2) },
            stop_loss:   { stop_price:  anchored.stop.toFixed(2) },
          }),
        };
        const eqBuyOrder = await alpacaPost("/v2/orders", body);
        try { addTrade({ symbol: r.symbol, side: "buy", notional, assetClass: r.assetClass, stop: anchored.stop, target: anchored.target, bracket: canBracket, signalScore: r.score, signalConviction: r.conviction, aiModel: config.aiModel || "o4-mini" }, "daemon"); } catch {}
        try {
          const trailPct = config.trailingStopPct || 5;
          upsertPositionMeta(r.symbol, {
            entryPrice:   orderPrice,
            entryDate:    new Date().toISOString(),
            targetPrice:  anchored.target || r.target || null,
            stopPrice:    anchored.stop   || r.stop   || null,
            highWater:    orderPrice,
            trailingStop: config.trailingStopEnabled ? +(orderPrice * (1 - trailPct / 100)).toFixed(4) : null,
            bracket:      canBracket,
          });
        } catch {}
        // For non-bracket orders: place native Alpaca trailing stop (Algo Trader Plus)
        // This is more reliable than daemon management — fires 24/5 without daemon running
        if (!canBracket && config.trailingStopEnabled && eqBuyOrder?.id) {
          const trailPct = config.trailingStopPct || 5;
          (async () => {
            try {
              const filledQty = await waitForFill(eqBuyOrder.id, 15_000);
              if (filledQty && parseFloat(filledQty) > 0) {
                const trailOrder = await alpacaPost("/v2/orders", {
                  symbol: r.symbol, qty: String(filledQty), side: "sell",
                  type: "trailing_stop", trail_percent: trailPct, time_in_force: "gtc",
                });
                equityTrailOrders.set(r.symbol, { id: trailOrder.id, trail_percent: trailPct });
                // null trailingStop = Alpaca-managed, prevents daemon from double-managing
                try { updatePositionHighWater(r.symbol, orderPrice, null); } catch {}
                console.log(`  🛡 ${r.symbol}: native trailing stop placed · qty=${filledQty} · trail=${trailPct}%`);
                // Update wsTrailMeta to remove daemon management for this position
                wsTrailMeta.delete(r.symbol);
              }
            } catch (e) {
              console.warn(`  ⚠ ${r.symbol}: native trailing stop failed: ${e.message} — daemon will manage`);
            }
          })();
        }
        circuitBreaker.failures = 0;
        bpBuckets[bucketKey] -= notional;
        if (r._bracketInvalid)           console.log(`  ⚠ ${r.symbol}: GPT gave invalid R/R (stop=$${r.stop} entry=$${r.entry} target=$${r.target}) — using re-anchored levels`);
        if (!canBracket && wantBracket) console.log(`  ℹ ${r.symbol}: bracket skipped — qty ${fractionalQty.toFixed(4)} is fractional (need ≥1 whole share)`);
        if (!bracketValid)              console.log(`  ℹ ${r.symbol}: bracket skipped — levels invalid after re-anchor: stop=$${anchored.stop} price=$${orderPrice} target=$${anchored.target}`);
        currentPositions.set(r.symbol, { qty: (existingPosition?.qty ?? 0) + qty, avgPrice: orderPrice, marketValue: alreadyInvested + notional });
        const existingNote = alreadyInvested > 0 ? ` (adding to $${alreadyInvested.toFixed(0)} existing)` : "";
        const bracketNote  = canBracket ? ` | SL $${anchored.stop.toFixed(2)} / TP $${anchored.target.toFixed(2)}` : "";
        console.log(`  🛒 Bought ${r.symbol} · $${notional.toFixed(0)}${existingNote}${bracketNote}`);
        await alertOrder(r.symbol, "buy", notional, `${existingNote}${bracketNote}`);
      }
    } catch (e) {
      circuitBreaker.failures++;
      if (circuitBreaker.failures >= 3) { circuitBreaker.tripped = true; console.log("  ⛔ Circuit breaker tripped"); }
      console.error(`  ⚠ BUY failed ${r.symbol}: ${e.message} | notional=$${notional?.toFixed(2)} price=$${livePrice} score=${r.score} conviction=${r.conviction} bracket=${config.bracketOrdersEnabled}`);
    }
  } else if (r.signal === "SELL") {
    if (!existingPosition) {
      console.log(`  ⚡ ${r.symbol}: SELL signal but no open position — skipping`);
      return;
    }
    const isPendingRetry = pendingSells.get(r.symbol)?.type === "signal";
    if (isPendingRetry) console.log(`  ♻ ${r.symbol}: fresh scan confirms SELL — retrying failed close`);
    try {
      const cancelled = await cancelOpenOrdersForSymbol(r.symbol);
      if (cancelled) console.log(`  🗑 ${r.symbol}: cancelled ${cancelled} open order(s) before sell`);
      const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(r.symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
      try { addTrade({ symbol: r.symbol, side: "sell", notional: alreadyInvested, assetClass: r.assetClass, signalScore: r.score, signalConviction: r.conviction, aiModel: config.aiModel || "o4-mini" }, "daemon"); } catch {}
      try { deletePositionMeta(r.symbol); } catch {}
      currentPositions.delete(r.symbol);
      bpBuckets[bucketKey] += alreadyInvested;
      pendingSells.delete(r.symbol);
      console.log(`  📤 Closed ${r.symbol} · freed $${alreadyInvested.toFixed(0)}`);
      await alertOrder(r.symbol, "sell", alreadyInvested);
    } catch (e) {
      const prev = pendingSells.get(r.symbol) ?? { attempts: 0 };
      pendingSells.set(r.symbol, { marketValue: alreadyInvested, assetClass: r.assetClass, attempts: prev.attempts + 1, lastAttempt: Date.now(), reason: "SELL signal", type: "signal" });
      console.error(`  ⚠ Close failed for ${r.symbol}: ${e.message} — queued for retry (attempt ${prev.attempts + 1})`);
    }
  }
}

// ─── Crypto stop orders (module-level, rebuilt on startup and each scan) ────
const cryptoStopOrders = new Map(); // symbol → { id, stop_price, qty }

async function rebuildCryptoStopOrders() {
  try {
    const openOrders = await alpacaGet("/v2/orders?status=open&limit=500");
    cryptoStopOrders.clear();
    for (const o of (Array.isArray(openOrders) ? openOrders : [])) {
      if (o.type === "stop_limit" && o.side === "sell" && o.asset_class === "crypto") {
        cryptoStopOrders.set(o.symbol, { id: o.id, stop_price: parseFloat(o.stop_price), qty: o.qty });
      }
    }
    if (cryptoStopOrders.size) console.log(`  Crypto stop orders loaded: ${[...cryptoStopOrders.keys()].join(", ")}`);
  } catch (e) {
    console.warn(`  Could not load crypto stop orders: ${e.message}`);
  }
}

// Equity native trailing stop orders (standalone, Algo Trader Plus)
const equityTrailOrders = new Map(); // symbol → { id, trail_percent }

async function rebuildEquityTrailOrders() {
  try {
    const openOrders = await alpacaGet("/v2/orders?status=open&limit=500");
    equityTrailOrders.clear();
    for (const o of (Array.isArray(openOrders) ? openOrders : [])) {
      if (o.type === "trailing_stop" && o.side === "sell" &&
          (o.asset_class === "us_equity" || o.asset_class === "us_fund")) {
        equityTrailOrders.set(o.symbol, { id: o.id, trail_percent: o.trail_percent });
      }
    }
    if (equityTrailOrders.size) {
      console.log(`  Equity trail orders loaded: ${[...equityTrailOrders.keys()].join(", ")}`);
    }
  } catch (e) {
    console.warn(`  Could not load equity trail orders: ${e.message}`);
  }
}

// ─── WebSocket real-time trailing stop monitor (Algo Trader Plus) ────────────
// Tracks positions between scan cycles to update trailing stops in real-time
let wsEquityMonitor = null;
let wsCryptoMonitor = null;
const wsTrailMeta   = new Map(); // symbol → { highWater, trailingStop, assetClass, qty, marketValue }

function syncWsTrailMeta(positions, allMeta) {
  // Update wsTrailMeta from current positions + position_meta
  // Crypto: update existing entries, add new ones
  // Equity: only track positions with daemon-managed trailing stops (trailingStop != null)
  for (const [symbol, pos] of positions.entries()) {
    const meta = allMeta?.get(symbol);
    if (!meta) continue;
    const assetClass = symbol.includes('/') ? 'Crypto' : (meta.asset_class || 'Equity');
    if (assetClass !== 'Crypto' && (meta.trailing_stop == null || equityTrailOrders.has(symbol))) continue;
    wsTrailMeta.set(symbol, {
      highWater:    meta.high_water    || pos.avgPrice || 0,
      trailingStop: meta.trailing_stop || 0,
      assetClass,
      qty:          String(pos.qty || 0),
      marketValue:  pos.marketValue || 0,
    });
  }
  // Remove symbols no longer held
  for (const sym of wsTrailMeta.keys()) {
    if (!positions.has(sym)) wsTrailMeta.delete(sym);
  }
}

async function wsCheckEquityStop(symbol, price) {
  const meta = wsTrailMeta.get(symbol);
  if (!meta || meta.assetClass === 'Crypto' || !meta.trailingStop) return;
  const trailPct = config.trailingStopPct || 5;
  if (price > meta.highWater) {
    const newStop = +(price * (1 - trailPct / 100)).toFixed(4);
    meta.highWater    = price;
    meta.trailingStop = newStop;
    try { updatePositionHighWater(symbol, price, newStop); } catch {}
  }
  if (price <= meta.trailingStop && meta.highWater > 0) {
    console.log(`  🛑 [WS] ${symbol}: real-time trailing stop triggered ($${price.toFixed(2)} ≤ $${meta.trailingStop.toFixed(2)})`);
    wsTrailMeta.delete(symbol);
    try {
      const cancelled = await cancelOpenOrdersForSymbol(symbol);
      if (cancelled) console.log(`  🗑 [WS] ${symbol}: cancelled ${cancelled} open order(s)`);
      const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
      try { addTrade({ symbol, side: "sell", notional: meta.marketValue, assetClass: meta.assetClass }, "daemon"); } catch {}
      try { deletePositionMeta(symbol); } catch {}
      await alertOrder(symbol, "sell", meta.marketValue, `[WS] 🛑 Trail stop $${meta.trailingStop.toFixed(2)}`);
      console.log(`  ✅ [WS] ${symbol}: closed via real-time trail stop`);
    } catch (e) {
      console.error(`  ⚠ [WS] Trail stop close failed for ${symbol}: ${e.message}`);
    }
  }
}

async function wsUpdateCryptoTrail(symbol, price) {
  const meta = wsTrailMeta.get(symbol);
  if (!meta || meta.assetClass !== 'Crypto') return;
  const trailPct  = config.cryptoTrailingStopPct || 3;
  const threshold = meta.highWater * (1 + 0.005); // 0.5% advance before updating
  if (price > threshold) {
    const newStop = +(price * (1 - trailPct / 100)).toFixed(4);
    const existing = cryptoStopOrders.get(symbol);
    if (existing && newStop > existing.stop_price) {
      try {
        await fetch(`${tradeBase()}/v2/orders/${existing.id}`, { method: "DELETE", headers: alpacaHeaders() });
        const limitPrice = +(newStop * 0.995).toFixed(4);
        const newOrder   = await alpacaPost("/v2/orders", {
          symbol, qty: existing.qty, side: "sell", type: "stop_limit", time_in_force: "gtc",
          stop_price: newStop.toFixed(4), limit_price: limitPrice.toFixed(4),
        });
        cryptoStopOrders.set(symbol, { id: newOrder.id, stop_price: newStop, qty: existing.qty });
        meta.highWater    = price;
        meta.trailingStop = newStop;
        try { updatePositionHighWater(symbol, price, newStop); } catch {}
        console.log(`  🔄 [WS] ${symbol}: crypto stop advanced $${existing.stop_price.toFixed(4)} → $${newStop.toFixed(4)}`);
      } catch { /* silent — retry on next tick */ }
    }
  }
}

function startEquityTrailMonitor() {
  if (!config.alpacaKey || !config.alpacaSecret) return;
  const equitySyms = [...wsTrailMeta.keys()].filter(s => !s.includes('/'));
  if (!equitySyms.length) return;
  if (wsEquityMonitor?.readyState === 1 /* OPEN */) {
    wsEquityMonitor.send(JSON.stringify({ action: "subscribe", quotes: equitySyms }));
    return;
  }
  try {
    wsEquityMonitor = new WebSocket("wss://stream.data.alpaca.markets/v2/sip");
    wsEquityMonitor.onopen = () => {
      wsEquityMonitor.send(JSON.stringify({ action: "auth", key: config.alpacaKey, secret: config.alpacaSecret }));
    };
    wsEquityMonitor.onmessage = async (event) => {
      let msgs; try { msgs = JSON.parse(event.data); } catch { return; }
      if (!Array.isArray(msgs)) msgs = [msgs];
      for (const msg of msgs) {
        if (msg.T === "success" && msg.msg === "authenticated") {
          const syms = [...wsTrailMeta.keys()].filter(s => !s.includes('/'));
          if (syms.length) { wsEquityMonitor.send(JSON.stringify({ action: "subscribe", quotes: syms })); }
          console.log(`  📡 Equity trail WS: authenticated, watching ${syms.length} symbol(s)`);
        }
        if (msg.T === "q" && msg.ap && msg.bp) {
          await wsCheckEquityStop(msg.S, (msg.ap + msg.bp) / 2).catch(() => {});
        }
      }
    };
    wsEquityMonitor.onclose = () => { console.warn("  📡 Equity trail WS closed"); wsEquityMonitor = null; };
    wsEquityMonitor.onerror = () => { wsEquityMonitor = null; };
    console.log(`  📡 Starting equity trail WS for: ${equitySyms.join(", ")}`);
  } catch (e) { console.warn("  📡 Equity trail WS failed:", e.message); }
}

function startCryptoTrailMonitor() {
  if (!config.alpacaKey || !config.alpacaSecret) return;
  const cryptoSyms = [...wsTrailMeta.keys()].filter(s => s.includes('/'));
  if (!cryptoSyms.length) return;
  if (wsCryptoMonitor?.readyState === 1 /* OPEN */) {
    wsCryptoMonitor.send(JSON.stringify({ action: "subscribe", trades: cryptoSyms }));
    return;
  }
  try {
    wsCryptoMonitor = new WebSocket("wss://stream.data.alpaca.markets/v1beta3/crypto/us");
    wsCryptoMonitor.onopen = () => {
      wsCryptoMonitor.send(JSON.stringify({ action: "auth", key: config.alpacaKey, secret: config.alpacaSecret }));
    };
    wsCryptoMonitor.onmessage = async (event) => {
      let msgs; try { msgs = JSON.parse(event.data); } catch { return; }
      if (!Array.isArray(msgs)) msgs = [msgs];
      for (const msg of msgs) {
        if (msg.T === "success" && msg.msg === "authenticated") {
          const syms = [...wsTrailMeta.keys()].filter(s => s.includes('/'));
          if (syms.length) { wsCryptoMonitor.send(JSON.stringify({ action: "subscribe", trades: syms })); }
          console.log(`  📡 Crypto trail WS: authenticated, watching ${syms.length} symbol(s)`);
        }
        if (msg.T === "t") {
          await wsUpdateCryptoTrail(msg.S, msg.p).catch(() => {});
        }
      }
    };
    wsCryptoMonitor.onclose = () => { console.warn("  📡 Crypto trail WS closed"); wsCryptoMonitor = null; };
    wsCryptoMonitor.onerror = () => { wsCryptoMonitor = null; };
    console.log(`  📡 Starting crypto trail WS for: ${cryptoSyms.join(", ")}`);
  } catch (e) { console.warn("  📡 Crypto trail WS failed:", e.message); }
}

// ─── Market regime detection ─────────────────────────────────────────────────

function resampleToWeekly(dailyBars) {
  const weeks = new Map();
  for (const bar of dailyBars) {
    const d = new Date(bar.time);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, { time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    else {
      const w = weeks.get(key);
      w.high   = Math.max(w.high, bar.high);
      w.low    = Math.min(w.low,  bar.low);
      w.close  = bar.close;
      w.volume += bar.volume;
    }
  }
  return [...weeks.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function getWeeklyTrend(dailyBars) {
  if (!dailyBars?.length) return null;
  const weekly = resampleToWeekly(dailyBars);
  if (weekly.length < 20) return null;
  const closes     = weekly.map(b => b.close);
  const sma20      = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const sma20_4wAgo = closes.length >= 24 ? closes.slice(-24, -4).reduce((s, v) => s + v, 0) / 20 : sma20;
  const current    = closes[closes.length - 1];
  return {
    trend:            (current > sma20 && sma20 > sma20_4wAgo) ? "up" : "down",
    priceAboveSma20:  current > sma20,
    sma20Rising:      sma20 > sma20_4wAgo,
  };
}

async function getMarketRegime(spyPrice) {
  try {
    const bars = await getStockBars("SPY");
    if (!bars || bars.length < 200) return { regime: "UNKNOWN" };
    const closes     = bars.map(b => b.close);
    const sma50      = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;
    const sma200     = closes.slice(-200).reduce((s, v) => s + v, 0) / 200;
    const aboveSma200 = spyPrice > sma200;
    const goldenCross = sma50 > sma200;
    const regime = (aboveSma200 && goldenCross) ? "BULL" : (!aboveSma200 && !goldenCross) ? "BEAR" : "NEUTRAL";
    return { regime, spyPrice, sma50: +sma50.toFixed(2), sma200: +sma200.toFixed(2), aboveSma200, goldenCross };
  } catch { return { regime: "UNKNOWN" }; }
}

let consecutiveScanFailures = 0;

// ─── Analysis cache (in-memory, per daemon process) ─────────────────────────
// Avoids calling GPT when a symbol moved < MIN_MOVE_PCT since last analysis

const MIN_MOVE_PCT        = 0.5;   // equities: re-analyze if price moved ≥ 0.5%
const CRYPTO_MIN_MOVE_PCT = 2.5;   // crypto: normal intraday noise is 1–5%, so use higher bar
const analysisCache  = new Map(); // symbol → { result, price, ts }
// pendingSells: symbol → { marketValue, assetClass, attempts, lastAttempt, reason, type }
// type: "rule" = stop/trailing/circuit-breaker (always retry)
//       "signal" = GPT SELL signal (only retry if fresh scan still says SELL)
const pendingSells   = new Map();

function getCachedAnalysis(symbol, currentPrice, ttlMs, latestNewsDate, assetClass) {
  const entry = analysisCache.get(symbol);
  if (!entry) return null;
  const isCrypto   = assetClass === "Crypto";
  const movePct    = isCrypto ? CRYPTO_MIN_MOVE_PCT : MIN_MOVE_PCT;
  const extendedMs = isCrypto ? ttlMs * 3 : ttlMs * 2; // crypto cache lives 3× TTL vs 2× for equities
  const age = Date.now() - entry.ts;
  // Within normal TTL → always use cache
  if (age < ttlMs) return entry.result;
  // Within extended TTL AND price barely moved → reuse stale result, unless fresh news arrived
  if (age < extendedMs && Math.abs(currentPrice - entry.price) / entry.price * 100 < movePct) {
    if (latestNewsDate && latestNewsDate > new Date(entry.ts).toISOString().slice(0, 10)) {
      return null; // breaking news since last analysis — force fresh GPT call
    }
    return entry.result;
  }
  return null;
}

function setCachedAnalysis(symbol, result, price) {
  analysisCache.set(symbol, { result, price, ts: Date.now() });
}

// ─── History ─────────────────────────────────────────────────────────────────
// Scan runs and results are persisted to SQLite via server/database.js

// ─── Main scan loop ─────────────────────────────────────────────────────────

async function runScan() {
  try { config = loadConfig(); } catch (e) { console.error("  [WARN] Config reload failed, using previous config:", e.message); }
  try { upsertDaemonHeartbeat(process.pid); } catch {}
  const scanStart = Date.now();
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] Starting scan...`);
  let tMarketData = 0, tPortfolio = 0, tAnalysis = 0;

  // Fetch market data
  let allSymbols;
  try {
    const _t0 = Date.now();
    allSymbols = await fetchMarketData();
    tMarketData = Date.now() - _t0;
    console.log(`  Found ${allSymbols.length} symbols (${(tMarketData/1000).toFixed(1)}s)`);
  } catch (e) {
    console.error("  Market data error:", e.message);
    return;
  }

  // Fetch account state — buying power + live position map
  let buyingPower = null;
  let currentPositions = new Map(); // symbol → { qty, avgPrice, marketValue }
  if (config.alpacaKey && config.alpacaSecret) {
    try {
      const [account, positions] = await Promise.all([
        alpacaGet("/v2/account"),
        alpacaGet("/v2/positions"),
      ]);
      // non_marginable_buying_power = actual settled cash, no leverage — prevents daemon from trading on borrowed funds
      const rawBp        = parseFloat(account.non_marginable_buying_power || account.buying_power || account.cash || 0);
      const reservedAmt  = config.reserveFixed != null && config.reserveFixed > 0
        ? Math.min(config.reserveFixed, rawBp)          // fixed dollar reserve (never shrinks)
        : rawBp * ((config.reservePct ?? 0) / 100);     // % reserve (default)
      const usableBp     = Math.max(0, rawBp - reservedAmt);
      // Split into equity and crypto buckets
      const cryptoPct    = (config.cryptoCapitalPct ?? 10) / 100;
      buyingPower        = {
        equity: +(usableBp * (1 - cryptoPct)).toFixed(2),
        crypto: +(usableBp * cryptoPct).toFixed(2),
        total:  +usableBp.toFixed(2),
      };
      const reserveDesc = config.reserveFixed != null && config.reserveFixed > 0
        ? `fixed $${reservedAmt.toFixed(0)}`
        : `${config.reservePct ?? 0}% ($${reservedAmt.toFixed(0)})`;
      console.log(`  Buying power: $${rawBp.toFixed(0)} total · reserve ${reserveDesc} · usable $${usableBp.toFixed(0)} → equity $${buyingPower.equity.toFixed(0)} (${100 - (config.cryptoCapitalPct ?? 10)}%) · crypto $${buyingPower.crypto.toFixed(0)} (${config.cryptoCapitalPct ?? 10}%)`);
      if (Array.isArray(positions)) {
        for (const p of positions) {
          currentPositions.set(p.symbol, {
            qty:           parseFloat(p.qty || 0),
            avgPrice:      parseFloat(p.avg_entry_price || 0),
            marketValue:   parseFloat(p.market_value || 0),
            unrealizedPl:  parseFloat(p.unrealized_pl || 0),
            unrealizedPlPct: parseFloat(p.unrealized_plpc || 0) * 100,
          });
        }
        if (currentPositions.size) {
          console.log(`  Holdings: ${[...currentPositions.keys()].join(", ")}`);
        }
      }
    } catch (e) {
      console.warn("  Account fetch failed:", e.message);
    }
  }

  // ── Retry rule-based pending sells (stop/trailing/circuit-breaker) ───────
  // Signal-based pending sells are retried in maybeAutoTrade only if fresh scan still says SELL
  const rulePending = [...pendingSells.entries()].filter(([, p]) => p.type === "rule");
  if (rulePending.length && config.alpacaKey && config.alpacaSecret) {
    console.log(`  ♻ Retrying ${rulePending.length} rule-based pending sell(s)...`);
    for (const [symbol, pending] of rulePending) {
      try {
        const cancelled = await cancelOpenOrdersForSymbol(symbol);
        if (cancelled) console.log(`  🗑 ${symbol}: cancelled ${cancelled} open order(s) before retry sell`);
        const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
        try { addTrade({ symbol, side: "sell", notional: pending.marketValue, assetClass: pending.assetClass }, "daemon"); } catch {}
        try { deletePositionMeta(symbol); } catch {}
        currentPositions.delete(symbol);
        pendingSells.delete(symbol);
        console.log(`  ✅ Retry sell succeeded: ${symbol} (was attempt ${pending.attempts})`);
        await alertOrder(symbol, "sell", pending.marketValue, `retry — ${pending.reason}`);
      } catch (e) {
        pending.attempts++;
        pending.lastAttempt = Date.now();
        console.error(`  ⚠ Retry sell failed for ${symbol} (attempt ${pending.attempts}): ${e.message}`);
      }
    }
  }

  // Warn about signal-based pending sells waiting for fresh confirmation
  const signalPending = [...pendingSells.entries()].filter(([, p]) => p.type === "signal");
  if (signalPending.length) {
    console.log(`  ⏳ ${signalPending.map(([s]) => s).join(", ")}: pending SELL — awaiting fresh signal confirmation`);
  }

  // Fetch market clock — gates analysis and orders per asset class
  let marketClock = null;
  if (config.alpacaKey && config.alpacaSecret) {
    try { marketClock = await alpacaGet("/v2/clock"); } catch {}
  }
  // ET time via UTC math — avoids Intl hour12 bug on Windows where hour12:false is ignored
  function getETMinutes() {
    const now = new Date();
    const yr = now.getUTCFullYear();
    // 2nd Sunday in March = DST start (EDT, UTC-4)
    const mar1 = new Date(Date.UTC(yr, 2, 1));
    const dstStart = new Date(Date.UTC(yr, 2, 8 + (7 - mar1.getUTCDay()) % 7));
    // 1st Sunday in November = DST end (EST, UTC-5)
    const nov1 = new Date(Date.UTC(yr, 10, 1));
    const dstEnd = new Date(Date.UTC(yr, 10, 1 + (7 - nov1.getUTCDay()) % 7));
    const offsetH = (now >= dstStart && now < dstEnd) ? -4 : -5;
    const et = new Date(now.getTime() + offsetH * 3600000);
    if (et.getUTCDay() === 0 || et.getUTCDay() === 6) return null; // weekend in ET
    return et.getUTCHours() * 60 + et.getUTCMinutes();
  }

  function isUSMarketHoursNow() {
    const mins = getETMinutes();
    return mins != null && mins >= 570 && mins < 960; // 9:30 AM–4:00 PM ET
  }

  const marketOpen = marketClock != null ? marketClock.is_open : isUSMarketHoursNow();
  console.log(`  Market: ${marketOpen ? "OPEN ✓" : "CLOSED ✗ (equity/ETF symbols will be skipped)"}`);

  // Re-evaluates ET time live — used before alerts and mid-scan symbol checks
  function isUSMarketOpenNow() {
    const mins = getETMinutes();
    return mins != null && mins >= 570 && mins < 960; // 9:30 AM–4:00 PM ET
  }

  function isPreMarket() {
    const mins = getETMinutes();
    return mins != null && mins >= 240 && mins < 570; // 4:00 AM–9:30 AM ET
  }

  function isMarketOpenForAsset(assetClass) {
    if (assetClass === "Crypto") return true;
    // Pre-market mode: scan equities 4:00–9:30 AM ET for analysis (no trading)
    if (config.premarketScanEnabled && isPreMarket()) return true;
    return isUSMarketOpenNow();
  }

  // Sector ETF performance snapshot — built once per scan from allSymbols prices
  const SECTOR_ETF_LABELS = {
    SPY: "S&P 500", QQQ: "Nasdaq 100", IWM: "Russell 2000",
    XLK: "Tech", XLE: "Energy", XLF: "Financials",
    XLV: "Healthcare", XLU: "Utilities", XLI: "Industrials",
    XLRE: "Real Estate", XLP: "Consumer Staples", XLY: "Consumer Disc",
    GLD: "Gold", TLT: "Long Bonds", VXX: "VIX/Vol",
    // Forex ETFs
    FXE: "EUR/USD", FXB: "GBP/USD", FXY: "JPY/USD",
    FXA: "AUD/USD", FXF: "CHF/USD", UUP: "USD Index",
  };
  const buildSectorContext = (allSyms) => {
    const symMap = new Map(allSyms.map(s => [s.symbol, s]));
    const parts = [];
    for (const [etf, label] of Object.entries(SECTOR_ETF_LABELS)) {
      const s = symMap.get(etf);
      if (!s) continue;
      const chg = s.change_pct != null ? `${s.change_pct >= 0 ? "+" : ""}${s.change_pct.toFixed(2)}%` : "N/A";
      parts.push(`${label} (${etf}): ${chg}`);
    }
    return parts.length ? parts.join(" | ") : null;
  };

  // Market session time — US Eastern Time (ET)
  const buildSessionContext = () => {
    const now = new Date();
    // US/Eastern offset: EST = UTC-5, EDT = UTC-4 (March-Nov)
    const etOffset = (() => {
      const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
      const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
      const stdOffset = Math.max(jan, jul);
      // DST is in effect if current offset is less than std offset
      return now.getTimezoneOffset() < stdOffset ? -4 : -5;
    })();
    const etMs = now.getTime() + (now.getTimezoneOffset() + etOffset * 60) * 60 * 1000;
    const et = new Date(etMs);
    const h = et.getUTCHours();
    const m = et.getUTCMinutes();
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET`;
    let session;
    if      (h < 4)                      session = "overnight";
    else if (h < 9 || (h === 9 && m < 30)) session = "pre-market";
    else if (h < 16)                     session = "regular session";
    else if (h < 20)                     session = "after-hours";
    else                                 session = "overnight";
    const minutesLeft = session === "regular session" ? (16 * 60) - (h * 60 + m) : null;
    const timeLeftStr = minutesLeft != null ? ` | ${minutesLeft}min until close` : "";
    return `${timeStr} — ${session}${timeLeftStr}`;
  };

  const TECH_SYMBOLS = new Set(["NVDA","AMD","AAPL","MSFT","AVGO","GOOGL","META","TSLA","SOXX","QQQ","XLK","ARKK","TSM"]);
  const ENERGY_SYMBOLS = new Set(["XOM","CVX","TTE","SHEL","BP","XLE","USO"]);

  const buildPortfolioContext = (positions, bp) => {
    const totalInvested = [...positions.values()].reduce((s, p) => s + p.marketValue, 0);
    const header = `Buying power: $${bp?.toFixed(0) ?? "unknown"} | Total invested: $${totalInvested.toFixed(0)}`;
    if (!positions.size) return header;
    const holdings = [...positions.entries()]
      .map(([sym, p]) => {
        const plSign = p.unrealizedPl >= 0 ? "+" : "";
        const plStr  = p.unrealizedPl != null
          ? ` P&L: ${plSign}$${p.unrealizedPl.toFixed(0)} (${plSign}${p.unrealizedPlPct?.toFixed(1)}%)`
          : "";
        return `${sym}: ${p.qty.toFixed(4)} shares @ avg $${p.avgPrice.toFixed(2)} | value $${p.marketValue.toFixed(0)}${plStr}`;
      })
      .join("; ");
    // Concentration warnings — flag correlated clusters
    const warnings = [];
    const syms = [...positions.keys()];
    const techHeld   = syms.filter(s => TECH_SYMBOLS.has(s));
    const energyHeld = syms.filter(s => ENERGY_SYMBOLS.has(s));
    if (techHeld.length >= 2)   warnings.push(`⚠ Tech concentration: ${techHeld.join(",")} are highly correlated`);
    if (energyHeld.length >= 2) warnings.push(`⚠ Energy concentration: ${energyHeld.join(",")}`);
    const warnStr = warnings.length ? `\n${warnings.join("\n")}` : "";
    return `${header}\nHoldings: ${holdings}${warnStr}`;
  };

  // Sector ETF performance + session time — computed once, shared across all symbol analyses
  const sectorSnapshot = buildSectorContext(allSymbols);
  const sessionSnapshot = buildSessionContext();

  // Fetch macro snapshot once per scan — shared across all symbol analyses
  let macroSnapshot = null;
  try { macroSnapshot = await getMacroEconomics(); } catch {}

  // Fetch Crypto Fear & Greed Index once per scan (free, no auth)
  let fearGreed = null;
  try { fearGreed = await getCryptoFearGreed(); } catch {}
  if (fearGreed) console.log(`  Crypto Fear & Greed: ${fearGreed.value}/100 — ${fearGreed.label}`);
  if (macroSnapshot && !Object.values(macroSnapshot).every(v => v == null)) {
    console.log(`  Macro (AV): Fed=${macroSnapshot.fedRate}% CPI=${macroSnapshot.cpiYoy}% GDP=${macroSnapshot.gdpGrowth}% Unemp=${macroSnapshot.unemployment}% | 2Y=${macroSnapshot.yield2y}% 10Y=${macroSnapshot.yield10y}% Curve=${macroSnapshot.yieldCurve}`);
  }

  // Market regime — computed once per scan, used in maybeAutoTrade to gate BUY signals
  let marketRegime = { regime: "UNKNOWN" };
  if (config.regimeGateEnabled) {
    const spyEntry = allSymbols.find(s => s.symbol === "SPY");
    if (spyEntry) {
      try { marketRegime = await getMarketRegime(spyEntry.price); } catch {}
      if (marketRegime.regime !== "UNKNOWN") {
        console.log(`  Market regime: ${marketRegime.regime} | SPY $${marketRegime.spyPrice?.toFixed(2)} | SMA50 $${marketRegime.sma50} | SMA200 $${marketRegime.sma200} | Golden cross: ${marketRegime.goldenCross}`);
      }
    }
  }

  // Analyze each symbol
  const results = [];
  const tradeData = new Map(); // symbol → { livePrice, atrLevels, indicators } for post-norm auto-trade
  const circuitBreaker = { failures: 0, tripped: false };
  // bpBuckets is mutated in place as orders are placed/closed
  const bpBuckets = buyingPower; // { equity, crypto, initialEquity, initialCrypto } or null
  if (bpBuckets) {
    bpBuckets.initialEquity = bpBuckets.equity;
    bpBuckets.initialCrypto = bpBuckets.crypto;
  }
  const analyzedSymbols = new Set(); // track symbols analyzed in portfolio check

  // Step 2b: analyze ALL held positions FIRST (force fresh — bypass normal order)
  // Always runs so exit signals are caught regardless of auto-trade setting
  const _tPortStart = Date.now();
  if (currentPositions.size > 0 && config.alpacaKey && config.alpacaSecret) {
    const heldSymbols = [...currentPositions.keys()];
    const symMap = new Map(allSymbols.map(s => [s.symbol, s]));
    console.log(`  Checking ${heldSymbols.length} held position(s) for exit signals...`);

    // Load persisted position meta once for the whole portfolio check
    const allMeta = new Map(getAllPositionMeta().map(m => [m.symbol, m]));

    // Rebuild module-level cryptoStopOrders from Alpaca open orders
    await rebuildCryptoStopOrders();
    await rebuildEquityTrailOrders();
    const allMetaForWs = new Map(getAllPositionMeta().map(m => [m.symbol, m]));
    syncWsTrailMeta(currentPositions, allMetaForWs);
    startEquityTrailMonitor();
    startCryptoTrailMonitor();

    // Helper: close a position and clean up state
    const autoClose = async (symbol, reason, position) => {
      // No equity execution during pre-market — analysis only
      if (isPreMarket() && symMap.get(symbol)?.assetClass !== "Crypto") {
        console.log(`  ⏰ ${symbol}: ${reason} — pre-market, queued for regular hours`);
        return false;
      }
      const invested = position?.marketValue ?? 0;
      try {
        // Cancel open bracket/stop orders first — they lock qty and cause "insufficient qty" errors
        const cancelled = await cancelOpenOrdersForSymbol(symbol);
        if (cancelled) console.log(`  🗑 ${symbol}: cancelled ${cancelled} open order(s) before close`);
        const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
        const closedAsset = symMap.get(symbol)?.assetClass;
        try { addTrade({ symbol, side: "sell", notional: invested, assetClass: closedAsset }, "daemon"); } catch {}
        try { deletePositionMeta(symbol); } catch {}
        currentPositions.delete(symbol);
        if (bpBuckets) {
          const bKey = closedAsset === "Crypto" ? "crypto" : "equity";
          bpBuckets[bKey] = (bpBuckets[bKey] ?? 0) + invested;
        }
        console.log(`  ${reason} — closed ${symbol} · freed $${invested.toFixed(0)}`);
        await alertOrder(symbol, "sell", invested, reason);
        return true;
        pendingSells.delete(symbol);
      } catch (e) {
        const prev = pendingSells.get(symbol) ?? { attempts: 0 };
        pendingSells.set(symbol, { marketValue: invested, assetClass: symMap.get(symbol)?.assetClass, attempts: prev.attempts + 1, lastAttempt: Date.now(), reason, type: "rule" });
        console.error(`  ⚠ Auto-close failed for ${symbol} (${reason}): ${e.message} — queued for retry (attempt ${prev.attempts + 1})`);
        return false;
      }
    };

    for (const symbol of heldSymbols) {
      const symData = symMap.get(symbol);
      if (!symData) { console.log(`  ⚡ ${symbol}: not in universe — skipping`); continue; }
      if (!isMarketOpenForAsset(symData.assetClass)) { console.log(`  ⏰ ${symbol}: market closed — skipping`); continue; }

      const position     = currentPositions.get(symbol);
      const currentPrice = symData.price;
      const meta         = allMeta.get(symbol);

      // Seed meta for legacy positions (opened before this feature)
      if (!meta) {
        try {
          const trailPct = (symData.assetClass === "Crypto" ? config.cryptoTrailingStopPct || 3 : config.trailingStopPct || 5);
          upsertPositionMeta(symbol, {
            entryPrice:   position?.avgPrice || currentPrice,
            entryDate:    new Date().toISOString(),
            highWater:    currentPrice,
            trailingStop: config.trailingStopEnabled ? +(currentPrice * (1 - trailPct / 100)).toFixed(4) : null,
          });
          allMeta.set(symbol, { symbol, entry_price: currentPrice, entry_date: new Date().toISOString(), high_water: currentPrice, trailing_stop: null });
        } catch {}
      }

      // ── 1. Profit target auto-close ────────────────────────────────────────
      if (config.profitTargetEnabled && meta?.target_price && currentPrice >= meta.target_price) {
        console.log(`  🎯 ${symbol}: profit target hit ($${currentPrice.toFixed(2)} >= $${meta.target_price.toFixed(2)})`);
        const closed = await autoClose(symbol, `🎯 Profit target $${meta.target_price.toFixed(2)}`, position);
        if (closed) { analyzedSymbols.add(symbol); continue; }
      }

      // ── 2. Trailing stop ───────────────────────────────────────────────────
      if (config.trailingStopEnabled && meta) {
        const trailPct    = symData.assetClass === "Crypto" ? config.cryptoTrailingStopPct || 3 : config.trailingStopPct || 5;
        const newHigh     = Math.max(meta.high_water || currentPrice, currentPrice);
        const trailStop   = +(newHigh * (1 - trailPct / 100)).toFixed(4);
        const stopAdvanced = newHigh > (meta.high_water || 0);
        try { updatePositionHighWater(symbol, newHigh, trailStop); } catch {}

        // For crypto: cancel/replace Alpaca stop_limit when trail level advances
        if (symData.assetClass === "Crypto" && stopAdvanced) {
          const existing = cryptoStopOrders.get(symbol);
          if (existing && trailStop > existing.stop_price) {
            try {
              // Cancel old order
              await fetch(`${tradeBase()}/v2/orders/${existing.id}`, { method: "DELETE", headers: alpacaHeaders() });
              // Place new stop_limit at the advanced level
              const limitPrice = +(trailStop * 0.995).toFixed(4);
              const newOrder = await alpacaPost("/v2/orders", {
                symbol,
                qty:            existing.qty,
                side:           "sell",
                type:           "stop_limit",
                time_in_force:  "gtc",
                stop_price:     trailStop.toFixed(4),
                limit_price:    limitPrice.toFixed(4),
              });
              cryptoStopOrders.set(symbol, { id: newOrder.id, stop_price: trailStop, qty: existing.qty });
              console.log(`  🔄 ${symbol}: stop advanced $${existing.stop_price} → $${trailStop} (high $${newHigh})`);
            } catch (e) {
              console.log(`  ⚠ ${symbol}: stop replace failed: ${e.message}`);
            }
          }
        }

        if (currentPrice <= trailStop && newHigh > (meta.entry_price || 0)) {
          // Only trigger trailing stop if we've moved above entry (avoid stopping out immediately on bad fills)
          console.log(`  🛑 ${symbol}: trailing stop hit ($${currentPrice.toFixed(2)} <= $${trailStop.toFixed(2)}, high $${newHigh.toFixed(2)})`);
          const closed = await autoClose(symbol, `🛑 Trailing stop $${trailStop.toFixed(2)}`, position);
          if (closed) { analyzedSymbols.add(symbol); continue; }
        }
      }

      // ── 3. Max position age ────────────────────────────────────────────────
      if (config.maxPositionAgeEnabled && config.maxPositionAgeDays && meta?.entry_date) {
        const tradingDaysHeld = countTradingDays(new Date(meta.entry_date), new Date());
        if (tradingDaysHeld >= config.maxPositionAgeDays) {
          console.log(`  ⏳ ${symbol}: held ${tradingDaysHeld} trading days — max age (${config.maxPositionAgeDays}d) reached`);
          const closed = await autoClose(symbol, `⏳ Max age ${tradingDaysHeld} trading days`, position);
          if (closed) { analyzedSymbols.add(symbol); continue; }
        }
      }

      analyzedSymbols.add(symbol);
      process.stdout.write(`  [HOLD] ${symbol.padEnd(10)} `);

      try {
        const isCryptoHeld = symData.assetClass === "Crypto";
        const [bars, hourlyBars, avNews, alpacaNews, fundamentals, optionsFlow] = await Promise.all([
          getBarsByAssetClass(symbol, symData.assetClass),
          isCryptoHeld ? getCryptoHourlyBars(symbol).catch(() => null) : Promise.resolve(null),
          getAvNews(symbol).catch(() => []),
          getNews(symbol).catch(() => []),
          isCryptoHeld ? Promise.resolve(null) : getFundamentals(symbol).catch(() => null),
          isCryptoHeld ? Promise.resolve(null) : getOptionsFlow(symbol, symData.price).catch(() => null),
        ]);
        const news             = avNews.length ? avNews : alpacaNews;
        const indicators       = computeIndicators(bars);
        const atrLevels        = computeATRLevels(symData.price, indicators?.atr14, symData.assetClass);
        const hourlyIndicators = hourlyBars ? computeIndicators(hourlyBars) : null;
        const hourlyVolRatio   = volumeAvgRatio(hourlyBars);
        const portfolioContext = buildPortfolioContext(currentPositions, bpBuckets ? bpBuckets.equity + bpBuckets.crypto : null);
        const r = await analyzeSymbol(symData, portfolioContext, news, indicators, atrLevels, fundamentals, macroSnapshot, sectorSnapshot, sessionSnapshot, fearGreed, hourlyIndicators, hourlyVolRatio, optionsFlow);
        results.push(r);
        try { upsertScanResult(r, "daemon"); } catch {}

        const indicator = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "🟡";
        console.log(`${indicator} ${r.signal.padEnd(5)} ${r.symbol.padEnd(10)} score=${r.score} conviction=${r.conviction} price=$${symData.price} entry=$${r.entry ?? "?"} stop=$${r.stop ?? "?"} target=$${r.target ?? "?"}`);

        const existingPosition = currentPositions.get(symbol);
        const alreadyInvested = existingPosition?.marketValue ?? 0;

        if (r.signal === "SELL") {
          // Always alert for exit signal on a held position
          await alertSignal(r);
          if (config.autoTradeEnabled) {
            try {
              const cancelled = await cancelOpenOrdersForSymbol(symbol);
              if (cancelled) console.log(`  🗑 ${symbol}: cancelled ${cancelled} open order(s) before sell`);
              const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
              try { addTrade({ symbol, side: "sell", notional: alreadyInvested, assetClass: r.assetClass }, "daemon"); } catch {}
              try { deletePositionMeta(symbol); } catch {}
              currentPositions.delete(symbol);
              pendingSells.delete(symbol);
              if (bpBuckets) {
                const bKey = r.assetClass === "Crypto" ? "crypto" : "equity";
                bpBuckets[bKey] = (bpBuckets[bKey] ?? 0) + alreadyInvested;
              }
              console.log(`  📤 Closed ${symbol} · freed $${alreadyInvested.toFixed(0)}`);
              await alertOrder(symbol, "sell", alreadyInvested);
            } catch (e) {
              const prev = pendingSells.get(symbol) ?? { attempts: 0 };
              pendingSells.set(symbol, { marketValue: alreadyInvested, assetClass: r.assetClass, attempts: prev.attempts + 1, lastAttempt: Date.now(), reason: "SELL signal", type: "signal" });
              console.error(`  ⚠ Could not close ${symbol}: ${e.message} — queued for retry (attempt ${prev.attempts + 1})`);
            }
          } else {
            console.log(`  ⚠ SELL signal on ${symbol} — auto-trade off, alert sent`);
          }
        }

        await new Promise(res => setTimeout(res, 300));
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
      }
    }
  }

  tPortfolio = Date.now() - _tPortStart;

  // ── Crypto rebalancing ─────────────────────────────────────────────────────
  // If crypto holdings have grown > 120% of target allocation, trim the worst performer
  if (bpBuckets && currentPositions.size > 0) {
    const symMap2 = new Map(allSymbols.map(s => [s.symbol, s]));
    const cryptoPositions = [...currentPositions.entries()]
      .filter(([sym]) => symMap2.get(sym)?.assetClass === "Crypto")
      .map(([sym, pos]) => ({ symbol: sym, marketValue: pos.marketValue ?? 0, avgPrice: pos.avgPrice ?? 0 }));
    const totalCryptoValue = cryptoPositions.reduce((s, p) => s + p.marketValue, 0);
    const targetCryptoValue = bpBuckets.initialCrypto ?? 0;
    if (targetCryptoValue > 0 && totalCryptoValue > targetCryptoValue * 1.2) {
      const overshootPct = ((totalCryptoValue / targetCryptoValue - 1) * 100).toFixed(0);
      // Trim the worst-performing crypto position (lowest return vs avg entry)
      const toTrim = cryptoPositions.sort((a, b) => {
        const retA = symMap2.get(a.symbol)?.price / (a.avgPrice || 1) - 1;
        const retB = symMap2.get(b.symbol)?.price / (b.avgPrice || 1) - 1;
        return retA - retB;
      })[0];
      if (toTrim) {
        console.log(`  ⚖ Rebalance: crypto $${totalCryptoValue.toFixed(0)} is ${overshootPct}% over target $${targetCryptoValue.toFixed(0)} — trimming ${toTrim.symbol}`);
        const autoClose2 = async (symbol, reason, position) => {
          try {
            const res  = await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
            const invested = position?.marketValue ?? 0;
            try { addTrade({ symbol, side: "sell", notional: invested, assetClass: "Crypto" }, "daemon"); } catch {}
            try { deletePositionMeta(symbol); } catch {}
            currentPositions.delete(symbol);
            bpBuckets.crypto = (bpBuckets.crypto ?? 0) + invested;
            console.log(`  ⚖ ${reason} — closed ${symbol} · freed $${invested.toFixed(0)}`);
            await alertOrder(symbol, "sell", invested, reason);
          } catch (e) {
            console.error(`  ⚠ Rebalance close failed for ${symbol}: ${e.message}`);
          }
        };
        await autoClose2(toTrim.symbol, `⚖ Rebalance (${overshootPct}% over crypto target)`, currentPositions.get(toTrim.symbol));
      }
    }
  }

  const cacheTTLMs = (config.intervalMinutes || 30) * 60 * 1000;

  // Symbol selection filters — all configurable via daemon-config.json
  const MAX_SYMBOLS     = config.maxSymbols    ?? 60;
  const MAX_PER_MARKET  = config.maxPerMarket  ?? 99;  // 99 = effectively no cap
  const MIN_MOVE_FILTER = config.minMovePct    ?? 0;   // 0 = scan all symbols
  const marketSlotCount = {};
  const topSymbols = [];
  for (const s of allSymbols) {
    if (topSymbols.length >= MAX_SYMBOLS)         break;
    if (analyzedSymbols.has(s.symbol))            continue; // already analyzed as held position
    if (!isMarketOpenForAsset(s.assetClass))      continue; // market closed for this asset class
    if (s.assetClass !== "Crypto" && MIN_MOVE_FILTER > 0 && Math.abs(s.change_pct) < MIN_MOVE_FILTER) continue;
    if (MAX_PER_MARKET < 99 && (s.assetClass === "Equity" || s.market === "Forex ETFs")) {
      const key = s.market || "US Equities";
      const cap = s.market === "Forex ETFs" ? 3 : MAX_PER_MARKET;
      marketSlotCount[key] = (marketSlotCount[key] || 0) + 1;
      if (marketSlotCount[key] > cap) continue;
    }
    topSymbols.push(s);
  }

  const skippedFlat = MIN_MOVE_FILTER > 0 ? allSymbols.filter(s => !analyzedSymbols.has(s.symbol) && s.assetClass !== "Crypto" && Math.abs(s.change_pct) < MIN_MOVE_FILTER).length : 0;
  console.log(`  Symbol selection: ${topSymbols.length} queued · ${skippedFlat} skipped (flat <${MIN_MOVE_FILTER}%) · cap ${MAX_PER_MARKET}/market`);

  try { setScanProgress({ status: 'scanning', scannedCount: 0, totalCount: topSymbols.length, startedAt: new Date().toISOString() }); } catch {}

  circuitBreaker.failures = 0;
  circuitBreaker.tripped  = false;

  const _tAnalysisStart = Date.now();
  for (let i = 0; i < topSymbols.length; i++) {
    const sym = topSymbols[i];
    const _tSymStart = Date.now();
    process.stdout.write(`  [${i + 1}/${topSymbols.length}] ${sym.symbol.padEnd(10)} `);
    try { setScanProgress({ status: 'scanning', currentSym: sym.symbol, scannedCount: i, totalCount: topSymbols.length }); } catch {}

    // Re-check market status live — skip if market closed mid-scan
    if (!isMarketOpenForAsset(sym.assetClass)) {
      console.log(`⏰ market closed`);
      continue;
    }

    // Fetch news first (30min cached — cheap) so we can detect breaking news for cache invalidation
    const [avNews, alpacaNews] = await Promise.all([
      getAvNews(sym.symbol).catch(() => []),
      getNews(sym.symbol).catch(() => []),
    ]);
    const news = avNews.length ? avNews : alpacaNews;
    const latestNewsDate = news.length > 0 ? news.reduce((best, n) => n.date > best ? n.date : best, "") : null;

    // Check in-memory cache — skip GPT if price barely moved and no fresh news
    const cached = getCachedAnalysis(sym.symbol, sym.price, cacheTTLMs, latestNewsDate, sym.assetClass);
    if (cached) {
      results.push(cached);
      const moveThr = sym.assetClass === "Crypto" ? CRYPTO_MIN_MOVE_PCT : MIN_MOVE_PCT;
      console.log(`⚡ cached  ${cached.symbol.padEnd(10)} score=${cached.score} signal=${cached.signal} conviction=${cached.conviction} (Δ<${moveThr}%)`);
      // Still populate tradeData so maybeAutoTrade can run on cached BUY signals
      // Pass null indicators — maybeAutoTrade handles them gracefully with fallback values
      tradeData.set(sym.symbol, { livePrice: sym.price, atrLevels: null, indicators: null });
      continue;
    }

    try {
      // Rebuild context before each call so GPT sees orders placed earlier in this scan
      const isCryptoSym = sym.assetClass === "Crypto";
      const [bars, hourlyBars, fundamentals, optionsFlow] = await Promise.all([
        getBarsByAssetClass(sym.symbol, sym.assetClass),
        isCryptoSym ? getCryptoHourlyBars(sym.symbol).catch(() => null) : Promise.resolve(null),
        isCryptoSym ? Promise.resolve(null) : getFundamentals(sym.symbol).catch(() => null),
        isCryptoSym ? Promise.resolve(null) : getOptionsFlow(sym.symbol, sym.price).catch(() => null),
      ]);
      const indicators       = computeIndicators(bars);
      const atrLevels        = computeATRLevels(sym.price, indicators?.atr14, sym.assetClass);
      const hourlyIndicators = hourlyBars ? computeIndicators(hourlyBars) : null;
      const hourlyVolRatio   = volumeAvgRatio(hourlyBars);
      const portfolioContext = buildPortfolioContext(currentPositions, bpBuckets ? bpBuckets.equity + bpBuckets.crypto : null);
      // Inject BTC benchmark for crypto altcoins
      if (isCryptoSym && sym.symbol !== "BTC/USD") {
        const btcEntry = allSymbols.find(s => s.symbol === "BTC/USD");
        if (btcEntry) sym._btcChange = btcEntry.change_pct;
      }
      // Volume filter — skip dead/halted symbols (volume ratio < 0.3 = barely trading)
      const volRatioCheck = volumeAvgRatio(bars);
      if (bars && volRatioCheck != null && volRatioCheck < 0.3) {
        console.log(`⚪ low-vol ${sym.symbol.padEnd(10)} volRatio=${volRatioCheck} — skipping GPT`);
        continue;
      }
      const r = await analyzeSymbol(sym, portfolioContext, news, indicators, atrLevels, fundamentals, macroSnapshot, sectorSnapshot, sessionSnapshot, fearGreed, hourlyIndicators, hourlyVolRatio, optionsFlow);

      // EMA score smoothing for crypto — prevents wild single-scan swings
      // Only blend when signal direction is unchanged (same BUY/SELL/HOLD bias)
      if (isCryptoSym && r.score != null) {
        const prev = analysisCache.get(sym.symbol);
        if (prev?.result?.score != null && prev.result.signal === r.signal) {
          r.score = Math.round(0.4 * r.score + 0.6 * prev.result.score);
        }
      }

      setCachedAnalysis(sym.symbol, r, sym.price);
      try { upsertScanResult(r, "daemon"); } catch {}
      results.push(r);

      const indicator = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "🟡";
      const symMs = Date.now() - _tSymStart;
      console.log(`${indicator} ${r.signal.padEnd(5)} ${r.symbol.padEnd(10)} score=${r.score} conviction=${r.conviction} price=$${sym.price} entry=$${r.entry ?? "?"} stop=$${r.stop ?? "?"} target=$${r.target ?? "?"} (${(symMs/1000).toFixed(1)}s)`);

      // Store trade data for post-scan auto-trade
      const weeklyTrend = !isCryptoSym ? getWeeklyTrend(bars) : null;
      tradeData.set(sym.symbol, { livePrice: sym.price, atrLevels, indicators, weeklyTrend });

      // Small delay to avoid OpenAI rate limits
      await new Promise(res => setTimeout(res, 300));
    } catch (e) {
      console.log(`ERROR analyzing ${sym.symbol}: ${e.message}`);
    }
  }

  tAnalysis = Date.now() - _tAnalysisStart;

  // Raw GPT scores are stored and displayed — no batch normalization.
  // Normalization was causing scan page ↔ history score mismatches because
  // scan_results (one entry per symbol) and scan_runs (one entry per run) used
  // different normalization pools.  GPT already scores on a 0–100 scale.
  const totalMs = Date.now() - scanStart;
  const fmt = ms => ms >= 60000 ? `${(ms/60000).toFixed(1)}m` : `${(ms/1000).toFixed(1)}s`;
  try { addScanRun(results, "daemon", config, totalMs); } catch {}
  try { setScanProgress({ status: 'idle', currentSym: null, scannedCount: results.length, totalCount: results.length }); } catch {}
  console.log(`  Scan complete — ${results.length} analyzed · total ${fmt(totalMs)} (data ${fmt(tMarketData)} · portfolio ${fmt(tPortfolio)} · analysis ${fmt(tAnalysis)})`);

  for (const r of results) {
    const isCryptoResult    = r.assetClass === "Crypto";
    const effectiveMinScore = isCryptoResult ? (config.cryptoMinScore ?? 80) : (config.minScore ?? 75);
    const effectiveConv     = isCryptoResult ? (config.cryptoMinConviction ?? "HIGH") : (config.minConviction ?? "HIGH");
    const meetsScore        = r.score >= effectiveMinScore;
    const meetsConviction   = effectiveConv === "ANY" || r.conviction === "HIGH";
    const marketStillOpen   = isCryptoResult || isUSMarketOpenNow();
    if (r.signal === "BUY" && meetsScore && meetsConviction && marketStillOpen) {
      await alertSignal(r);
    } else if (r.signal === "BUY" && meetsScore && meetsConviction && !marketStillOpen && !isCryptoResult) {
      if (isPreMarket() && config.premarketScanEnabled) {
        console.log(`  📋 ${r.symbol}: sending pre-market alert`);
        await alertPremarketSignal(r);
      } else {
        console.log(`  🔕 ${r.symbol}: BUY alert suppressed — market closed`);
      }
    }
    const td = tradeData.get(r.symbol);
    if (td) await maybeAutoTrade(r, currentPositions, bpBuckets, circuitBreaker, td.livePrice, td.atrLevels, td.indicators, fearGreed, marketRegime, td.weeklyTrend, results);
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

const LOCK_FILE = path.join(__dirname, "finanalyzer.lock");

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    let running = false;
    try { process.kill(existingPid, 0); running = true; } catch {}
    if (running) {
      console.error(`[ERROR] Daemon already running (PID ${existingPid}). Exiting.`);
      process.exit(1);
    }
    console.warn(`[WARN] Stale lock file (PID ${existingPid} not running) — overwriting.`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║     FinAnalyzer Scan Daemon           ║");
  console.log(`║  Interval: ${String(config.intervalMinutes || 30).padEnd(3)}min  Mode: ${(config.alpacaMode || "paper").padEnd(5)}       ║`);
  console.log(`║  Auto-trade: ${config.autoTradeEnabled ? "ON " : "OFF"}  Min score: ${String(config.minScore || 75).padEnd(3)}      ║`);
  console.log("╚══════════════════════════════════════╝\n");

  if (!OPENAI_KEY) {
    console.error("[ERROR] VITE_OPENAI_KEY not set in .env");
    process.exit(1);
  }

  acquireLock();
  process.on("exit",    releaseLock);
  process.on("SIGINT",  () => { releaseLock(); process.exit(0); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });

  if (config.alpacaKey && config.alpacaSecret) {
    try {
      await alpacaGet("/v2/account");
      console.log("  Alpaca connectivity: OK");
    } catch (e) {
      console.error(`[ERROR] Alpaca connectivity check failed: ${e.message}`);
      console.error("  Verify alpacaKey / alpacaSecret in daemon-config.json and check network access.");
      releaseLock();
      process.exit(1);
    }
    await rebuildCryptoStopOrders();
    await rebuildEquityTrailOrders();
    // Start real-time WebSocket trailing stop monitors
    // They start with no subscriptions; syncWsTrailMeta/startXxxTrailMonitor called on first scan
    console.log("  WebSocket trail monitors: will connect on first scan");
  }

  // Heartbeat every 2 minutes so UI can detect daemon between scans
  setInterval(() => { try { upsertDaemonHeartbeat(process.pid); } catch {} }, 2 * 60 * 1000);

  // Run immediately, then self-schedule — catches errors so daemon never dies between scans
  const schedule = () => {
    const intervalMs = (config.intervalMinutes || 30) * 60 * 1000;
    console.log(`\nNext scan in ${config.intervalMinutes || 30} minutes. Press Ctrl+C to stop.\n`);
    setTimeout(async () => {
      try {
        await runScan();
        consecutiveScanFailures = 0;
      } catch (e) {
        consecutiveScanFailures++;
        console.error("Scan error:", e.message);
        if (consecutiveScanFailures >= 3 && config.telegramChatId) {
          tgSend(config.telegramChatId, `⚠️ FinAnalyzer daemon: ${consecutiveScanFailures} consecutive scan failures.\nLast error: ${e.message}`).catch(() => {});
        }
      }
      schedule(); // always re-schedule, even after an error
    }, intervalMs);
  };

  try { await runScan(); } catch (e) { console.error("Initial scan error:", e.message); }
  schedule();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
