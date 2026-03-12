/**
 * Technical indicator calculations from OHLCV bar data.
 * All functions accept bars sorted oldest → newest.
 * bars = [{ time, open, high, low, close, volume }, ...]
 */

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  return arr.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function ema(arr, period) {
  if (!arr || arr.length < period) return null;
  const k = 2 / (period + 1);
  let e = arr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
  }
  return e;
}

/**
 * Compute all technical indicators from OHLCV bars.
 * Returns null fields when insufficient data.
 */
export function computeIndicators(bars) {
  if (!bars || bars.length < 2) return {};
  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume ?? 0);
  const n = closes.length;

  // RSI(14) — Wilder's smoothing (proper implementation, not simplified average)
  const rsi14 = (() => {
    if (n < 15) return null;
    // Seed: simple average of first 14 price changes
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= 14; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) avgGain += d; else avgLoss -= d;
    }
    avgGain /= 14;
    avgLoss /= 14;
    // Wilder's exponential smoothing over all remaining bars
    for (let i = 15; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      avgGain = (avgGain * 13 + (d > 0 ? d : 0)) / 14;
      avgLoss = (avgLoss * 13 + (d < 0 ? -d : 0)) / 14;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  })();

  // ATR(14) — Wilder's smoothing over full history (not simple avg of last 14 bars)
  const atr14 = (() => {
    if (n < 15) return null;
    // Seed: simple average of first 14 true ranges
    let atr = 0;
    for (let i = 1; i <= 14; i++) {
      atr += Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i]  - closes[i - 1]),
      );
    }
    atr /= 14;
    // Wilder's smoothing: ATR = (prev_ATR * 13 + current_TR) / 14
    for (let i = 15; i < n; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i]  - closes[i - 1]),
      );
      atr = (atr * 13 + tr) / 14;
    }
    return atr;
  })();

  const sma20v  = sma(closes, 20);
  const sma50v  = sma(closes, 50);
  const sma200v = closes.length >= 200 ? sma(closes, 200) : null;
  // MACD + signal + histogram — O(n) incremental EMA, replaces O(n²) slice-based approach
  const { macd, macdSignal, macdHist, macdCross } = (() => {
    if (n < 26) return { macd: null, macdSignal: null, macdHist: null, macdCross: null };
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;

    // EMA12: seeded from first 12 bars, then updated forward through all bars
    const ema12Arr = new Array(n).fill(null);
    ema12Arr[11] = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
    for (let i = 12; i < n; i++) ema12Arr[i] = closes[i] * k12 + ema12Arr[i - 1] * (1 - k12);

    // EMA26: seeded from first 26 bars; MACD series starts at index 25
    let e26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
    const macdArr = [];
    for (let i = 25; i < n; i++) {
      if (i > 25) e26 = closes[i] * k26 + e26 * (1 - k26);
      macdArr.push(ema12Arr[i] - e26);
    }

    const lastMacd = macdArr[macdArr.length - 1];
    if (macdArr.length < 9) {
      return { macd: +lastMacd.toFixed(4), macdSignal: null, macdHist: null, macdCross: null };
    }

    // Signal = EMA9 of MACD series, built incrementally
    let sig = macdArr.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
    const sigArr = [sig];
    for (let i = 9; i < macdArr.length; i++) {
      sig = macdArr[i] * k9 + sig * (1 - k9);
      sigArr.push(sig);
    }

    const lastSig = sigArr[sigArr.length - 1];
    const hist    = lastMacd - lastSig;

    // 2-bar confirmed crossover — requires two consecutive bars on same side after flip
    let macdCross = null;
    const mLen = macdArr.length, sLen = sigArr.length;
    if (mLen >= 3 && sLen >= 3) {
      const currAbove  = macdArr[mLen - 1] > sigArr[sLen - 1];
      const prev1Above = macdArr[mLen - 2] > sigArr[sLen - 2];
      const prev2Above = macdArr[mLen - 3] > sigArr[sLen - 3];
      if ( currAbove &&  prev1Above && !prev2Above) macdCross = "bullish";
      if (!currAbove && !prev1Above &&  prev2Above) macdCross = "bearish";
    }

    return {
      macd:       +lastMacd.toFixed(4),
      macdSignal: +lastSig.toFixed(4),
      macdHist:   +hist.toFixed(4),
      macdCross,
    };
  })();

  // Volume ratio — today vs ADV (20-day average daily volume)
  const volRatio = (() => {
    if (volumes.length < 20) return null;
    const v5  = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
    const v20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
    return v20 > 0 ? v5 / v20 : null;
  })();

  // ADV (20-day average daily volume) — used to contextualise today's volume
  const adv20 = (() => {
    if (volumes.length < 20) return null;
    return Math.round(volumes.slice(-20).reduce((s, v) => s + v, 0) / 20);
  })();

  // Liquidity tier — warns GPT about execution risk for illiquid names
  const liquidityFlag = adv20 == null ? null
    : adv20 < 500_000   ? "LOW"    // <500K shares/day — wide spreads, slippage risk
    : adv20 < 2_000_000 ? "MEDIUM" // 500K–2M
    : "HIGH";                       // >2M — liquid

  // Bollinger %B (20-day, 2σ)
  const bollingerPct = (() => {
    if (sma20v == null || n < 20) return null;
    const slice  = closes.slice(-20);
    const stddev = Math.sqrt(slice.reduce((s, v) => s + (v - sma20v) ** 2, 0) / 20);
    if (stddev === 0) return null;
    const price  = closes[n - 1];
    const upper  = sma20v + 2 * stddev;
    const lower  = sma20v - 2 * stddev;
    return (price - lower) / (upper - lower);
  })();

  // 52-week high/low (uses all available bars, up to 252)
  const yearBars = bars.slice(-252);
  const high52w  = Math.max(...yearBars.map(b => b.high));
  const low52w   = Math.min(...yearBars.map(b => b.low));
  const price    = closes[n - 1];

  // Period returns (1-week ≈ 5 sessions, 1-month ≈ 21, 3-month ≈ 63)
  const ret1w = n >= 6  ? +((price - closes[n - 6])  / closes[n - 6]  * 100).toFixed(2) : null;
  const ret1m = n >= 22 ? +((price - closes[n - 22]) / closes[n - 22] * 100).toFixed(2) : null;
  const ret3m = n >= 64 ? +((price - closes[n - 64]) / closes[n - 64] * 100).toFixed(2) : null;

  // Consecutive up/down closes (last 5 sessions)
  const recentC = closes.slice(-6);
  let consUp = 0, consDown = 0;
  for (let i = recentC.length - 1; i > 0; i--) {
    if (recentC[i] > recentC[i - 1]) {
      if (consDown > 0) break;
      consUp++;
    } else if (recentC[i] < recentC[i - 1]) {
      if (consUp > 0) break;
      consDown++;
    } else break;
  }

  // Volume trend: 3-day avg vs 10-day avg
  const volTrend = (() => {
    if (volumes.length < 10) return null;
    const v3  = volumes.slice(-3).reduce((s, v) => s + v, 0) / 3;
    const v10 = volumes.slice(-10).reduce((s, v) => s + v, 0) / 10;
    return v10 > 0 ? +(v3 / v10).toFixed(2) : null;
  })();

  // MA crossover events
  const maCross = (() => {
    if (sma50v == null || sma200v == null) return null;
    // Golden / death cross (current state)
    if (sma50v > sma200v) return "golden";   // SMA50 above SMA200
    if (sma50v < sma200v) return "death";    // SMA50 below SMA200
    return null;
  })();

  // Recent SMA20/SMA50 cross — 2-bar confirmation required to filter single-bar noise
  // Pattern: prev2 on opposite side, prev1+curr both on new side = confirmed cross
  const recentMaCross = (() => {
    if (n < 57 || sma20v == null || sma50v == null) return null;
    const sma20_1 = sma(closes.slice(0, n - 1), 20);
    const sma50_1 = sma(closes.slice(0, n - 1), 50);
    const sma20_2 = sma(closes.slice(0, n - 2), 20);
    const sma50_2 = sma(closes.slice(0, n - 2), 50);
    if (!sma20_1 || !sma50_1 || !sma20_2 || !sma50_2) return null;
    if (sma20v > sma50v && sma20_1 > sma50_1 && sma20_2 <= sma50_2) return "bullish";
    if (sma20v < sma50v && sma20_1 < sma50_1 && sma20_2 >= sma50_2) return "bearish";
    return null;
  })();

  // ATR as % of price (normalized volatility)
  const atrPctRaw = atr14 != null && atr14 > 0 && price > 0 ? atr14 / price * 100 : null;
  const atrPct = atrPctRaw != null && isFinite(atrPctRaw) ? +atrPctRaw.toFixed(2) : null;

  // Support / resistance from recent 20-bar swing levels
  const swing20  = bars.slice(-20);
  const support    = +Math.min(...swing20.map(b => b.low)).toFixed(4);
  const resistance = +Math.max(...swing20.map(b => b.high)).toFixed(4);

  // Near 52w high/low (within 3%)
  const nearHigh = high52w > 0 && price / high52w >= 0.97;
  const nearLow  = low52w  > 0 && price / low52w  <= 1.03;

  // Human-readable price action narrative for GPT
  const priceActionParts = [];
  if (consUp   >= 2) priceActionParts.push(`${consUp} consecutive up closes`);
  if (consDown >= 2) priceActionParts.push(`${consDown} consecutive down closes`);
  if (volTrend != null && volTrend > 1.3) priceActionParts.push("volume expanding");
  if (volTrend != null && volTrend < 0.7) priceActionParts.push("volume contracting");
  if (nearHigh) priceActionParts.push("near 52w high");
  if (nearLow)  priceActionParts.push("near 52w low");

  return {
    sma20:        sma20v  != null      ? +sma20v.toFixed(4)        : null,
    sma50:        sma50v  != null      ? +sma50v.toFixed(4)        : null,
    sma200:       sma200v != null      ? +sma200v.toFixed(4)       : null,
    rsi14:        rsi14   != null      ? +rsi14.toFixed(1)         : null,
    macd:         macd    != null      ? +macd.toFixed(4)          : null,
    macdSignal,
    macdHist,
    macdCross,
    atr14:        atr14   != null      ? +atr14.toFixed(4)         : null,
    atrPct,
    volRatio:     volRatio != null     ? +volRatio.toFixed(2)      : null,
    adv20,
    liquidityFlag,
    bollingerPct: bollingerPct != null ? +bollingerPct.toFixed(3)  : null,
    high52w:      +high52w.toFixed(4),
    low52w:       +low52w.toFixed(4),
    maCross,
    recentMaCross,
    // Derived
    vsma20Pct:      sma20v  ? +((price - sma20v)  / sma20v  * 100).toFixed(2) : null,
    vsma50Pct:      sma50v  ? +((price - sma50v)  / sma50v  * 100).toFixed(2) : null,
    vsma200Pct:     sma200v ? +((price - sma200v) / sma200v * 100).toFixed(2) : null,
    from52wHighPct: high52w ? +((price - high52w) / high52w * 100).toFixed(2) : null,
    // Period returns
    ret1w, ret1m, ret3m,
    // Price action
    support, resistance,
    volTrend,
    priceAction: priceActionParts.length ? priceActionParts.join(", ") : null,
  };
}

