import { formatIndicators, formatNewsItems } from "./indicators.js";

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY;
const DEFAULT_MODEL = "o4-mini";

// ─── JSON Schemas for structured output ────────────────────────────────────
const ANALYZE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "symbol_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "reasoning","symbol","assetClass","sector","market","price","change_pct",
        "trend","score","signal","conviction","horizon","momentum","risk_reward",
        "entry","target","stop","allocation_pct","investor_thesis","swing_thesis",
        "sentiment","prices",
      ],
      properties: {
        reasoning:       { type: "string" },
        symbol:          { type: "string" },
        assetClass:      { type: "string" },
        sector:          { type: "string" },
        market:          { type: "string" },
        price:           { type: "number" },
        change_pct:      { type: "number" },
        trend:           { type: "string", enum: ["up","down","sideways"] },
        score:           { type: "number" },
        signal:          { type: "string", enum: ["BUY","SELL","HOLD","WATCH"] },
        conviction:      { type: "string", enum: ["HIGH","MEDIUM","LOW"] },
        horizon:         { type: "string", enum: ["swing","medium","long"] },
        momentum:        { type: "number" },
        risk_reward:     { type: "number" },
        entry:           { type: "number" },
        target:          { type: "number" },
        stop:            { type: "number" },
        allocation_pct:  { type: "number" },
        investor_thesis: { type: "string" },
        swing_thesis:    { type: "string" },
        sentiment:       { type: "string", enum: ["bullish","neutral","bearish"] },
        prices:          { type: "array", items: { type: "number" } },
      },
    },
  },
};

const DEEPDIVE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "deep_dive",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "overview","fundamental","technical","macro_context",
        "catalysts","risks","investor_plan","swing_plan","portfolio_note","confidence",
      ],
      properties: {
        overview:       { type: "string" },
        fundamental:    { type: "string" },
        technical:      { type: "string" },
        macro_context:  { type: "string" },
        catalysts:      { type: "array", items: { type: "string" } },
        risks:          { type: "array", items: { type: "string" } },
        investor_plan:  { type: "string" },
        swing_plan:     { type: "string" },
        portfolio_note: { type: "string" },
        confidence:     { type: "number" },
      },
    },
  },
};

