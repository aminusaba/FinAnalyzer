import React, { useState, useEffect } from "react";
import { COLORS } from "../lib/universe.js";
import { SignalBadge, ConvictionBadge } from "./Badges.jsx";
import { loadScanRuns, loadTrades, loadSignalPerformance } from "../lib/db.js";
import { getAccount } from "../lib/trading.js";
import { openChartWindow } from "../lib/chart-window.js";

export function useHistory(userKey) {
  return {
    fetchHistory: () => loadScanRuns(userKey),
    fetchTrades:  () => loadTrades(userKey),
  };
}

const fmt = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${abs.toFixed(2)}`;
};

function DailyPLSummary({ trades, settings }) {
  const [dayPL, setDayPL]     = useState(null);
  const [plLoading, setPLLoading] = useState(false);

  useEffect(() => {
    if (!settings?.alpacaKey || !settings?.alpacaSecret) return;
    setPLLoading(true);
    getAccount(settings)
      .then(acc => {
        const equity     = parseFloat(acc.equity || 0);
        const lastEquity = parseFloat(acc.last_equity || 0);
        if (lastEquity > 0) setDayPL(equity - lastEquity);
      })
      .catch(() => {})
      .finally(() => setPLLoading(false));
  }, [settings?.alpacaKey, settings?.alpacaSecret]);

  const todayStr    = new Date().toDateString();
  const todayTrades = trades.filter(t => new Date(t.placedAt).toDateString() === todayStr);
  const totalBought = todayTrades.filter(t => t.side === "buy") .reduce((s, t) => s + (Number(t.notional) || 0), 0);
  const totalSold   = todayTrades.filter(t => t.side === "sell").reduce((s, t) => s + (Number(t.notional) || 0), 0);

  const plColor = dayPL == null ? COLORS.muted : dayPL >= 0 ? COLORS.green : COLORS.red;

  return (
    <div style={{
      background: COLORS.cardGrad,
      border: `1px solid ${COLORS.border}`, borderRadius: 12,
      padding: "14px 18px", marginBottom: 16,
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12,
    }}>
      <div>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Today's Trades</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>{todayTrades.length}</div>
        <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>{trades.length} total</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Bought Today</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.blue }}>{totalBought > 0 ? fmt(totalBought) : "—"}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Sold Today</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.accent }}>{totalSold > 0 ? fmt(totalSold) : "—"}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Day P&L</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: plColor }}>
          {plLoading ? "…" : dayPL == null ? "—" : `${dayPL >= 0 ? "+" : "-"}${fmt(dayPL)}`}
        </div>
        <div style={{ fontSize: 9, color: COLORS.muted, marginTop: 2 }}>vs yesterday's close</div>
      </div>
    </div>
  );
}


function ScanEntry({ entry, expanded, onToggle }) {
  const date    = new Date(entry.timestamp);
  const buys    = entry.results?.filter(r => r.signal === "BUY") || [];
  const hasAlerts = entry.alerts?.length > 0;

  return (
    <div style={{ background: COLORS.card, border: `1px solid ${hasAlerts ? "rgba(0,212,170,0.3)" : COLORS.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div onClick={onToggle} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
            {entry.results?.length || 0} symbols scanned
            {entry.durationMs != null && (
              <span style={{ marginLeft: 6 }}>
                · {entry.durationMs >= 60000 ? `${(entry.durationMs/60000).toFixed(1)}m` : `${(entry.durationMs/1000).toFixed(0)}s`}
              </span>
            )}
            {hasAlerts && <span style={{ color: COLORS.accent, marginLeft: 8 }}>• {entry.alerts.length} alert{entry.alerts.length > 1 ? "s" : ""} sent</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {buys.slice(0, 3).map(r => (
            <span key={r.symbol} style={{ fontSize: 10, fontWeight: 700, color: COLORS.green, background: "rgba(0,212,170,0.1)", padding: "2px 8px", borderRadius: 10 }}>{r.symbol}</span>
          ))}
          <span style={{ color: COLORS.muted, fontSize: 14 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && entry.results?.length > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 70px 80px 70px 60px 1fr", padding: "7px 16px", fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, background: "rgba(0,0,0,0.2)" }}>
            <div>Symbol</div><div>Class</div><div>Signal</div><div>Conv.</div><div>Score</div><div>Thesis</div>
          </div>
          {entry.results.map(r => (
            <div key={r.symbol} style={{ display: "grid", gridTemplateColumns: "80px 70px 80px 70px 60px 1fr", padding: "9px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12 }}>
              <div
                onClick={() => openChartWindow(r.symbol, { assetClass: r.assetClass, entry: r.entry, stop: r.stop, target: r.target })}
                title="Open chart"
                style={{ fontWeight: 700, color: COLORS.accent, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >{r.symbol} <span style={{ fontSize: 9, opacity: 0.5 }}>⤢</span></div>
              <div style={{ color: COLORS.muted, fontSize: 10 }}>{r.assetClass}</div>
              <div><SignalBadge signal={r.signal} /></div>
              <div><ConvictionBadge conviction={r.conviction} /></div>
              <div style={{ fontWeight: 700, color: r.score >= 75 ? COLORS.green : r.score >= 50 ? COLORS.gold : COLORS.red }}>{r.score}</div>
              <div style={{ color: COLORS.muted, fontSize: 11 }}>{r.investor_thesis?.slice(0, 80)}...</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }) {
  const isBuy  = trade.side === "buy";
  const color  = isBuy ? COLORS.green : COLORS.red;
  const date   = new Date(trade.placedAt);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "60px 80px 80px 90px 90px 1fr", padding: "10px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12, alignItems: "center" }}>
      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 10, background: `${color}18`, color, width: "fit-content" }}>{trade.side.toUpperCase()}</span>
      <span
        onClick={() => openChartWindow(trade.symbol, { assetClass: trade.assetClass, stop: trade.stop, target: trade.target })}
        title="Open chart"
        style={{ fontWeight: 700, color: COLORS.text, cursor: "pointer" }}
        onMouseEnter={e => e.currentTarget.style.color = COLORS.accent}
        onMouseLeave={e => e.currentTarget.style.color = COLORS.text}
      >{trade.symbol}</span>
      <span style={{ color: COLORS.muted }}>{trade.assetClass || "—"}</span>
      <span style={{ color: COLORS.text, fontWeight: 600 }}>{trade.notional ? `$${Number(trade.notional).toFixed(2)}` : "—"}</span>
      <span style={{ color: COLORS.muted, fontSize: 10 }}>{date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <span style={{ color: COLORS.muted, fontSize: 10 }}>
        {trade.bracket && trade.stop && trade.target
          ? `SL $${Number(trade.stop).toFixed(2)} / TP $${Number(trade.target).toFixed(2)}`
          : trade.stop ? `SL $${Number(trade.stop).toFixed(2)}` : "—"}
      </span>
    </div>
  );
}

export function HistoryPanel({ history, trades = [], loading, error, settings }) {
  const [expanded, setExpanded]   = useState(null);
  const [view, setView]           = useState("scans"); // "scans" | "trades" | "performance"
  const [perfData, setPerfData]   = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);

  const loadPerf = async () => {
    if (perfData || perfLoading) return;
    setPerfLoading(true);
    const d = await loadSignalPerformance().catch(() => null);
    setPerfData(d);
    setPerfLoading(false);
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>⟳</div>
      <div>Loading history...</div>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: "center", padding: 60, color: COLORS.red }}>
      <div style={{ fontSize: 13 }}>Failed to load history: {error}</div>
    </div>
  );

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
        {[
          ["scans",       `📡 Scan Runs (${history.length})`],
          ["trades",      `🛒 Trades (${trades.length})`],
          ["performance", `📊 Performance`],
        ].map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); if (v === "performance") loadPerf(); }} style={{
            padding: "7px 16px", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            color: view === v ? COLORS.accent : COLORS.muted,
            borderBottom: `2px solid ${view === v ? COLORS.accent : "transparent"}`,
          }}>{label}</button>
        ))}
      </div>

      {/* Scan runs */}
      {view === "scans" && (
        history.length === 0
          ? <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
              <div>No scan history yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>History is saved automatically after each scan.</div>
            </div>
          : <>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 14 }}>
                {history.length} scan{history.length > 1 ? "s" : ""} · last {new Date(history[0]?.timestamp).toLocaleString()}
              </div>
              {history.map((entry, i) => (
                <ScanEntry key={`${entry.timestamp}-${i}`} entry={entry} expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
              ))}
            </>
      )}

      {/* Trades */}
      {view === "trades" && (
        <>
        <DailyPLSummary trades={trades} settings={settings} />
        {trades.length === 0
          ? <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🛒</div>
              <div>No trades recorded yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Auto-trades and manual orders appear here.</div>
            </div>
          : <div style={{ background: COLORS.cardGrad, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "60px 80px 80px 90px 90px 1fr", padding: "8px 16px", fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, background: "rgba(0,0,0,0.2)" }}>
                <div>Side</div><div>Symbol</div><div>Class</div><div>Amount</div><div>Time</div><div>Bracket</div>
              </div>
              {trades.map((t, i) => <TradeRow key={`${t.symbol}-${t.placedAt ?? i}`} trade={t} />)}
            </div>
        }
        </>
      )}

      {/* Performance */}
      {view === "performance" && (
        <div>
          {perfLoading && <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>Loading...</div>}
          {!perfLoading && !perfData && <div style={{ textAlign: "center", padding: 40, color: COLORS.muted }}>No tagged trades yet. Trades placed after this update will include signal metadata.</div>}
          {perfData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Total Trades", perfData.totalTrades],
                  ["Total Buys",   perfData.totalBuys],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: COLORS.cardGrad, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 16px" }}>
                    <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.text }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* By Score Range */}
              <div style={{ background: COLORS.cardGrad, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Buys by Score Range</div>
                {Object.entries(perfData.byScore).map(([range, count]) => (
                  <div key={range} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>{range}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: count > 0 ? COLORS.accent : COLORS.muted }}>{count} buy{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>

              {/* By Model */}
              {Object.keys(perfData.byModel).length > 0 && (
                <div style={{ background: COLORS.cardGrad, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Buys by AI Model</div>
                  {Object.entries(perfData.byModel).map(([model, stats]) => (
                    <div key={model} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                      <span style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>{model}</span>
                      <span style={{ fontSize: 11, color: COLORS.muted }}>{stats.count} buys · ${stats.totalNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })} deployed</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