/**
 * Compute ATR-based stop and target levels.
 * BUY:  stop = price − 2×ATR,  target = price + 3×ATR  (1:1.5 R/R)
 * SELL: stop = price + 2×ATR,  target = price − 3×ATR
 * Returns {} when ATR is unavailable.
 */
export function computeATRLevels(price, atr14, assetClass) {
  if (!atr14 || !price) return {};
  // Crypto has ATR ~5-15% of price vs ~0.5-2% for equities.
  // Use tighter multipliers to avoid unrealistically wide levels.
  const isCrypto = assetClass === "Crypto";
  const stopMult   = isCrypto ? 0.5 : 2.0;
  const targetMult = isCrypto ? 0.9 : 3.0;
  return {
    atrBuyStop:    +(price - stopMult   * atr14).toFixed(4),
    atrBuyTarget:  +(price + targetMult * atr14).toFixed(4),
    atrSellStop:   +(price + stopMult   * atr14).toFixed(4),
    atrSellTarget: +(price - targetMult * atr14).toFixed(4),
  };
}

/** Format indicators as a compact string for GPT prompts.
 *  assetClass: "Equity" | "ETF" | "Crypto" — adjusts RSI overbought/oversold annotations. */
export function formatIndicators(ind, atrLevels, assetClass) {
  if (!ind || Object.keys(ind).length === 0) return "";
  const pct = v => v != null ? `${v > 0 ? "+" : ""}${v}%` : "";
  const isCrypto = assetClass === "Crypto";
  const parts = [];

  // Period returns — most informative first
  const retParts = [];
  if (ind.ret1w != null) retParts.push(`1W=${pct(ind.ret1w)}`);
  if (ind.ret1m != null) retParts.push(`1M=${pct(ind.ret1m)}`);
  if (ind.ret3m != null) retParts.push(`3M=${pct(ind.ret3m)}`);
  if (retParts.length) parts.push(`Returns: ${retParts.join(" ")}`);

  // Trend
  if (ind.sma20  != null) parts.push(`SMA20=${ind.sma20}${ind.vsma20Pct  != null ? ` (price ${pct(ind.vsma20Pct)})` : ""}`);
  if (ind.sma50  != null) parts.push(`SMA50=${ind.sma50}${ind.vsma50Pct  != null ? ` (price ${pct(ind.vsma50Pct)})` : ""}`);
  if (ind.sma200 != null) parts.push(`SMA200=${ind.sma200}${ind.vsma200Pct != null ? ` (price ${pct(ind.vsma200Pct)})` : ""}`);
  if (ind.rsi14  != null) {
    // Crypto: overbought=80/oversold=20 — equity: 70/30
    const obLevel = isCrypto ? 80 : 70;
    const osLevel = isCrypto ? 20 : 30;
    const rsiFlag = ind.rsi14 >= obLevel ? " ⚠ OVERBOUGHT"
                  : ind.rsi14 <= osLevel ? " ⚠ OVERSOLD"
                  : "";
    parts.push(`RSI14=${ind.rsi14}${rsiFlag}`);
  }
  // MACD with signal, histogram, and crossover
  if (ind.macd != null) {
    let macdStr = `MACD=${ind.macd}`;
    if (ind.macdSignal != null) macdStr += ` Signal=${ind.macdSignal}`;
    if (ind.macdHist   != null) macdStr += ` Hist=${ind.macdHist > 0 ? "+" : ""}${ind.macdHist}`;
    if (ind.macdCross)          macdStr += ` [${ind.macdCross.toUpperCase()} CROSS]`;
    parts.push(macdStr);
  }
  if (ind.atr14  != null) {
    let atrStr = `ATR14=${ind.atr14}`;
    if (ind.atrPct != null) atrStr += ` (${ind.atrPct}% of price)`;
    parts.push(atrStr);
  }
  // Volume vs ADV
  if (ind.volRatio != null) {
    let volStr = `VolRatio=${ind.volRatio}x`;
    if (ind.adv20 != null) volStr += ` ADV20=${(ind.adv20 / 1e6).toFixed(2)}M`;
    parts.push(volStr);
  }
  if (ind.bollingerPct != null) parts.push(`Bollinger%B=${ind.bollingerPct}`);
  // MA regime
  if (ind.maCross) parts.push(`MA-Regime=${ind.maCross === "golden" ? "GOLDEN CROSS (SMA50>SMA200)" : "DEATH CROSS (SMA50<SMA200)"}`);
  if (ind.recentMaCross) parts.push(`SMA20/50-Cross=${ind.recentMaCross.toUpperCase()} (recent)`);

  // Levels
  if (ind.high52w) parts.push(`52wH=${ind.high52w}${ind.from52wHighPct != null ? ` (${pct(ind.from52wHighPct)})` : ""}`);
  if (ind.low52w)  parts.push(`52wL=${ind.low52w}`);
  if (ind.support    != null) parts.push(`Support=${ind.support}`);
  if (ind.resistance != null) parts.push(`Resistance=${ind.resistance}`);
  if (atrLevels?.atrBuyStop) parts.push(`ATR-BuyStop=${atrLevels.atrBuyStop} | ATR-BuyTarget=${atrLevels.atrBuyTarget}`);

  // Liquidity warning (only shown when not HIGH — liquid stocks need no warning)
  if (ind.liquidityFlag && ind.liquidityFlag !== "HIGH")
    parts.push(`⚠ Liquidity=${ind.liquidityFlag} — factor in spread/slippage`);

  // Narrative
  if (ind.priceAction) parts.push(`PriceAction: ${ind.priceAction}`);

  return parts.join(" | ");
}