// ─── Core caller ────────────────────────────────────────────────────────────
const callGPT = async (prompt, maxTokens, responseFormat, model = DEFAULT_MODEL) => {
  const body = {
    model,
    max_completion_tokens: maxTokens,
    reasoning_effort: "high",
    messages: [{ role: "user", content: prompt }],
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || `OpenAI API error ${res.status}`;
    throw new Error(msg);
  }
  const text = data.choices?.[0]?.message?.content || "";
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === "length") {
    console.warn(`[GPT] Response truncated (max_tokens=${maxTokens}). Trying partial parse.`);
  }
  // With structured output the response is already valid JSON; fall back to regex for safety
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON in GPT response. Finish reason: ${finishReason}. Response: ${text.slice(0, 200)}`);
    try { return JSON.parse(match[0]); } catch (e) { throw new Error(`GPT returned malformed JSON: ${e.message}`); }
  }
};

// ─── Post-processing helpers ─────────────────────────────────────────────────

/** Enforce score → conviction alignment (overrides model's choice if inconsistent). */
function normalizeConviction(result) {
  const score = result.score ?? 0;
  const expected = score >= 80 ? "HIGH" : score >= 65 ? "MEDIUM" : "LOW";
  if (result.conviction !== expected) {
    console.warn(`[GPT] Conviction corrected: score=${score} → ${expected} (was ${result.conviction})`);
    result.conviction = expected;
  }
  return result;
}

/**
 * Validate and auto-correct bracket levels where possible.
 * BUY:  stop < entry < target
 * SELL: target < entry < stop
 * If stop/target are simply transposed, swap them. Otherwise mark _bracketInvalid.
 */
function normalizeBracket(result) {
  if (!result.entry || !result.stop || !result.target) return result;

  if (result.signal === "BUY") {
    const ok = result.stop < result.entry && result.target > result.entry;
    if (!ok) {
      // Attempt: both above entry → stop and target swapped
      if (result.stop > result.entry && result.target > result.entry) {
        const [lo, hi] = result.stop < result.target
          ? [result.stop, result.target]
          : [result.target, result.stop];
        if (lo < result.entry && hi > result.entry) {
          console.warn(`[GPT] BUY bracket auto-corrected: stop/target transposed`);
          result.stop = lo;
          result.target = hi;
          return result;
        }
      }
      result._bracketInvalid = true;
    }
  } else if (result.signal === "SELL") {
    const ok = result.target < result.entry && result.stop > result.entry;
    if (!ok) {
      if (result.stop < result.entry && result.target < result.entry) {
        const [lo, hi] = result.stop < result.target
          ? [result.stop, result.target]
          : [result.target, result.stop];
        if (lo < result.entry && hi > result.entry) {
          console.warn(`[GPT] SELL bracket auto-corrected: stop/target transposed`);
          result.target = lo;
          result.stop = hi;
          return result;
        }
      }
      result._bracketInvalid = true;
    }
  }
  return result;
}

// ─── Market session helper ───────────────────────────────────────────────────
function getSessionContext() {
  const now = new Date();
  const etOffset = (() => {
    const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    const stdOffset = Math.max(jan, jul);
    return now.getTimezoneOffset() < stdOffset ? -4 : -5;
  })();
  const etMs = now.getTime() + (now.getTimezoneOffset() + etOffset * 60) * 60 * 1000;
  const et = new Date(etMs);
  const h = et.getUTCHours(), m = et.getUTCMinutes();
  const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET`;
  let session;
  if      (h < 4)                        session = "overnight";
  else if (h < 9 || (h === 9 && m < 30)) session = "pre-market";
  else if (h < 16)                       session = "regular session";
  else if (h < 20)                       session = "after-hours";
  else                                   session = "overnight";
  const minutesLeft = session === "regular session" ? (16 * 60) - (h * 60 + m) : null;
  return `${timeStr} — ${session}${minutesLeft != null ? ` | ${minutesLeft}min until close` : ""}`;
}

/**
 * analyzeSymbol — enriched with pre-computed indicators, fundamentals, macro, and ATR levels.
 */
