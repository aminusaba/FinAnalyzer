import { useState, useEffect, useRef } from "react";
import { COLORS } from "../lib/universe.js";
import { getMarketClock, isUSMarketHoursNow, isPreMarketNow } from "../lib/trading.js";

function StatusPill({ label, open, preOpen, note, always }) {
  const color  = always ? COLORS.blue : preOpen ? COLORS.gold : open === true ? COLORS.green : open === false ? COLORS.red : COLORS.muted;
  const dot    = "●";
  const status = always ? "24/7" : preOpen ? "PRE-OPEN" : open === true ? "OPEN" : open === false ? "CLOSED" : "—";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "rgba(255,255,255,0.03)", border: `1px solid ${COLORS.border}`,
      borderRadius: 20, padding: "4px 12px",
    }}>
      <span style={{ color, fontSize: 8, lineHeight: 1 }}>{dot}</span>
      <span style={{ fontSize: 10, color: COLORS.muted, fontWeight: 600 }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color,
        background: `${color}18`, borderRadius: 8, padding: "1px 6px",
      }}>{status}</span>
      {note && <span style={{ fontSize: 9, color: COLORS.muted }}>{note}</span>}
    </div>
  );
}

function formatNext(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = d - now;
  if (diffMs < 0) return null;
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffH > 0) return `in ${diffH}h ${diffM}m`;
  return `in ${diffM}m`;
}

export function MarketStatusBar({ settings }) {
  const [clock, setClock]     = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchClock = async () => {
    if (settings.alpacaKey && settings.alpacaSecret) {
      try {
        const c = await getMarketClock(settings);
        setClock(c);
        setLoading(false);
        return;
      } catch {}
    }
    // No keys or clock fetch failed — use local time-based fallback
    setClock({ is_open: isUSMarketHoursNow(), is_pre_open: isPreMarketNow(), _local: true });
    setLoading(false);
  };

  useEffect(() => {
    fetchClock();
    timerRef.current = setInterval(fetchClock, 60_000);
    return () => clearInterval(timerRef.current);
  }, [settings.alpacaKey, settings.alpacaSecret, settings.alpacaMode]);

  const usOpen    = clock?.is_open ?? null;
  const preOpen   = !usOpen && (clock?.is_pre_open ?? isPreMarketNow());
  const nextNote  = usOpen
    ? formatNext(clock?.next_close) && `closes ${formatNext(clock?.next_close)}`
    : formatNext(clock?.next_open)  && `opens ${formatNext(clock?.next_open)}`;

  if (loading) return null;

  return (
    <div style={{
      background: COLORS.surface,
      borderBottom: `1px solid ${COLORS.border}`,
      padding: "6px 28px",
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 9, color: COLORS.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginRight: 4 }}>
        Markets
      </span>

      {/* US Equities */}
      <StatusPill
        label="US Equities & ETFs"
        open={usOpen}
        preOpen={preOpen}
        note={preOpen ? "analysis only" : nextNote}
      />

      {/* Europe ADRs — US-listed, follow US hours */}
      <StatusPill
        label="Europe ADRs"
        open={usOpen}
        preOpen={preOpen}
        note={null}
      />

      {/* Asia ADRs — US-listed, follow US hours */}
      <StatusPill
        label="Asia ADRs"
        open={usOpen}
        preOpen={preOpen}
        note={null}
      />

      {/* Crypto — always open */}
      <StatusPill
        label="Crypto"
        open={true}
        always
      />

      {clock && (
        <span style={{ fontSize: 9, color: COLORS.muted, marginLeft: "auto" }}>
          {clock._local
            ? "Local time estimate"
            : `Updated ${new Date(clock.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </span>
      )}
    </div>
  );
}
