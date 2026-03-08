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
const config = loadConfig();

const OPENAI_KEY    = ENV.VITE_OPENAI_KEY;
const FINNHUB_KEY   = ENV.VITE_FINNHUB_KEY;
const TELEGRAM_TOKEN = ENV.VITE_TELEGRAM_BOT_TOKEN;

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

async function getSnapshots(symbols) {
  const res = await fetch(`${DATA_URL}/v2/stocks/snapshots?symbols=${symbols.join(",")}`, {
    headers: alpacaHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca data ${res.status}`);
  return data;
}

async function getCryptoBars(symbol) {
  const res = await fetch(
    `${DATA_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&limit=2`,
    { headers: alpacaHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const bars = data.bars?.[symbol];
  return Array.isArray(bars) && bars.length >= 2 ? bars : null;
}

// ─── Finnhub (rate limited — 5 concurrent max) ─────────────────────────────

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

async function finnhubQuote(symbol) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await res.json();
    if (d?.c) return { price: d.c, change_pct: d.dp ?? 0 };
  } catch {}
  return null;
}

// ─── Market data ────────────────────────────────────────────────────────────

async function fetchMarketData() {
  const results = new Map();

  // Finnhub equities (rate limited)
  if (FINNHUB_KEY) {
    const UNIVERSE = {
      "US Equities": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","XOM"],
      "US ETFs":     ["SPY","QQQ","IWM","GLD","TLT","XLK","XLE","XLF"],
      "Europe/ADRs": ["ASML","SAP","NVO","AZN","TSM"],
    };
    const tasks = Object.entries(UNIVERSE).flatMap(([cat, syms]) =>
      syms.map(symbol => async () => {
        const q = await finnhubQuote(symbol);
        if (!q) return;
        const assetClass = cat === "US ETFs" ? "ETF" : cat.includes("Europe") ? "Europe" : "Equity";
        results.set(symbol, { symbol, ...q, assetClass, market: cat });
      })
    );
    await withConcurrency(tasks, 5);
  }

  // Alpaca snapshots (more accurate, overwrites Finnhub)
  if (config.alpacaKey && config.alpacaSecret) {
    try {
      const symbols = ALPACA_SCAN_SYMBOLS.map(s => s.symbol);
      const snaps = await getSnapshots(symbols);
      for (const { symbol, assetClass, market } of ALPACA_SCAN_SYMBOLS) {
        const snap = snaps[symbol];
        if (!snap) continue;
        const price     = snap.dailyBar?.c || snap.latestTrade?.p || 0;
        const prevClose = snap.prevDailyBar?.c;
        const change_pct = prevClose && price ? ((price - prevClose) / prevClose) * 100 : 0;
        if (price > 0) results.set(symbol, { symbol, price, change_pct, assetClass, market });
      }
    } catch (e) {
      console.warn("[WARN] Alpaca snapshot error:", e.message);
    }

    // Alpaca crypto bars
    for (const { display } of CRYPTO_SYMBOLS) {
      try {
        const bars = await getCryptoBars(display);
        if (bars) {
          const price = bars[bars.length - 1].c;
          const prev  = bars[bars.length - 2].c;
          if (price && prev) {
            results.set(display, { symbol: display, price, change_pct: ((price - prev) / prev) * 100, assetClass: "Crypto", market: "Crypto" });
          }
        }
      } catch {}
    }
  }

  return [...results.values()]
    .filter(s => s.price > 0)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}

// ─── OpenAI analysis ────────────────────────────────────────────────────────

async function analyzeSymbol(sym, portfolioContext) {
  const portCtx = portfolioContext ? `\nCurrent portfolio: ${portfolioContext}` : "";
  const prompt = `You are a senior portfolio analyst.
Asset: ${sym.symbol} | Class: ${sym.assetClass} | Market: ${sym.market}
Live price: ${sym.price}, 1-day change: ${(sym.change_pct || 0).toFixed(2)}%.${portCtx}
Today: ${new Date().toISOString().slice(0, 10)}
IMPORTANT: For BUY signals, stop < entry < target. For SELL signals, stop > entry > target.

Return ONLY valid JSON:
{"symbol":"${sym.symbol}","assetClass":"${sym.assetClass}","market":"${sym.market}","price":${sym.price},"change_pct":${sym.change_pct},"signal":"BUY|SELL|HOLD|WATCH","score":<0-100>,"conviction":"HIGH|MEDIUM|LOW","horizon":"swing|medium|long","entry":<number>,"target":<number>,"stop":<number>,"allocation_pct":<1-10>,"risk_reward":<number>,"investor_thesis":"<2-3 sentences>"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "gpt-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in GPT response");
  const r = JSON.parse(match[0]);

  // Validate R/R math
  if (r.signal === "BUY" && r.entry && r.stop && r.target) {
    r._bracketInvalid = r.stop >= r.entry || r.target <= r.entry;
  }
  return r;
}

// ─── Telegram ───────────────────────────────────────────────────────────────

async function tgSend(text) {
  if (!TELEGRAM_TOKEN || !config.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.telegramChatId, parse_mode: "HTML", text }),
    });
  } catch {}
}