export const analyzeSymbol = async ({
  symbol, assetClass, market, price, change_pct,
  dayOpen, dayHigh, dayLow, dayVwap, prevClose,
  bars, indicators, atrLevels, fundamentals, macro, portfolioContext, news,
  sectorContext, model,
}) => {
  const priceCtx = price ? `${price} (1d: ${(change_pct || 0).toFixed(2)}%)` : "";

  const intradayCtx = (() => {
    if (!dayOpen || !dayHigh || !dayLow || !price) return "";
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
    return `\n\n=== INTRADAY SESSION ===\n${parts.join(" | ")}`;
  })();

  const indStr = formatIndicators(indicators, atrLevels, assetClass);
  const indCtx = indStr ? `\n\n=== TECHNICAL INDICATORS ===\n${indStr}` : "";

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
      const trend = es.avgEpsSurprisePct != null ? (es.avgEpsSurprisePct > 0 ? "consistent BEATS" : "consistent MISSES") : "";
      lines.push(`EPS surprise (last ${es.totalQuarters}Q): avg ${es.avgEpsSurprisePct != null ? (es.avgEpsSurprisePct > 0 ? "+" : "") + es.avgEpsSurprisePct + "%" : "—"} | beat ${es.beatCount}/${es.totalQuarters} quarters${trend ? " — " + trend : ""}`);
    }
    if (fundamentals.cashFlow) {
      const cf = fundamentals.cashFlow;
      const fcfStr = cf.lastFcf != null ? "$" + (cf.lastFcf / 1e9).toFixed(2) + "B" : "—";
      lines.push(`FCF (most recent Q): ${fcfStr} | Trend: ${cf.fcfTrend ?? "—"}`);
    }
    if (fundamentals.insider) {
      const ins = fundamentals.insider;
      const netStr = ins.netBias === "BUYING" ? "NET BUYING (bullish)" : ins.netBias === "SELLING" ? "NET SELLING (bearish)" : "NEUTRAL";
      lines.push(`Insider activity (90d): ${netStr} | Buys: ${ins.buyTxns} txns $${(ins.buyValue / 1e6).toFixed(1)}M | Sells: ${ins.sellTxns} txns $${(ins.sellValue / 1e6).toFixed(1)}M`);
    }
    if (fundamentals.analystBuy != null) {
      const total = (fundamentals.analystBuy ?? 0) + (fundamentals.analystHold ?? 0) + (fundamentals.analystSell ?? 0);
      const sentiment = fundamentals.analystBuy > fundamentals.analystSell * 2 ? "BULLISH" : fundamentals.analystSell > fundamentals.analystBuy ? "BEARISH" : "MIXED";
      lines.push(`Analysts (${total} covering): ${fundamentals.analystBuy} buy / ${fundamentals.analystHold} hold / ${fundamentals.analystSell} sell — consensus ${sentiment}`);
    }
    return lines.length ? `\n\n=== FUNDAMENTALS & CATALYST RISK ===\n${lines.join("\n")}` : "";
  })();

  const macroCtx = macro
    ? `\n\n=== MACRO ENVIRONMENT ===\n${[
        macro.fedRate      != null ? `Fed Funds Rate: ${macro.fedRate}%` : null,
        macro.cpiYoy       != null ? `CPI YoY: ${macro.cpiYoy}%` : null,
        macro.gdpGrowth    != null ? `Real GDP Growth: ${macro.gdpGrowth}%` : null,
        macro.unemployment != null ? `Unemployment: ${macro.unemployment}%` : null,
        macro.yield2y  != null ? `2Y Treasury: ${macro.yield2y}%` : null,
        macro.yield10y != null ? `10Y Treasury: ${macro.yield10y}%` : null,
        macro.yieldCurve   != null ? `Yield curve: ${macro.yieldCurve}` : null,
        macro.spy ? `SPY: ${macro.spy}` : null,
        macro.vxx ? `VIX proxy (VXX): ${macro.vxx}` : null,
        macro.tlt ? `Bonds (TLT): ${macro.tlt}` : null,
      ].filter(Boolean).join(" | ")}`
    : "";

  const newsCtx = news?.length
    ? `\n\n=== RECENT NEWS & SENTIMENT ===\n${formatNewsItems(news, 300)}`
    : "";

  const portCtx = portfolioContext
    ? `\n\n=== PORTFOLIO CONTEXT ===\n${portfolioContext}`
    : "";

  const sectorCtxStr = sectorContext
    ? `\n\n=== SECTOR PERFORMANCE (TODAY) ===\n${sectorContext}`
    : "";

  const sessionCtxStr = `\n\n=== MARKET SESSION ===\n${getSessionContext()}`;

  const atrHint = atrLevels?.atrBuyStop
    ? `\n- Use ATR-based levels as anchors: BUY stop ≈ ${atrLevels.atrBuyStop}, BUY target ≈ ${atrLevels.atrBuyTarget}. You may adjust up to ±30% but must stay directionally correct.`
    : "";

  const recentCloses = bars
    ? (Array.isArray(bars) ? bars.slice(-20).map(b => b.close) : [])
    : [];

  const isCryptoAsset = assetClass === "Crypto";
  const scoringInstruction = isCryptoAsset
    ? `3. Score on a CRYPTO-NATIVE scale — do NOT penalise for missing equity fundamentals (there are none for crypto):
   - 80–100: technicals bullish/bearish AND Fear & Greed aligned AND BTC regime supportive — all three crypto pillars agree
   - 65–79: two of three pillars agree, or technicals strongly one-directional with no conflicting signals
   - 50–64: mixed signals, one pillar contradicts, or low-conviction technical setup
   - below 50: conflicting signals or clearly unfavourable setup
   HIGH conviction requires score ≥ 80 with at least two pillars aligned.`
    : `3. Score based on weight of evidence — 80+ when the majority of available factors (technicals, fundamentals, macro, news) agree directionally. Full confluence across all four is ideal but not required; 2-3 strongly aligned factors with no major contradicting signal is sufficient for HIGH conviction.`;

  const prompt = `You are a senior portfolio analyst covering global markets. Perform a rigorous multi-factor analysis.

=== ASSET ===
Symbol: ${symbol} | Class: ${assetClass} | Market: ${market}
Price: ${priceCtx}
Today: ${new Date().toISOString().slice(0, 10)}${sessionCtxStr}${intradayCtx}${indCtx}${fundCtx}${macroCtx}${sectorCtxStr}${newsCtx}${portCtx}

=== INSTRUCTIONS ===
1. First, reason through each available data point (technical, fundamental, macro, news) in the "reasoning" field.
2. Produce a trading signal based on the WEIGHT OF EVIDENCE across ALL available factors.
${scoringInstruction}
4. IMPORTANT price level rules:
   - BUY: stop < entry < target (stop must be LESS than entry; target must be GREATER)
   - SELL: target < entry < stop (target must be LESS than entry; stop must be GREATER)${atrHint}
5. conviction MUST match score: score ≥ 80 → HIGH, 65–79 → MEDIUM, < 65 → LOW. Do not contradict this.
6. allocation_pct reflects conviction AND existing exposure (lower if already holding similar).
7. prices array: use the supplied recent closes exactly — ${JSON.stringify(recentCloses)}`;

  const result = await callGPT(prompt, 16000, ANALYZE_FORMAT, model);
  normalizeConviction(result);
  normalizeBracket(result);
  return result;
};

