import { COLORS } from "../lib/universe.js";
import { SignalBadge, ConvictionBadge } from "./Badges.jsx";

const HISTORY_URL = "https://raw.githubusercontent.com/aminusaba/FinAnalyzer/master/data/scan-history.json";

export function useHistory() {
  return { fetchHistory: async () => {
    const r = await fetch(`${HISTORY_URL}?t=${Date.now()}`);
    return r.json();
  }};
}

function ScanEntry({ entry, expanded, onToggle }) {
  const date = new Date(entry.timestamp);
  const buys = entry.results?.filter(r => r.signal === "BUY") || [];
  const hasAlerts = entry.alerts?.length > 0;

  return (
    <div style={{ background: COLORS.card, border: `1px solid ${hasAlerts ? "rgba(0,212,170,0.3)" : COLORS.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      {/* Header row */}
      <div onClick={onToggle} style={{ padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
            {entry.results?.length || 0} symbols scanned
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

      {/* Expanded results */}
      {expanded && entry.results?.length > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 70px 80px 70px 60px 1fr", padding: "7px 16px", fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, background: "rgba(0,0,0,0.2)" }}>
            <div>Symbol</div><div>Class</div><div>Signal</div><div>Conv.</div><div>Score</div><div>Thesis</div>
          </div>
          {entry.results.map(r => (
            <div key={r.symbol} style={{ display: "grid", gridTemplateColumns: "80px 70px 80px 70px 60px 1fr", padding: "9px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: COLORS.accent }}>{r.symbol}</div>
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

export function HistoryPanel({ history, loading, error }) {
  const [expanded, setExpanded] = React.useState(null);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>⟳</div>
      <div>Loading scan history...</div>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: "center", padding: 60, color: COLORS.red }}>
      <div style={{ fontSize: 13 }}>Failed to load history: {error}</div>
    </div>
  );

  if (!history?.length) return (
    <div style={{ textAlign: "center", padding: 60, color: COLORS.muted }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
      <div>No scan history yet.</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>History is saved after each background scan.</div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 14 }}>
        {history.length} scan{history.length > 1 ? "s" : ""} recorded · last updated {new Date(history[0]?.timestamp).toLocaleString()}
      </div>
      {history.map((entry, i) => (
        <ScanEntry key={entry.timestamp} entry={entry} expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
      ))}
    </div>
  );
}

// Need React for useState in this file
import React from "react";
