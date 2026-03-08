import { COLORS } from "../lib/universe.js";
import { Sparkline } from "./Sparkline.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag } from "./Badges.jsx";

function InfoCard({ title, content, color, icon }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #111120, #0d0d1a)",
      border: `1px solid ${COLORS.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: 14,
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontWeight: 700, fontSize: 10, color, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1.2, display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {title}
      </div>
      <div style={{ fontSize: 12, color: "#9090b0", lineHeight: 1.8 }}>{content}</div>
    </div>
  );
}

function ListCard({ title, items, color, icon }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #111120, #0d0d1a)",
      border: `1px solid ${COLORS.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: 14,
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontWeight: 700, fontSize: 10, color, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.2 }}>{icon} {title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#9090b0", marginBottom: 6, lineHeight: 1.6 }}>
          <span style={{ color, flexShrink: 0, marginTop: 2 }}>›</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export function DeepDivePanel({ selected, deepDive, deepLoading }) {
  if (!selected) {
    return (
      <div style={{ color: COLORS.muted, textAlign: "center", marginTop: 100, padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔍</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#404060" }}>Select a symbol</div>
        <div style={{ fontSize: 12, marginTop: 6, color: "#2a2a45" }}>Click any row for deep AI analysis</div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* Symbol header */}
      <div style={{
        background: "linear-gradient(135deg, #111120, #0d0d1a)",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12, padding: 18, marginBottom: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{
              fontSize: 24, fontWeight: 900, letterSpacing: -0.5,
              background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>{selected.symbol}</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>{selected.market} · {selected.sector}</div>
          </div>
          <ScoreBadge score={selected.score} />
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.text, marginBottom: 10 }}>
          {selected.assetClass === "Forex"
            ? selected.price?.toFixed(4)
            : `$${selected.price?.toFixed(2)}`}
          <span style={{ fontSize: 13, marginLeft: 10, fontWeight: 600, color: selected.change_pct >= 0 ? COLORS.green : COLORS.red }}>
            {selected.change_pct >= 0 ? "▲" : "▼"} {Math.abs(selected.change_pct)?.toFixed(2)}%
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <SignalBadge signal={selected.signal} />
          <ConvictionBadge conviction={selected.conviction} />
          <HorizonTag horizon={selected.horizon} />
        </div>

        <Sparkline data={selected.prices} />
      </div>

      {/* Trade levels */}
      <div style={{
        background: "linear-gradient(135deg, #111120, #0d0d1a)",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: 14, marginBottom: 14,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12, fontWeight: 700 }}>Trade Levels</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            ["Entry", selected.entry, COLORS.blue, "→"],
            ["Target", selected.target, COLORS.green, "🎯"],
            ["Stop", selected.stop, COLORS.red, "🛑"],
            ["R/R Ratio", `${selected.risk_reward}x`, COLORS.gold, "⚖"],
          ].map(([label, value, color, icon]) => (
            <div key={label} style={{
              background: `${color}08`, border: `1px solid ${color}22`,
              borderRadius: 8, padding: "10px 12px",
            }}>
              <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>{icon} {label}</div>
              <div style={{ fontWeight: 800, color, fontSize: 15 }}>
                {typeof value === "string" ? value : (selected.assetClass === "Forex" ? Number(value)?.toFixed(4) : `$${Number(value)?.toFixed(2)}`)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 8 }}>
          <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4 }}>📊 Suggested Allocation</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 4, background: COLORS.border, borderRadius: 4 }}>
              <div style={{ width: `${(selected.allocation_pct / 10) * 100}%`, height: "100%", background: "linear-gradient(90deg,#a78bfa,#7c3aed)", borderRadius: 4 }} />
            </div>
            <span style={{ fontWeight: 800, color: COLORS.purple, fontSize: 14 }}>{selected.allocation_pct}%</span>
          </div>
        </div>
      </div>

      {/* Investor thesis */}
      <div style={{
        background: "linear-gradient(135deg, rgba(0,212,170,0.05), rgba(0,180,216,0.03))",
        border: "1px solid rgba(0,212,170,0.2)",
        borderRadius: 10, padding: 14, marginBottom: 14,
        boxShadow: "0 4px 16px rgba(0,212,170,0.05)",
      }}>
        <div style={{ fontSize: 10, color: COLORS.accent, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontWeight: 700 }}>💡 Investor Thesis</div>
        <div style={{ fontSize: 12, color: "#b0b0d0", lineHeight: 1.8 }}>{selected.investor_thesis}</div>
      </div>

      {selected.swing_thesis && (
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7, marginBottom: 16, paddingLeft: 12, borderLeft: `2px solid ${COLORS.border}` }}>
          {selected.swing_thesis}
        </div>
      )}

      {deepLoading && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.accent}`, margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
          <div style={{ color: COLORS.accent, fontSize: 12 }}>Claude is analyzing...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {deepDive && !deepDive.error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <InfoCard title="Market Overview"     content={deepDive.overview}       color={COLORS.accent}  icon="📊" />
          <InfoCard title="Technical Analysis"  content={deepDive.technical}      color={COLORS.blue}    icon="📈" />
          <InfoCard title="Fundamental"         content={deepDive.fundamental}    color={COLORS.purple}  icon="💼" />
          <InfoCard title="Macro Context"       content={deepDive.macro_context}  color={COLORS.gold}    icon="🌍" />
          {deepDive.catalysts && <ListCard title="Catalysts" items={deepDive.catalysts} color={COLORS.gold}  icon="⚡" />}
          {deepDive.risks      && <ListCard title="Risks"     items={deepDive.risks}     color={COLORS.red}   icon="⚠" />}
          <InfoCard title="Investor Plan"  content={deepDive.investor_plan}  color={COLORS.green}   icon="🗺" />
          <InfoCard title="Swing Plan"     content={deepDive.swing_plan}     color={COLORS.blue}    icon="⚡" />
          <InfoCard title="Portfolio Note" content={deepDive.portfolio_note} color={COLORS.muted}   icon="🗂" />
          <div style={{
            background: "linear-gradient(135deg, #111120, #0d0d1a)",
            border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 12, color: COLORS.muted }}>AI Confidence</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", gap: 3 }}>
                {[...Array(10)].map((_, i) => (
                  <div key={i} style={{
                    width: 6, height: 20, borderRadius: 3,
                    background: i < deepDive.confidence
                      ? (deepDive.confidence >= 7 ? COLORS.green : deepDive.confidence >= 5 ? COLORS.gold : COLORS.red)
                      : COLORS.border,
                  }} />
                ))}
              </div>
              <span style={{ fontWeight: 800, fontSize: 18, color: deepDive.confidence >= 7 ? COLORS.green : deepDive.confidence >= 5 ? COLORS.gold : COLORS.red }}>
                {deepDive.confidence}/10
              </span>
            </div>
          </div>
        </div>
      )}
      {deepDive?.error && (
        <div style={{ color: COLORS.red, fontSize: 12, marginTop: 8, padding: 12, background: "rgba(255,77,109,0.06)", borderRadius: 8, border: "1px solid rgba(255,77,109,0.2)" }}>
          ⚠ {deepDive.error}
        </div>
      )}
    </div>
  );
}
