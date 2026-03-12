/**
 * Full-screen chart page rendered when the URL contains ?chart=SYMBOL.
 * Opened as a popup window via openChartWindow().
 * Reads Alpaca settings from localStorage (same origin as main app).
 */
import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { getChartBars } from "../lib/alpaca.js";
import { COLORS } from "../lib/universe.js";
import { getRawTheme, applyTheme, getTheme } from "../lib/theme.js";

const TIMEFRAMES = ["1D", "1H", "15m", "5m"];

function getSettingsFromStorage() {
  // Try all localStorage keys that look like user settings (written by App.jsx)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    try {
      const val = JSON.parse(localStorage.getItem(key));
      if (val?.alpacaKey && val?.alpacaSecret) return val;
    } catch {}
  }
  return {};
}

export function ChartPage() {
  const params     = new URLSearchParams(window.location.search);
  const symbol     = params.get("chart") || "";
  const assetClass = params.get("assetClass") || "Equity";
  const entry      = params.get("entry")  ? parseFloat(params.get("entry"))  : null;
  const stop       = params.get("stop")   ? parseFloat(params.get("stop"))   : null;
  const target     = params.get("target") ? parseFloat(params.get("target")) : null;

  const settings = getSettingsFromStorage();

  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [barCount, setBarCount] = useState(0);
  const [timeframe, setTimeframe] = useState("1D");

  // Build chart
  useEffect(() => {
    if (!containerRef.current) return;
    applyTheme(getTheme()); // ensure popup window has correct theme applied
    const T = getRawTheme();
    const chartHeight = window.innerHeight - 52;
    const chart = createChart(containerRef.current, {
      layout:    { background: { color: T.chartBg }, textColor: T.chartText },
      grid:      { vertLines: { color: T.chartGrid }, horzLines: { color: T.chartGrid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: T.chartBorder },
      timeScale:       { borderColor: T.chartBorder, timeVisible: true },
      width:  window.innerWidth,
      height: chartHeight,
    });

    const candles = chart.addCandlestickSeries({
      upColor:         T.green,
      downColor:       T.red,
      borderUpColor:   T.green,
      borderDownColor: T.red,
      wickUpColor:     T.green,
      wickDownColor:   T.red,
    });

    chartRef.current  = chart;
    seriesRef.current = candles;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width:  window.innerWidth,
        height: window.innerHeight - 52,
      });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  // Fetch bars
  useEffect(() => {
    if (!seriesRef.current || !symbol) return;
    if (!settings?.alpacaKey) { setLoading(false); setError("No Alpaca API keys found in settings."); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Clear any stale price lines from a previous run
    if (seriesRef.current._priceLines) {
      seriesRef.current._priceLines.forEach(pl => { try { seriesRef.current.removePriceLine(pl); } catch {} });
      seriesRef.current._priceLines = [];
    }
    seriesRef.current.setData([]);

    getChartBars(symbol, assetClass, settings, 365, timeframe)
      .then(bars => {
        if (cancelled || !seriesRef.current) return;
        if (!bars.length) { setError("No bar data available"); setLoading(false); return; }
        seriesRef.current.setData(bars);
        setBarCount(bars.length);
        chartRef.current?.timeScale().fitContent();

        const T2 = getRawTheme();
        const lines = [];
        if (entry)  lines.push(seriesRef.current.createPriceLine({ price: entry,  color: "#00b4d8",  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" }));
        if (stop)   lines.push(seriesRef.current.createPriceLine({ price: stop,   color: T2.red,    lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Stop" }));
        if (target) lines.push(seriesRef.current.createPriceLine({ price: target, color: T2.green,  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Target" }));
        seriesRef.current._priceLines = lines;

        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  const signalColor = entry && target && stop
    ? (target > entry ? COLORS.green : COLORS.red)
    : COLORS.muted;

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: COLORS.bg,
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter', sans-serif",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0 }
        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-thumb { background: #1c1c2e; border-radius: 4px }
      `}</style>

      {/* Header bar */}
      <div style={{
        height: 52,
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        flexShrink: 0,
      }}>
        {/* Left: symbol + asset class */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: -0.5,
            background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>{symbol}</div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#3a3a5a",
            background: "#12121f", border: "1px solid #1c1c2e",
            borderRadius: 6, padding: "3px 8px", textTransform: "uppercase", letterSpacing: 1,
          }}>{assetClass}</span>
          {!loading && !error && (
            <span style={{ fontSize: 10, color: "#3a3a5a" }}>{barCount} bars</span>
          )}
        </div>

        {/* Center: trade levels */}
        {(entry || stop || target) && (
          <div style={{ display: "flex", gap: 20, fontSize: 12, fontWeight: 700 }}>
            {entry  && <span style={{ color: "#00b4d8"   }}>Entry  ${Number(entry).toFixed(2)}</span>}
            {target && <span style={{ color: COLORS.green }}>Target ${Number(target).toFixed(2)}</span>}
            {stop   && <span style={{ color: COLORS.red   }}>Stop   ${Number(stop).toFixed(2)}</span>}
            {entry && target && stop && (
              <span style={{ color: COLORS.gold }}>
                R/R {Math.abs((target - entry) / (entry - stop)).toFixed(2)}x
              </span>
            )}
          </div>
        )}

        {/* Right: timeframe switcher + close button */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)} style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: 0.5,
                border: `1px solid ${timeframe === tf ? COLORS.accent : "#1c1c2e"}`,
                background: timeframe === tf ? "rgba(0,212,170,0.15)" : "transparent",
                color: timeframe === tf ? COLORS.accent : "#3a3a5a",
              }}>{tf}</button>
            ))}
          </div>
        <button
          onClick={() => window.close()}
          style={{
            padding: "5px 14px", borderRadius: 8,
            border: "1px solid #1c1c2e", background: "transparent",
            color: "#3a3a5a", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.red; e.currentTarget.style.color = COLORS.red; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1c1c2e"; e.currentTarget.style.color = "#3a3a5a"; }}
        >✕ Close</button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%", opacity: loading || error ? 0.15 : 1, transition: "opacity 0.3s" }} />

        {loading && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid #1c1c2e`, borderTop: `2px solid ${COLORS.accent}`, animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 12, color: COLORS.muted }}>Loading {symbol} chart...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: COLORS.red, fontSize: 13, maxWidth: 400, padding: 24 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
