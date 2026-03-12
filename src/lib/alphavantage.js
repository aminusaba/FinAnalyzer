/**
 * Alpha Vantage data via the official AV MCP server.
 * All calls go through /av-mcp (Vite proxy → https://mcp.alphavantage.co/mcp).
 * Tool names match AV REST API function names exactly.
 * Paid tier: entitlement=delayed for US equity real-time endpoints.
 */
import { avCall } from "./av-mcp.js";

// ─── Quotes ─────────────────────────────────────────────────────────────────

export async function getQuote(symbol) {
  const d = await avCall("GLOBAL_QUOTE", { symbol, entitlement: "delayed" });
  const q = d?.["Global Quote"];
  if (!q?.["05. price"]) return null;
  return {
    price:      parseFloat(q["05. price"]),
    change_pct: parseFloat(q["10. change percent"]?.replace("%", "") || 0),
  };
}

/** Batch quotes for multiple symbols — far more efficient than individual GLOBAL_QUOTE calls */
export async function getBulkQuotes(symbols) {
  const d = await avCall("REALTIME_BULK_QUOTES", { symbols: symbols.join(","), entitlement: "delayed" });
  const rows = d?.data ?? [];
  const map = new Map();
  for (const r of rows) {
    const sym   = r.symbol;
    const price = parseFloat(r.price || r.close || 0);
    const prev  = parseFloat(r.previous_close || 0);
    if (sym && price > 0) {
      map.set(sym, {
        price,
        change_pct: prev > 0 ? ((price - prev) / prev) * 100 : parseFloat(r.change_percentage?.replace("%", "") || 0),
      });
    }
  }
  return map;
}

export async function getCryptoQuote(symbol) {
  // symbol = base currency e.g. "BTC"
  const d = await avCall("DIGITAL_CURRENCY_DAILY", { symbol, market: "USD" });
  const ts = d?.["Time Series (Digital Currency Daily)"];
  if (!ts) return null;
  const dates = Object.keys(ts).sort().reverse();
  if (dates.length < 2) return null;
  const price = parseFloat(ts[dates[0]]?.["4a. close (USD)"] || ts[dates[0]]?.["4. close"]);
  const prev  = parseFloat(ts[dates[1]]?.["4a. close (USD)"] || ts[dates[1]]?.["4. close"]);
  if (!price || !prev) return null;
  return { price, change_pct: ((price - prev) / prev) * 100 };
}

export async function getForexRate(fromCurrency) {
  const d    = await avCall("CURRENCY_EXCHANGE_RATE", { from_currency: fromCurrency, to_currency: "USD" });
  const rate = parseFloat(d?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]);
  return rate > 0 ? rate : null;
}

// ─── Daily Adjusted Bars (split/dividend-adjusted, 15-min delayed) ───────────

/**
 * Returns daily OHLCV bars using split-adjusted closing prices.
 * outputsize: "compact" = ~100 bars | "full" = up to 20 years of history.
 * Default is "full" so SMA200 (needs 200+ bars) always has enough data.
 * Uses entitlement=delayed for 15-min delayed US stock data on paid AV tier.
 */
export async function getDailyAdjusted(symbol, outputsize = "full") {
  const d = await avCall("TIME_SERIES_DAILY_ADJUSTED", {
    symbol,
    outputsize,
    entitlement: "delayed",
  });
  const ts = d?.["Time Series (Daily)"];
  if (!ts) return null;
  return Object.entries(ts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      time:   date,
      open:   parseFloat(v["1. open"]),
      high:   parseFloat(v["2. high"]),
      low:    parseFloat(v["3. low"]),
      close:  parseFloat(v["5. adjusted close"]), // split/dividend-adjusted
      volume: parseInt(v["6. volume"]),
    }))
    .filter(b => b.close > 0);
}

// ─── Fundamentals ────────────────────────────────────────────────────────────

export async function getOverview(symbol) {
  const d = await avCall("COMPANY_OVERVIEW", { symbol });
  if (!d?.Symbol) return null;

  const int = k => { const v = parseInt(d[k]);   return isNaN(v) ? null : v; };
  const flt = k => { const v = parseFloat(d[k]); return isNaN(v) || v <= 0 ? null : v; };
  const pct = k => { const v = parseFloat(d[k]); return isNaN(v) ? null : +(v * 100).toFixed(2); };

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
  };
}

