import { useState } from "react";
import { Search, ExternalLink, TrendingUp, TrendingDown, Target, ShieldAlert, Scale, ArrowRight, Lightbulb, BarChart2, Globe, Zap, AlertTriangle, Map, FolderOpen, CheckCircle, XCircle, Check, X, FlaskConical, Briefcase } from "lucide-react";
import { COLORS } from "../lib/universe.js";
import { TradingChart } from "./TradingChart.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag } from "./Badges.jsx";
import { openChartWindow } from "../lib/chart-window.js";

function InfoCard({ title, content, color, icon }) {
  return (
    <div style={{
      background: COLORS.cardGrad,
      border: `1px solid ${COLORS.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: 14,
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontWeight: 700, fontSize: 10, color, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1.2, display: "flex", alignItems: "center", gap: 6 }}>
        {icon} {title}
      </div>
      <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.8 }}>{content}</div>
    </div>
  );
}

function ListCard({ title, items, color, icon }) {
  return (
    <div style={{
      background: COLORS.cardGrad,
      border: `1px solid ${COLORS.border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 10, padding: 14,
      boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontWeight: 700, fontSize: 10, color, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.2 }}>{icon} {title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: COLORS.muted, marginBottom: 6, lineHeight: 1.6 }}>
          <span style={{ color, flexShrink: 0, marginTop: 2 }}>›</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function ManualTradePanel({ selected, settings, buyingPower, onBuy, onSell }) {
  const notional = buyingPower && selected?.allocation_pct
    ? (buyingPower * selected.allocation_pct) / 100
    : 0;
  const bracketValid = selected?.stop && selected?.target && !selected?._bracketInvalid;
  const [status, setStatus] = useState(null); // null | "loading" | { ok, msg }

  const hasKeys  = settings?.alpacaKey && settings?.alpacaSecret;
  const isBuy    = selected?.signal === "BUY";
  const isSell   = selected?.signal === "SELL";

  const handleExecute = async () => {
    setStatus("loading");
    try {
      if (isSell) {
        await onSell(selected);
        setStatus({ ok: true, msg: `Position in ${selected.symbol} closed` });
      } else {
        await onBuy(selected, notional, settings?.bracketOrdersEnabled && bracketValid);
        const bracketNote = settings?.bracketOrdersEnabled && bracketValid
          ? ` · SL $${Number(selected.stop).toFixed(2)} / TP $${Number(selected.target).toFixed(2)}`
          : "";
        setStatus({ ok: true, msg: `Bought $${notional.toFixed(2)} of ${selected.symbol}${bracketNote}` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    }
  };

  const signalColor = isBuy ? COLORS.green : isSell ? COLORS.red : COLORS.gold;

  return (
    <div style={{
      background: COLORS.cardGrad,
      border: `1px solid ${isBuy ? "rgba(0,212,170,0.25)" : isSell ? "rgba(255,77,109,0.25)" : COLORS.border}`,
      borderRadius: 12, padding: 16, marginBottom: 14,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12, display:"flex", alignItems:"center", gap:5 }}>
        Execute AI Signal · {settings?.alpacaMode === "live" ? <><Zap size={10} />Live</> : <><FlaskConical size={10} />Paper</>}
      </div>

      {!hasKeys && (
        <div style={{ fontSize: 11, color: COLORS.gold, background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          Add Alpaca API keys in Settings to enable trading
        </div>
      )}

      {/* AI recommendation summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        {[
          ["Signal",     selected?.signal,                          signalColor],
          ["Amount",     notional > 0 ? `$${notional.toFixed(0)}` : "—", COLORS.text],
          ["Allocation", `${selected?.allocation_pct ?? "—"}%`,    COLORS.purple],
          ["Entry",      selected?.entry   ? `$${Number(selected.entry).toFixed(2)}`  : "—", COLORS.blue],
          ["Stop",       selected?.stop    ? `$${Number(selected.stop).toFixed(2)}`   : "—", COLORS.red],
          ["Target",     selected?.target  ? `$${Number(selected.target).toFixed(2)}` : "—", COLORS.green],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "8px 10px", border: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: 9, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Bracket note */}
      {settings?.bracketOrdersEnabled && (
        <div style={{ fontSize: 10, color: bracketValid ? COLORS.accent : COLORS.muted, marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
          {bracketValid ? <Check size={11} /> : <X size={11} />}
          <span>{bracketValid ? "Bracket order (SL + TP) will be attached" : "Bracket skipped — invalid R/R math from AI"}</span>
        </div>
      )}

      {/* Execute button */}
      <button
        disabled={!hasKeys || status === "loading" || notional < 1}
        onClick={handleExecute}
        style={{
          width: "100%", padding: "13px 0", border: "none", borderRadius: 10,
          fontWeight: 800, fontSize: 13, letterSpacing: 0.3,
          cursor: hasKeys && notional >= 1 ? "pointer" : "not-allowed",
          background: !hasKeys || notional < 1 ? COLORS.border
            : isSell ? "linear-gradient(135deg, #ff4d6d, #e11d48)"
            : "linear-gradient(135deg, #00d4aa, #00b4d8)",
          color: !hasKeys || notional < 1 ? COLORS.muted : isSell ? "#fff" : "#000",
          boxShadow: hasKeys && notional >= 1 ? (isSell ? "0 4px 16px rgba(255,77,109,0.3)" : "0 4px 16px rgba(0,212,170,0.3)") : "none",
          transition: "all 0.2s", fontFamily: "inherit",
        }}
        onMouseEnter={e => { if (hasKeys && notional >= 1) e.currentTarget.style.opacity = "0.85"; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
      >
        {status === "loading" ? "Placing order..." : isSell
          ? <><TrendingDown size={13} style={{marginRight:6,verticalAlign:"middle"}} />Close / Sell {selected?.symbol}</>
          : <><TrendingUp size={13} style={{marginRight:6,verticalAlign:"middle"}} />Buy {selected?.symbol} · ${notional.toFixed(0)}</>}
      </button>

      {/* Status */}
      {status && status !== "loading" && (
        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600,
          background: status.ok ? "rgba(0,212,170,0.08)" : "rgba(255,77,109,0.08)",
          border: `1px solid ${status.ok ? "rgba(0,212,170,0.3)" : "rgba(255,77,109,0.3)"}`,
          color: status.ok ? COLORS.green : COLORS.red,
        }}>
          {status.ok ? <CheckCircle size={11} style={{verticalAlign:"middle",marginRight:4}} /> : <XCircle size={11} style={{verticalAlign:"middle",marginRight:4}} />}{status.msg}
        </div>
      )}
    </div>
  );
}

export function DeepDivePanel({ selected, deepDive, deepLoading, settings, buyingPower, onBuy, onSell }) {
  if (!selected) {
    return (
      <div style={{ color: COLORS.muted, textAlign: "center", marginTop: 100, padding: 24 }}>
        <div style={{ marginBottom: 16, opacity: 0.3, display:"flex", justifyContent:"center" }}><Search size={48} /></div>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted }}>Select a symbol</div>
        <div style={{ fontSize: 12, marginTop: 6, color: COLORS.muted }}>Click any row for deep AI analysis</div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* Symbol header */}
      <div style={{
        background: COLORS.cardGrad,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12, padding: 18, marginBottom: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div
              onClick={() => openChartWindow(selected.symbol, { assetClass: selected.assetClass, entry: selected.entry, stop: selected.stop, target: selected.target, price: selected.price })}
              title="Open chart in new window"
              style={{
                fontSize: 24, fontWeight: 900, letterSpacing: -0.5,
                background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                cursor: "pointer", userSelect: "none",
              }}
            >{selected.symbol} <span style={{ WebkitTextFillColor: COLORS.muted, opacity: 0.5, display:"inline-flex", verticalAlign:"middle" }}><ExternalLink size={13} /></span></div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>{selected.market} · {selected.sector}</div>
          </div>
          <ScoreBadge score={selected.score} />
        </div>

        <div style={{ fontSize: 22, fontWeight: 800, color: COLORS.text, marginBottom: 10 }}>
          {selected.assetClass === "Forex"
            ? selected.price?.toFixed(4)
            : `$${selected.price?.toFixed(2)}`}
          <span style={{ fontSize: 13, marginLeft: 10, fontWeight: 600, color: selected.change_pct >= 0 ? COLORS.green : COLORS.red }}>
            {selected.change_pct >= 0 ? <TrendingUp size={12} style={{verticalAlign:"middle",marginRight:3}} /> : <TrendingDown size={12} style={{verticalAlign:"middle",marginRight:3}} />}{Math.abs(selected.change_pct)?.toFixed(2)}%
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <SignalBadge signal={selected.signal} />
          <ConvictionBadge conviction={selected.conviction} />
          <HorizonTag horizon={selected.horizon} />
        </div>

        <TradingChart
          symbol={selected.symbol}
          assetClass={selected.assetClass}
          settings={settings}
          entry={selected.entry}
          stop={selected.stop}
          target={selected.target}
        />
      </div>

      {/* Manual trade panel */}
      <ManualTradePanel selected={selected} settings={settings} buyingPower={buyingPower} onBuy={onBuy} onSell={onSell} />

      {/* Trade levels */}
      <div style={{
        background: COLORS.cardGrad,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: 14, marginBottom: 14,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12, fontWeight: 700 }}>Trade Levels</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            ["Entry", selected.entry, COLORS.blue, <ArrowRight size={10} />],
            ["Target", selected.target, COLORS.green, <Target size={10} />],
            ["Stop", selected.stop, COLORS.red, <ShieldAlert size={10} />],
            ["R/R Ratio", `${selected.risk_reward}x`, COLORS.gold, <Scale size={10} />],
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
          <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4, display:"flex", alignItems:"center", gap:4 }}><BarChart2 size={10} /> Suggested Allocation</div>
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
        <div style={{ fontSize: 10, color: COLORS.accent, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontWeight: 700, display:"flex", alignItems:"center", gap:5 }}><Lightbulb size={11} /> Investor Thesis</div>
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.8 }}>{selected.investor_thesis}</div>
      </div>

      {selected.swing_thesis && (
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.7, marginBottom: 16, paddingLeft: 12, borderLeft: `2px solid ${COLORS.border}` }}>
          {selected.swing_thesis}
        </div>
      )}

      {deepLoading && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.accent}`, margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
          <div style={{ color: COLORS.accent, fontSize: 12 }}>Analyzing...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {deepDive && !deepDive.error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <InfoCard title="Market Overview"     content={deepDive.overview}       color={COLORS.accent}  icon={<BarChart2 size={11} />} />
          <InfoCard title="Technical Analysis"  content={deepDive.technical}      color={COLORS.blue}    icon={<TrendingUp size={11} />} />
          <InfoCard title="Fundamental"         content={deepDive.fundamental}    color={COLORS.purple}  icon={<Briefcase size={11} />} />
          <InfoCard title="Macro Context"       content={deepDive.macro_context}  color={COLORS.gold}    icon={<Globe size={11} />} />
          {deepDive.catalysts && <ListCard title="Catalysts" items={deepDive.catalysts} color={COLORS.gold}  icon={<Zap size={11} />} />}
          {deepDive.risks      && <ListCard title="Risks"     items={deepDive.risks}     color={COLORS.red}   icon={<AlertTriangle size={11} />} />}
          <InfoCard title="Investor Plan"  content={deepDive.investor_plan}  color={COLORS.green}   icon={<Map size={11} />} />
          <InfoCard title="Swing Plan"     content={deepDive.swing_plan}     color={COLORS.blue}    icon={<Zap size={11} />} />
          <InfoCard title="Portfolio Note" content={deepDive.portfolio_note} color={COLORS.muted}   icon={<FolderOpen size={11} />} />
          <div style={{
            background: COLORS.cardGrad,
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
          <AlertTriangle size={11} style={{verticalAlign:"middle",marginRight:4}} />{deepDive.error}
        </div>
      )}
    </div>
  );
}
