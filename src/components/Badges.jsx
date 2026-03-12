import { COLORS } from "../lib/universe.js";

export function ScoreBadge({ score }) {
  const isHigh = score >= 75;
  const isMid = score >= 50;
  const gradient = isHigh ? "linear-gradient(135deg,#00d4aa,#00b4d8)"
    : isMid ? "linear-gradient(135deg,#f0b429,#f97316)"
    : "linear-gradient(135deg,#ff4d6d,#e11d48)";
  const glow = isHigh ? "rgba(0,212,170,0.5)" : isMid ? "rgba(240,180,41,0.5)" : "rgba(255,77,109,0.5)";
  const color = isHigh ? COLORS.green : isMid ? COLORS.gold : COLORS.red;
  return (
    <div style={{
      width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
      background: `conic-gradient(${color} ${score * 3.6}deg, ${COLORS.border} ${score * 3.6}deg)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: `0 0 12px ${glow}`,
      padding: 3,
    }}>
      <div style={{
        width: "100%", height: "100%", borderRadius: "50%",
        background: COLORS.card,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 11, color,
      }}>{score}</div>
    </div>
  );
}

export function SignalBadge({ signal }) {
  const map = {
    BUY:   { grad: "linear-gradient(135deg,#00d4aa,#00b4d8)", shadow: "rgba(0,212,170,0.3)" },
    SELL:  { grad: "linear-gradient(135deg,#ff4d6d,#e11d48)", shadow: "rgba(255,77,109,0.3)" },
    HOLD:  { grad: "linear-gradient(135deg,#f0b429,#f97316)", shadow: "rgba(240,180,41,0.3)" },
    WATCH: { grad: "linear-gradient(135deg,#4d9fff,#3b82f6)",  shadow: "rgba(77,159,255,0.3)" },
  };
  const s = map[signal] || map.HOLD;
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, padding: "3px 10px", borderRadius: 20,
      background: s.grad, color: "#000", whiteSpace: "nowrap", letterSpacing: 0.5,
      boxShadow: `0 2px 8px ${s.shadow}`,
    }}>{signal}</span>
  );
}

export function ConvictionBadge({ conviction }) {
  const map = {
    HIGH:   { color: COLORS.green,  bg: "rgba(0,212,170,0.1)",   border: "rgba(0,212,170,0.3)",   label: "HIGH" },
    MEDIUM: { color: COLORS.gold,   bg: "rgba(240,180,41,0.1)",  border: "rgba(240,180,41,0.3)",  label: "MED" },
    LOW:    { color: COLORS.muted,  bg: "rgba(107,107,138,0.08)", border: "rgba(107,107,138,0.2)", label: "LOW" },
  };
  const s = map[conviction] || map.LOW;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap",
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.label}</span>
  );
}

export function HorizonTag({ horizon }) {
  const map = {
    swing:  { label: "Swing",    color: COLORS.blue },
    medium: { label: "Mid-term", color: COLORS.purple },
    long:   { label: "Long",     color: COLORS.gold },
  };
  const s = map[horizon] || map.swing;
  return (
    <span style={{ fontSize: 9, color: s.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
      {s.label}
    </span>
  );
}

export function AssetClassTag({ assetClass }) {
  const colors = {
    Equity: COLORS.blue, ETF: COLORS.purple, Crypto: COLORS.gold,
    Forex: COLORS.accent, Commodity: "#fb923c", Europe: COLORS.blue, Asia: "#ec4899",
  };
  return (
    <span style={{ fontSize: 9, color: colors[assetClass] || COLORS.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
      {assetClass}
    </span>
  );
}
