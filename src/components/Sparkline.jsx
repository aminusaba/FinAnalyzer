import { COLORS } from "../lib/universe.js";

export function Sparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w = 100, h = 36, pad = 3;
  const vals = data.map(Number).filter(n => !isNaN(n));
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const pts = vals.map((v, i) =>
    `${pad + (i / (vals.length - 1)) * (w - pad * 2)},${h - pad - ((v - min) / range) * (h - pad * 2 - 8)}`
  );
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? COLORS.green : COLORS.red;
  const polyline = pts.join(" ");
  const fillPath = `M${pts[0]} ` + pts.slice(1).map(p => `L${p}`).join(" ") + ` L${pts[pts.length - 1].split(",")[0]},${h - pad} L${pts[0].split(",")[0]},${h - pad} Z`;
  const gradId = `sg-${Math.random().toString(36).slice(2)}`;

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
