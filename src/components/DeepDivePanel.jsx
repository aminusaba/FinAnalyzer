import { COLORS } from "../lib/universe.js";
import { Sparkline } from "./Sparkline.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag } from "./Badges.jsx";

function InfoCard({ title, content, color }) {
  return (
    <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14 }}>
      <div style={{ fontWeight:700, fontSize:11, color, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>{title}</div>
      <div style={{ fontSize:12, color:COLORS.muted, lineHeight:1.7 }}>{content}</div>
    </div>
  );
}

function ListCard({ title, items, color }) {
  return (
    <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14 }}>
      <div style={{ fontWeight:700, fontSize:11, color, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ fontSize:12, color:COLORS.muted, marginBottom:4 }}>• {item}</div>
      ))}
    </div>
  );
}

export function DeepDivePanel({ selected, deepDive, deepLoading }) {
  if (!selected) {
    return (
      <div style={{ color:COLORS.muted, textAlign:"center", marginTop:80 }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🔍</div>
        <div style={{ fontSize:14 }}>Click any symbol</div>
        <div style={{ fontSize:12, marginTop:4 }}>for a full AI deep-dive</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:COLORS.accent }}>{selected.symbol}</div>
          <div style={{ fontSize:12, color:COLORS.muted, marginTop:2 }}>{selected.market} · {selected.sector}</div>
          <div style={{ fontSize:20, fontWeight:700, marginTop:4 }}>
            {selected.price?.toFixed(selected.assetClass === "Forex" ? 4 : 2)}
            <span style={{ fontSize:13, marginLeft:8, color:selected.change_pct >= 0 ? COLORS.green : COLORS.red }}>
              {selected.change_pct >= 0 ? "+" : ""}{selected.change_pct?.toFixed(2)}%
            </span>
          </div>
          <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <SignalBadge signal={selected.signal} />
            <ConvictionBadge conviction={selected.conviction} />
            <HorizonTag horizon={selected.horizon} />
          </div>
        </div>
        <ScoreBadge score={selected.score} />
      </div>

      <Sparkline data={selected.prices} />

      {/* Trade levels */}
      <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14, marginTop:12, marginBottom:12 }}>
        <div style={{ fontSize:10, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>Trade Levels</div>
        {[
          ["Entry", selected.entry, COLORS.blue],
          ["Target", selected.target, COLORS.green],
          ["Stop", selected.stop, COLORS.red],
          ["R/R", `${selected.risk_reward}x`, COLORS.gold],
          ["Allocation", `${selected.allocation_pct}% of portfolio`, COLORS.purple],
        ].map(([label, value, color]) => (
          <div key={label} style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ color:COLORS.muted, fontSize:12 }}>{label}</span>
            <span style={{ fontWeight:700, color, fontSize:13 }}>{typeof value === "string" ? value : Number(value)?.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Investor thesis */}
      <div style={{ background:COLORS.card, border:`1px solid rgba(0,212,170,0.2)`, borderRadius:10, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:10, color:COLORS.accent, textTransform:"uppercase", letterSpacing:1, marginBottom:6, fontWeight:700 }}>Investor Thesis</div>
        <div style={{ fontSize:12, color:COLORS.text, lineHeight:1.7 }}>{selected.investor_thesis}</div>
      </div>

      {/* Swing thesis */}
      <div style={{ color:COLORS.muted, fontSize:12, lineHeight:1.7, marginBottom:16 }}>{selected.swing_thesis}</div>

      {deepLoading && (
        <div style={{ color:COLORS.accent, fontSize:13, textAlign:"center", padding:24 }}>⟳ AI analyzing...</div>
      )}

      {deepDive && !deepDive.error && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <InfoCard title="📊 Market Overview" content={deepDive.overview} color={COLORS.accent} />
          <InfoCard title="📈 Technical Analysis" content={deepDive.technical} color={COLORS.blue} />
          <InfoCard title="💼 Fundamental Analysis" content={deepDive.fundamental} color={COLORS.purple} />
          <InfoCard title="🌍 Macro Context" content={deepDive.macro_context} color={COLORS.gold} />
          {deepDive.catalysts && <ListCard title="⚡ Catalysts" items={deepDive.catalysts} color={COLORS.gold} />}
          {deepDive.risks && <ListCard title="⚠ Risks" items={deepDive.risks} color={COLORS.red} />}
          <InfoCard title="📋 Investor Plan" content={deepDive.investor_plan} color={COLORS.green} />
          <InfoCard title="⚡ Swing Plan" content={deepDive.swing_plan} color={COLORS.blue} />
          <InfoCard title="🗂 Portfolio Note" content={deepDive.portfolio_note} color={COLORS.muted} />
          <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:12, color:COLORS.muted }}>AI Confidence</span>
            <span style={{ fontWeight:800, fontSize:20, color: deepDive.confidence >= 7 ? COLORS.green : deepDive.confidence >= 5 ? COLORS.gold : COLORS.red }}>
              {deepDive.confidence}/10
            </span>
          </div>
        </div>
      )}
      {deepDive?.error && <div style={{ color:COLORS.red, fontSize:12, marginTop:8 }}>Error: {deepDive.error}</div>}
    </div>
  );
}