async function alertSignal(r) {
  const emoji = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "🟡";
  await tgSend(`${emoji} <b>${r.signal}: ${r.symbol}</b> [${r.assetClass}]\nScore: ${r.score} | Conviction: ${r.conviction}\nEntry: ${r.entry} | Target: ${r.target} | Stop: ${r.stop}\n\n${r.investor_thesis}`);
}

async function alertOrder(symbol, side, notional, extra = "") {
  const emoji = side === "buy" ? "🛒" : "📤";
  await tgSend(`${emoji} <b>Order: ${side.toUpperCase()} ${symbol}</b>\nAmount: $${Number(notional).toFixed(2)}${extra}`);
}

// ─── Auto-trade ─────────────────────────────────────────────────────────────

async function maybeAutoTrade(r, currentPositions, remainingBuyingPower, circuitBreaker) {
  if (!config.autoTradeEnabled || !config.alpacaKey || !config.alpacaSecret) return remainingBuyingPower;
  const isSupported = r.assetClass === "Equity" || r.assetClass === "ETF";
  if (!isSupported) return remainingBuyingPower;

  const existingPosition = currentPositions.get(r.symbol);
  const alreadyInvested = existingPosition?.marketValue ?? 0;
  const targetNotional = (config.walletSize || 0) * (r.allocation_pct / 100);
  const notional = Math.max(0, targetNotional - alreadyInvested);

  if (r.signal === "BUY") {
    if (circuitBreaker.tripped) { console.log(`  ⚡ ${r.symbol}: circuit breaker tripped`); return remainingBuyingPower; }
    if (r.score < (config.minScore || 75)) { console.log(`  ⚡ ${r.symbol}: score too low (${r.score})`); return remainingBuyingPower; }
    if (r.conviction !== "HIGH" && config.minConviction === "HIGH") { console.log(`  ⚡ ${r.symbol}: conviction ${r.conviction} below threshold`); return remainingBuyingPower; }
    if (alreadyInvested >= targetNotional * 0.9) { console.log(`  ⚡ ${r.symbol}: already holding $${alreadyInvested.toFixed(0)} (target $${targetNotional.toFixed(0)})`); return remainingBuyingPower; }
    if (notional < 1) { console.log(`  ⚡ ${r.symbol}: allocation too small`); return remainingBuyingPower; }
    if (remainingBuyingPower !== null && notional > remainingBuyingPower) { console.log(`  ⚡ ${r.symbol}: insufficient buying power ($${remainingBuyingPower?.toFixed(0)} < $${notional.toFixed(0)})`); return remainingBuyingPower; }

    try {
      const useBracket = config.bracketOrdersEnabled && r.stop && r.target && !r._bracketInvalid;
      const qty = parseFloat((notional / r.price).toFixed(6));
      const body = {
        symbol: r.symbol, qty, side: "buy", type: "market", time_in_force: "day",
        ...(useBracket && {
          order_class: "bracket",
          take_profit: { limit_price: r.target.toFixed(4) },
          stop_loss:   { stop_price: r.stop.toFixed(4) },
        }),
      };
      await alpacaPost("/v2/orders", body);
      circuitBreaker.failures = 0;
      remainingBuyingPower -= notional;
      // Update live position map
      currentPositions.set(r.symbol, {
        qty: (existingPosition?.qty ?? 0) + qty,
        avgPrice: r.price,
        marketValue: alreadyInvested + notional,
      });
      const existingNote = alreadyInvested > 0 ? ` (adding to $${alreadyInvested.toFixed(0)} existing)` : "";
      const bracketNote = useBracket ? ` | SL $${r.stop.toFixed(2)} / TP $${r.target.toFixed(2)}` : "";
      console.log(`  🛒 Bought ${r.symbol} · $${notional.toFixed(0)}${existingNote}${bracketNote}`);
      await alertOrder(r.symbol, "buy", notional, `${existingNote}${bracketNote}`);
    } catch (e) {
      circuitBreaker.failures++;
      if (circuitBreaker.failures >= 3) { circuitBreaker.tripped = true; console.log("  ⛔ Circuit breaker tripped"); }
      console.error(`  ⚠ Order failed for ${r.symbol}: ${e.message}`);
    }
  } else if (r.signal === "SELL") {
    try {
      await fetch(`${tradeBase()}/v2/positions/${encodeURIComponent(r.symbol)}`, { method: "DELETE", headers: alpacaHeaders() });
      currentPositions.delete(r.symbol);
      console.log(`  📤 Closed position: ${r.symbol}`);
      await alertOrder(r.symbol, "sell", alreadyInvested);
    } catch {} // no position to close
  }

  return remainingBuyingPower;
}