export async function getEarningsCalendar(symbol) {
  const result = await avCall("EARNINGS_CALENDAR", { symbol, horizon: "3month" });
  // Result may be CSV text or parsed JSON array
  const today = new Date().toISOString().slice(0, 10);

  let upcoming = null;
  if (typeof result === "string") {
    // CSV: symbol,name,reportDate,fiscalDateEnding,estimate,currency
    const lines = result.trim().split("\n").slice(1);
    upcoming = lines
      .map(l => l.split(",")[2]?.trim())
      .filter(d => d && d >= today)
      .sort()[0] ?? null;
  } else if (Array.isArray(result)) {
    upcoming = result.map(r => r.reportDate).filter(d => d && d >= today).sort()[0] ?? null;
  } else if (result?.earningsCalendar) {
    upcoming = result.earningsCalendar.map(r => r.reportDate ?? r.date).filter(d => d && d >= today).sort()[0] ?? null;
  }

  if (!upcoming) return null;
  return {
    nextEarningsDate:    upcoming,
    nextEarningsDaysAway: Math.round((new Date(upcoming) - new Date()) / 86400000),
  };
}

/**
 * Last 4 quarters of EPS actual vs estimate + surprise %.
 * Returns avgEpsSurprisePct (mean over last 4Q), beatCount, and per-quarter detail.
 */
export async function getEarningsSurprise(symbol) {
  const d = await avCall("EARNINGS", { symbol });
  const quarters = d?.quarterlyEarnings;
  if (!quarters?.length) return null;

  const recent = quarters.slice(0, 4).map(q => ({
    date:         q.fiscalDateEnding,
    reportedEPS:  parseFloat(q.reportedEPS),
    estimatedEPS: parseFloat(q.estimatedEPS),
    surprisePct:  parseFloat(q.surprisePercentage),
  })).filter(q => !isNaN(q.reportedEPS));

  if (!recent.length) return null;

  const validSurprises = recent.filter(q => !isNaN(q.surprisePct));
  const avgSurprise = validSurprises.length
    ? validSurprises.reduce((s, q) => s + q.surprisePct, 0) / validSurprises.length
    : null;

  return {
    lastQuarters:      recent,
    avgEpsSurprisePct: avgSurprise != null ? +avgSurprise.toFixed(2) : null,
    beatCount:         validSurprises.filter(q => q.surprisePct > 0).length,
    totalQuarters:     validSurprises.length,
  };
}

/**
 * Insider buying/selling activity over the last 90 days.
 * Returns netBias (BUYING/SELLING/NEUTRAL), buy/sell value totals and transaction counts.
 */
export async function getInsiderActivity(symbol) {
  const d = await avCall("INSIDER_TRANSACTIONS", { symbol });
  const txns = d?.data;
  if (!txns?.length) return null;

  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const recent = txns.filter(t => t.transaction_date >= cutoff);
  if (!recent.length) return null;

  let buyValue = 0, sellValue = 0, buyTxns = 0, sellTxns = 0;
  for (const t of recent) {
    const val = parseFloat(t.value) || 0;
    if (t.acquisition_or_disposal === "A") { buyValue += val; buyTxns++; }
    else if (t.acquisition_or_disposal === "D") { sellValue += val; sellTxns++; }
  }

  const netBias = buyValue > sellValue * 1.5 ? "BUYING"
    : sellValue > buyValue * 1.5 ? "SELLING"
    : "NEUTRAL";

  return { buyValue, sellValue, buyTxns, sellTxns, netBias };
}

/**
 * Free cash flow from last 4 quarters of operating cash flow minus capex.
 * Returns lastFcf (most recent quarter), fcfTrend (IMPROVING/DECLINING), and quarters array.
 */
export async function getCashFlow(symbol) {
  const d = await avCall("CASH_FLOW", { symbol });
  const qtrs = d?.quarterlyReports;
  if (!qtrs?.length) return null;

  const recent = qtrs.slice(0, 4).map(q => {
    const ocf   = parseFloat(q.operatingCashflow);
    const capex = parseFloat(q.capitalExpenditures);
    const fcf   = !isNaN(ocf) && !isNaN(capex) ? ocf - Math.abs(capex) : null;
    return { date: q.fiscalDateEnding, operatingCashflow: isNaN(ocf) ? null : ocf, fcf };
  }).filter(q => q.operatingCashflow != null);

  if (!recent.length) return null;

  const fcfVals = recent.map(q => q.fcf).filter(v => v != null);
  let fcfTrend = null;
  if (fcfVals.length >= 2) {
    const prior = fcfVals.slice(1).reduce((s, v) => s + v, 0) / (fcfVals.length - 1);
    fcfTrend = fcfVals[0] > prior ? "IMPROVING" : "DECLINING";
  }

  return { lastFcf: fcfVals[0] ?? null, fcfTrend, quarters: recent };
}

