import { useState, useEffect, useRef } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { COLORS } from "../lib/universe.js";
import { getSnapshots } from "../lib/alpaca.js";

const FALLBACK_SYMBOLS = ["AAPL","MSFT","NVDA","AMZN","TSLA","SPY","QQQ","META","GOOGL","JPM"];
const POLL_MS = 30_000;

// Alpaca snapshot only covers Equity + ETF — Forex/Commodity stay at scan price
const REFRESHABLE = new Set(["Equity", "ETF"]);

function TickerItem({ symbol, price, change_pct, assetClass }) {
  const up    = change_pct >= 0;
  const color = up ? COLORS.green : COLORS.red;
  const fmt   = assetClass === "Forex" ? price?.toFixed(4) : price?.toFixed(2);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 28px", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.text, letterSpacing: 0.3 }}>{symbol}</span>
      <span style={{ fontSize: 13, color: COLORS.muted }}>{assetClass === "Forex" ? "" : "$"}{fmt}</span>
      <span style={{
        fontSize: 12, fontWeight: 700, color,
        background: `${color}18`, borderRadius: 4, padding: "2px 6px",
        display: "inline-flex", alignItems: "center", gap: 3,
      }}>
        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {Math.abs(change_pct).toFixed(2)}%
      </span>
      <span style={{ color: COLORS.border, marginLeft: 6 }}>·</span>
    </span>
  );
}

export function TickerTape({ results, settings }) {
  const hasResults = Array.isArray(results) && results.length > 0;

  // liveItems: shown when no scan results
  const [liveItems, setLiveItems] = useState([]);
  // freshPrices: price overrides applied on top of scan results after each refresh
  const [freshPrices, setFreshPrices] = useState({}); // symbol → { price, change_pct }
  const fallbackTimerRef = useRef(null);
  const scanTimerRef     = useRef(null);

  const hasKeys = settings?.alpacaKey && settings?.alpacaSecret;

  // Fetch updated prices for a list of Equity/ETF symbols via Alpaca snapshots
  const refreshPrices = async (symbols) => {
    if (!hasKeys || !symbols.length) return;
    try {
      const snaps = await getSnapshots(symbols, settings);
      const updates = {};
      for (const sym of symbols) {
        const s = snaps[sym];
        if (!s) continue;
        const price = s.dailyBar?.c || s.latestTrade?.p || 0;
        const prev  = s.prevDailyBar?.c;
        const change_pct = prev && price ? ((price - prev) / prev) * 100 : 0;
        if (price > 0) updates[sym] = { price, change_pct };
      }
      if (Object.keys(updates).length) setFreshPrices(prev => ({ ...prev, ...updates }));
    } catch {}
  };

  // ── No scan results: fetch & poll fallback symbols ──────────────────────────
  useEffect(() => {
    clearInterval(fallbackTimerRef.current);
    if (hasResults) return;
    const run = async () => {
      if (!hasKeys) return;
      await refreshPrices(FALLBACK_SYMBOLS);
    };
    run();
    fallbackTimerRef.current = setInterval(run, POLL_MS);
    return () => clearInterval(fallbackTimerRef.current);
  }, [hasResults, settings?.alpacaKey, settings?.alpacaSecret, settings?.alpacaMode]);

  // Build liveItems from freshPrices when there are no scan results
  useEffect(() => {
    if (hasResults) return;
    const items = FALLBACK_SYMBOLS.flatMap(sym => {
      const fp = freshPrices[sym];
      return fp ? [{ symbol: sym, assetClass: "Equity", ...fp }] : [];
    });
    if (items.length) setLiveItems(items);
  }, [freshPrices, hasResults]);

  // ── After scan: refresh Equity/ETF ticker prices every 30s ─────────────────
  useEffect(() => {
    clearInterval(scanTimerRef.current);
    if (!hasResults) return;
    const refreshableSymbols = results
      .filter(r => REFRESHABLE.has(r.assetClass))
      .map(r => r.symbol);

    refreshPrices(refreshableSymbols);
    scanTimerRef.current = setInterval(() => refreshPrices(refreshableSymbols), POLL_MS);
    return () => clearInterval(scanTimerRef.current);
  }, [results, settings?.alpacaKey, settings?.alpacaSecret, settings?.alpacaMode]);

  // Merge fresh prices into scan results for display
  const items = hasResults
    ? results.map(r => {
        const fp = freshPrices[r.symbol];
        return fp ? { ...r, ...fp } : r;
      })
    : liveItems;

  if (!items.length) return null;

  const tape     = [...items, ...items];
  const duration = Math.max(20, items.length * 3);

  return (
    <div style={{
      background: COLORS.bg,
      borderBottom: `1px solid ${COLORS.border}`,
      height: 42, overflow: "hidden",
      display: "flex", alignItems: "center",
      position: "relative",
    }}>
      {/* Left fade */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 40, zIndex: 2,
        background: `linear-gradient(90deg, ${COLORS.bg}, transparent)`, pointerEvents: "none" }} />
      {/* Right fade */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, zIndex: 2,
        background: `linear-gradient(270deg, ${COLORS.bg}, transparent)`, pointerEvents: "none" }} />

      <div style={{
        display: "inline-flex",
        animation: `ticker-scroll ${duration}s linear infinite`,
        willChange: "transform",
      }}>
        {tape.map((item, i) => (
          <TickerItem key={`${item.symbol}-${i}`} {...item} />
        ))}
      </div>

      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0) }
          to   { transform: translateX(-50%) }
        }
      `}</style>
    </div>
  );
}
