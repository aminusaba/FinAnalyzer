import { COLORS } from "../lib/universe.js";

export function Sparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w = 100, h = 32, pad = 3;
  const vals = data.map(Number).filter(n => !isNaN(n));
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const pts = vals.map((v, i) =>
    `${pad + (i / (vals.length - 1)) * (w - pad * 2)},${h - pad - ((v - min) / range) * (h - pad * 2)}`
  ).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={up ? COLORS.green : COLORS.red} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
