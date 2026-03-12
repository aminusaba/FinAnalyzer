import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { getChartBars } from "../lib/alpaca.js";
import { COLORS } from "../lib/universe.js";
import { openChartWindow } from "../lib/chart-window.js";
import { getRawTheme } from "../lib/theme.js";

const TIMEFRAMES = ["1D", "1H", "15m", "5m"];

export function TradingChart({ symbol, assetClass, settings, entry, stop, target }) {
  const containerRef = useRef(null);
  const chartRef      = useRef(null);
  const seriesRef     = useRef(null);
  const priceLinesRef = useRef([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [barsReady, setBarsReady] = useState(false);
  const [timeframe, setTimeframe] = useState("1D");

  const hasKeys = settings?.alpacaKey && settings?.alpacaSecret;

  // Build / destroy chart on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const T = getRawTheme(); // actual hex values for the chart library

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: T.chartText,
      },
      grid: {
        vertLines: { color: T.chartGrid },
        horzLines: { color: T.chartGrid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: T.chartBorder },
      timeScale: { borderColor: T.chartBorder, timeVisible: true },
      width:  containerRef.current.clientWidth,
      height: 200,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor:          T.green,
      downColor:        T.red,
      borderUpColor:    T.green,
      borderDownColor:  T.red,
      wickUpColor:      T.green,
      wickDownColor:    T.red,
    });

    chartRef.current  = chart;
    seriesRef.current = candleSeries;

    // Responsive resize
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // Fetch bars whenever symbol/settings change (no price line deps)
  useEffect(() => {
    if (!seriesRef.current || !symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBarsReady(false);

    // Clear existing price lines and bar data
    priceLinesRef.current.forEach(pl => { try { seriesRef.current.removePriceLine(pl); } catch {} });
    priceLinesRef.current = [];
    seriesRef.current.setData([]);

    if (!hasKeys) {
      setLoading(false);
      setError("Add Alpaca API keys in Settings to load chart data");
      return;
    }

    getChartBars(symbol, assetClass, settings, 60, timeframe)
      .then(bars => {
        if (cancelled || !seriesRef.current) return;
        if (!bars.length) { setError("No bar data available"); setLoading(false); return; }
        seriesRef.current.setData(bars);
        chartRef.current?.timeScale().fitContent();
        setLoading(false);
        setBarsReady(true);
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [symbol, assetClass, settings?.alpacaKey, settings?.alpacaSecret, settings?.alpacaMode, timeframe]);

  // Draw price lines only after bars are loaded — separate from fetch to avoid race condition
  useEffect(() => {
    if (!barsReady || !seriesRef.current) return;

    // Remove old lines first
    priceLinesRef.current.forEach(pl => { try { seriesRef.current.removePriceLine(pl); } catch {} });
    priceLinesRef.current = [];

    const T2 = getRawTheme();
    const lines = [];
    if (entry)  lines.push(seriesRef.current.createPriceLine({ price: entry,  color: "#00b4d8", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Entry" }));
    if (stop)   lines.push(seriesRef.current.createPriceLine({ price: stop,   color: T2.red,    lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Stop" }));
    if (target) lines.push(seriesRef.current.createPriceLine({ price: target, color: T2.green,  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Target" }));
    priceLinesRef.current = lines;
  }, [barsReady, entry, stop, target]);

  return (
    <div style={{ marginTop: 8 }}>
      {/* Toolbar — above the chart, always visible */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              padding: "3px 9px", borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: 0.5,
              border: `1px solid ${timeframe === tf ? COLORS.accent : COLORS.border}`,
              background: timeframe === tf ? "rgba(0,212,170,0.15)" : "transparent",
              color: timeframe === tf ? COLORS.accent : COLORS.muted,
            }}>{tf}</button>
          ))}
        </div>
        <button
          onClick={() => openChartWindow(symbol, { assetClass, entry, stop, target })}
          title="Open in full window"
          style={{
            padding: "3px 9px", borderRadius: 5,
            border: `1px solid ${COLORS.border}`, background: "transparent",
            color: COLORS.muted, fontSize: 10, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.accent; e.currentTarget.style.color = COLORS.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.muted; }}
        >⤢ Pop out</button>
      </div>

      {/* Chart container */}
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
        {/* Chart canvas — always rendered so the chart object persists */}
        <div ref={containerRef} style={{ width: "100%", opacity: loading || error ? 0.2 : 1, transition: "opacity 0.3s" }} />

        {/* Overlay states */}
        {loading && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.accent}`, animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 11, color: COLORS.muted }}>Loading chart...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "#3a3a5a", textAlign: "center", padding: "0 12px" }}>{error}</span>
          </div>
        )}

        {/* Legend */}
        {!loading && !error && (entry || stop || target) && (
          <div style={{ position: "absolute", top: 6, left: 8, display: "flex", gap: 10, fontSize: 9, fontWeight: 700 }}>
            {entry  && <span style={{ color: "#00b4d8"   }}>─ Entry ${Number(entry).toFixed(2)}</span>}
            {target && <span style={{ color: COLORS.green }}>─ Target ${Number(target).toFixed(2)}</span>}
            {stop   && <span style={{ color: COLORS.red   }}>─ Stop ${Number(stop).toFixed(2)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
