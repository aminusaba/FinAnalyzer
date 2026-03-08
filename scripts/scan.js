// FinAnalyzer background scan — runs via GitHub Actions
// Uses Node.js built-in fetch (Node 18+), no extra dependencies

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MIN_SCORE = parseInt(process.env.MIN_SCORE || "75");

const WATCHLIST = {
  "US Equities":  ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","XOM","UNH","BAC","AVGO","MA","AMD"],
  "US ETFs":      ["SPY","QQQ","IWM","GLD","TLT","XLK","XLE","XLF","ARKK","SOXX"],
  "Europe/ADRs":  ["ASML","SAP","TTE","SHEL","UL","NVO","AZN","BP","EADSY"],
  "Asia/ADRs":    ["TSM","BABA","SONY","TM","BIDU","SE","HDB","INFY"],
  "Commodities":  ["GLD","SLV","USO","WEAT","CPER"],
};

const CRYPTO = [
  { symbol: "BINANCE:BTCUSDT", display: "BTC/USD" },
  { symbol: "BINANCE:ETHUSDT", display: "ETH/USD" },
  { symbol: "BINANCE:SOLUSDT", display: "SOL/USD" },
];

// ── Finnhub ──────────────────────────────────────────────────────────────────

async function fetchQuote(symbol) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d?.c) return { price: d.c, change_pct: d.dp };
  } catch {}
  return null;
}

async function fetchCrypto({ symbol, display }) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 86400 * 2;
    const r = await fetch(`https://finnhub.io/api/v1/crypto/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d?.s === "ok" && d.c?.length >= 2) {
      const price = d.c[d.c.length - 1];
      const prev = d.c[d.c.length - 2];
      return { symbol: display, price, change_pct: ((price - prev) / prev) * 100, assetClass: "Crypto", market: "Crypto" };
    }
  } catch {}
  return null;
}

async function getTopMovers() {
  const results = [];
  const TOP_N = 3;

  for (const [category, symbols] of Object.entries(WATCHLIST)) {
    const quotes = await Promise.all(symbols.map(async (symbol) => {
      const q = await fetchQuote(symbol);
      if (!q) return null;
      const assetClass = category === "US ETFs" ? "ETF"
        : category === "Commodities" ? "Commodity"
        : category.includes("Europe") ? "Europe"
        : category.includes("Asia") ? "Asia" : "Equity";
      return { symbol, price: q.price, change_pct: q.change_pct, assetClass, market: category };
    }));
    const top = quotes.filter(Boolean).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, TOP_N);
    results.push(...top);
  }

  const crypto = await Promise.all(CRYPTO.map(fetchCrypto));
  results.push(...crypto.filter(Boolean).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct)).slice(0, TOP_N));

  return results;
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function analyzeSymbol({ symbol, assetClass, market, price, change_pct }) {
  const priceCtx = price ? `Live price: ${price}, 1-day change: ${(change_pct || 0).toFixed(2)}%.` : "";
  const prompt = `You are a senior portfolio analyst. Analyze ${symbol} (${assetClass}, ${market}). ${priceCtx} Today: ${new Date().toISOString().slice(0, 10)}.
Return ONLY valid JSON, no markdown:
{
  "symbol": "${symbol}",
  "assetClass": "${assetClass}",
  "sector": "<sector>",
  "price": <number>,
  "change_pct": <number>,
  "score": <0-100>,
  "signal": "BUY|SELL|HOLD|WATCH",
  "conviction": "HIGH|MEDIUM|LOW",
  "horizon": "swing|medium|long",
  "risk_reward": <number>,
  "target": <number>,
  "stop": <number>,
  "allocation_pct": <1-10>,
  "investor_thesis": "<2-3 sentence investment case>"
}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON");
  return JSON.parse(match[0]);
}

// ── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(result) {
  const { symbol, signal, score, conviction, assetClass, investor_thesis, target, stop, sector } = result;
  const emoji = signal === "BUY" ? "🟢" : signal === "SELL" ? "🔴" : "🟡";
  const text = `${emoji} <b>${signal}: ${symbol}</b> [${assetClass}]\n📊 Score: ${score} | Conviction: ${conviction}\n🏷 Sector: ${sector}\n🎯 Target: ${target} | 🛑 Stop: ${stop}\n\n💡 ${investor_thesis}`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, parse_mode: "HTML", text }),
  });
}

// ── History ──────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "fs";

const HISTORY_FILE = "data/scan-history.json";
const MAX_HISTORY = 50; // keep last 50 scans

function loadHistory() {
  try { return JSON.parse(readFileSync(HISTORY_FILE, "utf8")); } catch { return []; }
}

function saveHistory(history) {
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${new Date().toISOString()}] Starting scan...`);

  if (!FINNHUB_KEY || !OPENAI_KEY || !TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Missing required environment variables.");
    process.exit(1);
  }

  const symbols = await getTopMovers();
  console.log(`Fetched ${symbols.length} top movers`);

  const results = [];
  const alerts = [];

  for (const sym of symbols) {
    try {
      console.log(`Analyzing ${sym.symbol}...`);
      const result = await analyzeSymbol(sym);
      results.push(result);
      const qualifies = result.signal === "BUY" && result.score >= MIN_SCORE && result.conviction === "HIGH";
      if (qualifies) {
        console.log(`  → ALERT: ${result.symbol} score=${result.score} conviction=${result.conviction}`);
        await sendTelegram(result);
        alerts.push(result.symbol);
      } else {
        console.log(`  → ${result.signal} score=${result.score} (skipped)`);
      }
    } catch (e) {
      console.error(`  → Error analyzing ${sym.symbol}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Save scan to history
  const history = loadHistory();
  history.unshift({
    timestamp: new Date().toISOString(),
    results,
    alerts,
  });
  saveHistory(history.slice(0, MAX_HISTORY));

  console.log(`Scan complete. Alerts sent: ${alerts.length > 0 ? alerts.join(", ") : "none"}`);
}

main().catch(e => { console.error(e); process.exit(1); });