export const deepDiveSymbol = async (sym, model) => {
  const levelStr = sym.entry && sym.stop && sym.target
    ? `Entry: ${sym.entry} | Stop: ${sym.stop} | Target: ${sym.target} | R/R: ${sym.risk_reward ?? "—"}`
    : "";
  const thesisStr = [
    sym.investor_thesis ? `Investor thesis: ${sym.investor_thesis}` : "",
    sym.swing_thesis    ? `Swing thesis: ${sym.swing_thesis}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are a senior portfolio manager. Perform a deep multi-factor analysis of ${sym.symbol}.

=== SCAN RESULT ===
Symbol: ${sym.symbol} | Asset class: ${sym.assetClass} | Sector: ${sym.sector ?? "—"} | Market: ${sym.market ?? "—"}
Price: ${sym.price} | Change: ${sym.change_pct != null ? (sym.change_pct > 0 ? "+" : "") + sym.change_pct.toFixed(2) + "%" : "—"}
Signal: ${sym.signal} | Score: ${sym.score} | Conviction: ${sym.conviction} | Horizon: ${sym.horizon}
Trend: ${sym.trend ?? "—"} | Momentum: ${sym.momentum ?? "—"} | Sentiment: ${sym.sentiment ?? "—"}
${levelStr}
${thesisStr}
${sym.reasoning ? `\nInitial reasoning: ${sym.reasoning}` : ""}

=== INSTRUCTIONS ===
Build on the scan result above with deeper research across all four dimensions (technical, fundamental, macro, catalysts). Do not simply restate the scan reasoning — add new depth and nuance.`;

  const result = await callGPT(prompt, 16000, DEEPDIVE_FORMAT, model);
  // Normalize confidence to 0–10 scale (model sometimes returns 0–1)
  if (result && typeof result.confidence === 'number' && result.confidence <= 1) {
    result.confidence = +(result.confidence * 10).toFixed(1);
  }
  return result;
};
