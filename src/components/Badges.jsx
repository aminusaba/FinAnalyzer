import { COLORS } from "../lib/universe.js";

export function ScoreBadge({ score }) {
  const c = score >= 75 ? COLORS.green : score >= 50 ? COLORS.gold : COLORS.red;
  return (
    <div style={{ width:40, height:40, borderRadius:"50%", border:`2px solid ${c}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:c, flexShrink:0 }}>
      {score}
    </div>
  );
}

export function SignalBadge({ signal }) {
  const map = {
    BUY:  { color: COLORS.green,  bg: "rgba(0,212,170,0.12)" },
    SELL: { color: COLORS.red,    bg: "rgba(255,77,109,0.12)" },
    HOLD: { color: COLORS.gold,   bg: "rgba(240,180,41,0.12)" },
    WATCH:{ color: COLORS.blue,   bg: "rgba(77,159,255,0.12)" },
  };
  const s = map[signal] || map.HOLD;
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:20, background:s.bg, color:s.color, whiteSpace:"nowrap" }}>
      {signal}
    </span>
  );
}

export function ConvictionBadge({ conviction }) {
  const map = {
    HIGH:   { color: COLORS.green,  bg: "rgba(0,212,170,0.12)",  label: "HIGH" },
    MEDIUM: { color: COLORS.gold,   bg: "rgba(240,180,41,0.12)", label: "MED" },
    LOW:    { color: COLORS.muted,  bg: "rgba(107,107,138,0.12)",label: "LOW" },
  };
  const s = map[conviction] || map.LOW;
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:20, background:s.bg, color:s.color, whiteSpace:"nowrap" }}>
      {s.label}
    </span>
  );
}

export function HorizonTag({ horizon }) {
  const map = {
    swing:  { label: "Swing", color: COLORS.blue },
    medium: { label: "Mid-term", color: COLORS.purple },
    long:   { label: "Long-term", color: COLORS.gold },
  };
  const s = map[horizon] || map.swing;
  return (
    <span style={{ fontSize:9, color:s.color, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>
      {s.label}
    </span>
  );
}

export function AssetClassTag({ assetClass }) {
  const colors = {
    Equity: COLORS.blue, ETF: COLORS.purple, Crypto: COLORS.gold,
    Forex: COLORS.accent, Commodity: COLORS.red, Europe: COLORS.blue, Asia: COLORS.blue,
  };
  return (
    <span style={{ fontSize:9, color: colors[assetClass] || COLORS.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>
      {assetClass}
    </span>
  );
}