/** Keyword flags for news items (used when AV sentiment not available). */
const NEWS_FLAGS = ["earnings", "beat", "miss", "upgrade", "downgrade", "FDA", "merger",
  "acquisition", "recall", "guidance", "buyback", "dividend", "insider", "short", "bankruptcy"];

export function formatNewsItems(newsItems, summaryLen = 300) {
  return (newsItems || []).map(n => {
    const summaryTxt = n.summary ? ` — ${n.summary.slice(0, summaryLen)}` : "";

    // AV sentiment-enriched news
    if (n.sentimentLabel) {
      const score  = n.sentimentScore != null ? ` ${n.sentimentScore > 0 ? "+" : ""}${n.sentimentScore.toFixed(2)}` : "";
      const topics = n.topics?.length ? ` [${n.topics.join("|")}]` : "";
      return `- [${n.date}] [${n.sentimentLabel}${score}]${topics} ${n.headline}${summaryTxt}`;
    }

    // Standard keyword-flagged news (Alpaca fallback)
    const text  = (n.headline + " " + n.summary).toLowerCase();
    const flags = NEWS_FLAGS.filter(kw => text.includes(kw.toLowerCase()));
    const flagStr = flags.length ? ` [${flags.slice(0, 3).join("|")}]` : "";
    return `- [${n.date}]${flagStr} ${n.headline}${summaryTxt}`;
  }).join("\n");
}

/** Normalise scores across a result set to use the full 0–100 range.
 *  Crypto and equity results are normalised within their own pools so that
 *  volatile crypto scores don't drag down (or inflate) equity scores. */
export function normaliseScores(results) {
  function normaliseGroup(group) {
    const scores = group.map(r => r.score).filter(s => s != null && isFinite(s));
    if (scores.length < 2) return group;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) return group;
    return group.map(r =>
      r.score != null ? { ...r, score: Math.round(((r.score - min) / (max - min)) * 100) } : r
    );
  }

  const crypto = results.filter(r => r.assetClass === "Crypto");
  const equity = results.filter(r => r.assetClass !== "Crypto");
  const normCrypto = normaliseGroup(crypto);
  const normEquity = normaliseGroup(equity);

  // Rebuild in original order
  const cryptoMap = new Map(normCrypto.map(r => [r.symbol, r]));
  const equityMap = new Map(normEquity.map(r => [r.symbol, r]));
  return results.map(r => (r.assetClass === "Crypto" ? cryptoMap.get(r.symbol) : equityMap.get(r.symbol)) ?? r);
}