// ─── News + Sentiment ────────────────────────────────────────────────────────

export async function getNewsSentiment(symbol, limit = 8) {
  const d = await avCall("NEWS_SENTIMENT", { tickers: symbol, limit, sort: "LATEST" });
  if (!d?.feed?.length) return [];

  return d.feed.map(item => {
    const tickerSent = item.ticker_sentiment?.find(t => t.ticker === symbol);
    const raw  = item.time_published || "";
    const date = raw.length >= 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "";
    return {
      date,
      headline:       item.title || "",
      summary:        item.summary?.slice(0, 300) || "",
      sentimentScore: parseFloat(tickerSent?.ticker_sentiment_score ?? item.overall_sentiment_score ?? 0),
      sentimentLabel: tickerSent?.ticker_sentiment_label || item.overall_sentiment_label || "",
      relevance:      parseFloat(tickerSent?.relevance_score ?? 1),
      topics:         (item.topics || []).map(t => t.topic).slice(0, 3),
    };
  })
  .filter(n => n.relevance >= 0.3)
  .sort((a, b) => b.relevance - a.relevance)
  .slice(0, limit);
}

// ─── Treasury Yields ─────────────────────────────────────────────────────────

/**
 * 2-year, 10-year, 30-year treasury yields + yield curve shape.
 * yieldCurve: "INVERTED" (2y > 10y), "FLAT" (spread < 0.5%), or "NORMAL".
 */
export async function getTreasuryYields() {
  const [y2, y10, y30] = await Promise.allSettled([
    avCall("TREASURY_YIELD", { interval: "monthly", maturity: "2year" }),
    avCall("TREASURY_YIELD", { interval: "monthly", maturity: "10year" }),
    avCall("TREASURY_YIELD", { interval: "monthly", maturity: "30year" }),
  ]);

  const val = r => {
    if (r.status !== "fulfilled") return null;
    const v = parseFloat(r.value?.data?.[0]?.value);
    return isNaN(v) ? null : +v.toFixed(2);
  };

  const y2v  = val(y2);
  const y10v = val(y10);
  const y30v = val(y30);

  let yieldCurve = null;
  if (y2v != null && y10v != null) {
    const spread = +(y10v - y2v).toFixed(2);
    yieldCurve = spread < 0 ? "INVERTED" : spread < 0.5 ? "FLAT" : "NORMAL";
  }

  return { yield2y: y2v, yield10y: y10v, yield30y: y30v, yieldCurve };
}

// ─── Economic macro indicators ───────────────────────────────────────────────

let _macroCache = null;
let _macroCacheTime = 0;
const MACRO_TTL = 6 * 60 * 60 * 1000; // 6 hours — economic data is monthly/quarterly

export async function getMacroEconomics() {
  if (_macroCache && Date.now() - _macroCacheTime < MACRO_TTL) return _macroCache;

  const [fedRes, cpiRes, gdpRes, unempRes, yieldsRes] = await Promise.allSettled([
    avCall("FEDERAL_FUNDS_RATE", { interval: "monthly" }),
    avCall("CPI",                { interval: "monthly" }),
    avCall("REAL_GDP",           { interval: "quarterly" }),
    avCall("UNEMPLOYMENT",       { interval: "monthly" }),
    getTreasuryYields(),
  ]);

  const val = r => {
    if (r.status !== "fulfilled") return null;
    const v = parseFloat(r.value?.data?.[0]?.value);
    return isNaN(v) ? null : +v.toFixed(2);
  };

  // CPI is an index level — compute YoY % change
  let cpiYoy = null;
  if (cpiRes.status === "fulfilled" && cpiRes.value?.data?.length >= 13) {
    const cur = parseFloat(cpiRes.value.data[0].value);
    const ago = parseFloat(cpiRes.value.data[12].value);
    if (ago > 0) cpiYoy = +((cur - ago) / ago * 100).toFixed(2);
  }

  const yields = yieldsRes.status === "fulfilled" ? yieldsRes.value : {};

  _macroCache = {
    fedRate:      val(fedRes),
    cpiYoy,
    gdpGrowth:    val(gdpRes),
    unemployment: val(unempRes),
    yield2y:      yields.yield2y  ?? null,
    yield10y:     yields.yield10y ?? null,
    yield30y:     yields.yield30y ?? null,
    yieldCurve:   yields.yieldCurve ?? null,
  };
  _macroCacheTime = Date.now();
  return _macroCache;
}