// ─── History ────────────────────────────────────────────────────────────────

function saveHistory(results) {
  try {
    const dir = path.join(__dirname, "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, "scan-history.json");
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    existing.unshift({
      timestamp: new Date().toISOString(),
      results: results.map(r => ({
        symbol: r.symbol, assetClass: r.assetClass, signal: r.signal,
        conviction: r.conviction, score: r.score, investor_thesis: r.investor_thesis,
      })),
      alerts: results.filter(r => r.signal === "BUY" && r.score >= (config.minScore || 75)).map(r => r.symbol),
    });
    fs.writeFileSync(file, JSON.stringify(existing.slice(0, 30), null, 2));
  } catch {}
}

// ─── Main scan loop ─────────────────────────────────────────────────────────

async function runScan() {
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] Starting scan...`);

  // Fetch market data
  let allSymbols;
  try {
    allSymbols = await fetchMarketData();
    console.log(`  Found ${allSymbols.length} symbols`);
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
      const rawBp = parseFloat(account.buying_power || account.cash || 0);
      const capPct = (config.tradingCapitalPct ?? 100) / 100;
      buyingPower = rawBp * capPct;
      console.log(`  Buying power: $${rawBp.toFixed(0)} total · using $${buyingPower.toFixed(0)} (${config.tradingCapitalPct ?? 100}%)`);
      if (Array.isArray(positions)) {
        for (const p of positions) {
          currentPositions.set(p.symbol, {
            qty:         parseFloat(p.qty || 0),
            avgPrice:    parseFloat(p.avg_entry_price || 0),
            marketValue: parseFloat(p.market_value || 0),
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

  const buildPortfolioContext = (positions, bp) => {
    const totalInvested = [...positions.values()].reduce((s, p) => s + p.marketValue, 0);
    const header = `Buying power: $${bp?.toFixed(0) ?? "unknown"} | Total invested: $${totalInvested.toFixed(0)}`;
    if (!positions.size) return header;
    const holdings = [...positions.entries()]
      .map(([sym, p]) => `${sym}: ${p.qty.toFixed(4)} shares @ avg $${p.avgPrice.toFixed(2)} (value $${p.marketValue.toFixed(0)})`)
      .join("; ");
    return `${header}\nHoldings: ${holdings}`;
  };

  // Analyze each symbol
  const results = [];
  const circuitBreaker = { failures: 0, tripped: false };
  const topSymbols = allSymbols.slice(0, config.maxSymbols || 30); // cap to avoid excessive GPT cost

  let remainingBuyingPower = buyingPower;
  for (let i = 0; i < topSymbols.length; i++) {
    const sym = topSymbols[i];
    process.stdout.write(`  [${i + 1}/${topSymbols.length}] ${sym.symbol.padEnd(10)} `);

    try {
      // Rebuild context before each call so GPT sees orders placed earlier in this scan
      const portfolioContext = buildPortfolioContext(currentPositions, remainingBuyingPower);
      const r = await analyzeSymbol(sym, portfolioContext);
      results.push(r);

      const indicator = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "🟡";
      console.log(`${indicator} ${r.signal.padEnd(5)} score=${r.score} conviction=${r.conviction}`);

      // Send alert for qualifying BUY signals
      if (r.signal === "BUY" && r.score >= (config.minScore || 75)) {
        await alertSignal(r);
      }

      // Auto-trade (updates currentPositions and remainingBuyingPower in place)
      remainingBuyingPower = await maybeAutoTrade(r, currentPositions, remainingBuyingPower, circuitBreaker);

      // Small delay to avoid OpenAI rate limits
      await new Promise(res => setTimeout(res, 300));
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }

  saveHistory(results);
  console.log(`  Scan complete — ${results.length} analyzed`);
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

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

  // Run immediately, then on interval
  await runScan();

  const intervalMs = (config.intervalMinutes || 30) * 60 * 1000;
  console.log(`\nNext scan in ${config.intervalMinutes || 30} minutes. Press Ctrl+C to stop.\n`);

  setInterval(async () => {
    await runScan();
    console.log(`\nNext scan in ${config.intervalMinutes || 30} minutes.\n`);
  }, intervalMs);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
