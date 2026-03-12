import { useState, useEffect, useRef, useCallback } from "react";
import { COLORS } from "../lib/universe.js";
import { getAccount, getPositions, getOrders, closePosition } from "../lib/trading.js";
import { openChartWindow } from "../lib/chart-window.js";

const POLL_MS = 5_000; // 5-second live refresh

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: COLORS.cardGrad,
      border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || COLORS.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function PortfolioPanel({ settings, mcpStatus }) {
  const [account, setAccount]     = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders]       = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError]         = useState(null);
  const [closing, setClosing]     = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [flash, setFlash]         = useState(false); // pulse on each update
  const pollRef                   = useRef(null);
  const flashRef                  = useRef(null);

  const hasCredentials = settings.alpacaKey && settings.alpacaSecret;

  const load = useCallback(async (isBackground = false) => {
    if (!hasCredentials) return;
    if (!isBackground) setInitialLoading(true);
    try {
      const [acc, pos, ords] = await Promise.all([
        getAccount(settings),
        getPositions(settings),
        getOrders(settings),
      ]);
      setAccount(acc);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      setError(null);
      setLastUpdated(new Date());
      // Brief flash to signal refresh
      setFlash(true);
      clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setFlash(false), 600);
    } catch (e) {
      if (!isBackground) setError(e.message);
    } finally {
      if (!isBackground) setInitialLoading(false);
    }
  }, [settings.alpacaKey, settings.alpacaSecret, settings.alpacaMode]);

  // Initial load + live polling
  useEffect(() => {
    if (!hasCredentials) return;
    load(false);
    pollRef.current = setInterval(() => load(true), POLL_MS);
    return () => {
      clearInterval(pollRef.current);
      clearTimeout(flashRef.current);
    };
  }, [load, hasCredentials]);

  const handleClose = async (symbol) => {
    setClosing(symbol);
    try {
      await closePosition(symbol, settings);
      await load(false);
    } catch (e) {
      alert(`Failed to close ${symbol}: ${e.message}`);
    } finally {
      setClosing(null);
    }
  };

  if (!hasCredentials) {
    return (
      <div style={{ color: COLORS.muted, textAlign: "center", marginTop: 80, padding: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>📈</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted }}>No Alpaca credentials</div>
        <div style={{ fontSize: 12, marginTop: 6, color: COLORS.muted }}>Add your API keys in ⚙ Settings</div>
      </div>
    );
  }

  if (initialLoading) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.accent}`, margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
        <div style={{ color: COLORS.muted, fontSize: 12 }}>Loading portfolio...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  const equity        = parseFloat(account?.equity || account?.portfolio_value || 0);
  const cash          = parseFloat(account?.cash || 0);
  // non_marginable_buying_power = actual settled cash, no leverage/margin.
  // Falls back to buying_power for cash accounts where they're equivalent.
  const rawBuyingPower = parseFloat(account?.non_marginable_buying_power || account?.buying_power || 0);
  const reservedAmt   = settings.reserveFixed > 0
    ? Math.min(settings.reserveFixed, rawBuyingPower)
    : rawBuyingPower * ((settings.reservePct ?? 0) / 100);
  const usableBp      = Math.max(0, rawBuyingPower - reservedAmt);
  const dayPL         = parseFloat(account?.equity || 0) - parseFloat(account?.last_equity || 0);
  const dayPLPct      = parseFloat(account?.last_equity || 0) > 0 ? (dayPL / parseFloat(account.last_equity)) * 100 : 0;
  const onMargin      = cash < 0;
  const recentOrders  = orders.slice(0, 10);
  const totalUnrPL    = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const totalCostBasis = positions.reduce((s, p) => s + parseFloat(p.cost_basis || 0), 0);
  const totalUnrPct   = totalCostBasis > 0 ? (totalUnrPL / totalCostBasis) * 100 : 0;

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {error && (
        <div style={{ color: COLORS.red, fontSize: 12, padding: "10px 14px", background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: 8, marginBottom: 14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Mode badge */}
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "4px 12px", borderRadius: 20, letterSpacing: 1, textTransform: "uppercase",
            background: settings.alpacaMode === "live" ? "rgba(255,77,109,0.15)" : "rgba(240,180,41,0.12)",
            border: `1px solid ${settings.alpacaMode === "live" ? "rgba(255,77,109,0.4)" : "rgba(240,180,41,0.3)"}`,
            color: settings.alpacaMode === "live" ? COLORS.red : COLORS.gold,
          }}>
            {settings.alpacaMode === "live" ? "⚡ Live" : "🧪 Paper"}
          </span>
          {/* MCP badge */}
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "4px 10px", borderRadius: 20, letterSpacing: 1,
            display: "flex", alignItems: "center", gap: 5,
            background: mcpStatus === "connected" ? "rgba(0,212,170,0.1)" : "rgba(107,107,138,0.08)",
            border: `1px solid ${mcpStatus === "connected" ? "rgba(0,212,170,0.3)" : "rgba(107,107,138,0.2)"}`,
            color: mcpStatus === "connected" ? COLORS.green : COLORS.muted,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: mcpStatus === "connected" ? COLORS.green : COLORS.muted, display: "inline-block" }} />
            MCP {mcpStatus === "connected" ? "On" : "Off"}
          </span>
          {/* Live indicator */}
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "4px 10px", borderRadius: 20,
            display: "flex", alignItems: "center", gap: 5,
            background: flash ? "rgba(0,212,170,0.15)" : "rgba(0,212,170,0.06)",
            border: `1px solid rgba(0,212,170,${flash ? "0.5" : "0.2"})`,
            color: COLORS.accent, transition: "all 0.3s",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.accent, display: "inline-block", animation: "pulse 2s infinite" }} />
            LIVE · {POLL_MS / 1000}s
          </span>
        </div>
        {/* Last updated */}
        {lastUpdated && (
          <span style={{ fontSize: 9, color: COLORS.muted }}>
            Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>

      {/* Account stats */}
      {account && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <StatCard
            label="Portfolio Value"
            value={`$${equity.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            color={COLORS.accent}
            sub={`Cash: ${cash < 0 ? "-" : ""}$${Math.abs(cash).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${onMargin ? " ⚠ margin" : ""}`}
          />
          <StatCard
            label="Buying Power"
            value={`$${rawBuyingPower.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            color={COLORS.blue}
            sub={reservedAmt > 0
              ? `$${usableBp.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} usable · $${reservedAmt.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} reserved`
              : "Settled cash · no margin"}
          />
          <StatCard
            label="Day P&L"
            value={`${dayPL >= 0 ? "+" : ""}$${dayPL.toFixed(2)}`}
            color={dayPL >= 0 ? COLORS.green : COLORS.red}
            sub={`${dayPLPct >= 0 ? "+" : ""}${dayPLPct.toFixed(2)}% today`}
          />
          <StatCard
            label="Total P&L"
            value={`${totalUnrPL >= 0 ? "+" : ""}$${totalUnrPL.toFixed(2)}`}
            color={totalUnrPL >= 0 ? COLORS.green : COLORS.red}
            sub={positions.length > 0 ? `${totalUnrPct >= 0 ? "+" : ""}${totalUnrPct.toFixed(2)}% unrealized` : "No open positions"}
          />
        </div>
      )}

      {/* Total summary bar */}
      {account && (() => {
        const longMv = parseFloat(account?.long_market_value || 0);
        return (
          <div style={{
            background: "rgba(0,212,170,0.04)", border: `1px solid rgba(0,212,170,0.15)`,
            borderRadius: 10, padding: "12px 16px", marginBottom: 14,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
              Account Total
            </div>
            {/* Equation row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: COLORS.muted }}>Cash</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: cash < 0 ? COLORS.red : COLORS.text }}>
                {cash < 0 ? "-" : "+"}${Math.abs(cash).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ fontSize: 12, color: COLORS.muted }}>+  Positions</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>
                ${longMv.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span style={{ fontSize: 12, color: COLORS.muted }}>=</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: COLORS.accent }}>
                ${equity.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            {/* Unrealized P&L row */}
            {positions.length > 0 && (
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <div style={{ fontSize: 11, color: COLORS.muted }}>
                  Unrealized P&L:
                  <span style={{ fontWeight: 700, marginLeft: 6, color: totalUnrPL >= 0 ? COLORS.green : COLORS.red }}>
                    {totalUnrPL >= 0 ? "+" : ""}${totalUnrPL.toFixed(2)}
                  </span>
                  <span style={{ marginLeft: 4, color: totalUnrPL >= 0 ? COLORS.green : COLORS.red, fontWeight: 600 }}>
                    ({totalUnrPct >= 0 ? "+" : ""}{totalUnrPct.toFixed(2)}%)
                  </span>
                </div>
                {onMargin && (
                  <div style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(255,77,109,0.1)", border: "1px solid rgba(255,77,109,0.25)", color: COLORS.red, fontWeight: 700 }}>
                    ⚠ Using margin
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Open positions */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
          Open Positions ({positions.length})
        </div>
        {positions.length === 0 ? (
          <div style={{ fontSize: 12, color: COLORS.muted, padding: "20px 0", textAlign: "center" }}>No open positions</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(() => {
              const totalMv    = positions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0);
              const totalCost  = positions.reduce((s, p) => s + parseFloat(p.cost_basis || 0), 0);
              const totalPL    = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
              const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
              return (
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 14px", marginBottom: 4,
                  background: "rgba(255,255,255,0.02)", borderRadius: 8,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1 }}>
                    {positions.length} positions total
                  </span>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: COLORS.muted }}>
                      Cost basis: <span style={{ color: COLORS.text, fontWeight: 600 }}>${totalCost.toFixed(2)}</span>
                    </span>
                    <span style={{ fontSize: 11, color: COLORS.muted }}>
                      Market value: <span style={{ color: COLORS.text, fontWeight: 700 }}>${totalMv.toFixed(2)}</span>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: totalPL >= 0 ? COLORS.green : COLORS.red }}>
                      {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)} ({totalPLPct >= 0 ? "+" : ""}{totalPLPct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              );
            })()}
            {positions.map(p => {
              const pl     = parseFloat(p.unrealized_pl);
              const plPct  = parseFloat(p.unrealized_plpc) * 100;
              const curPrice = parseFloat(p.current_price || 0);
              const bracketOrder = orders.find(o =>
                o.symbol === p.symbol && o.order_class === "bracket" &&
                ["accepted", "pending_new", "new", "partially_filled"].includes(o.status)
              );
              const tp = bracketOrder?.legs?.find(l => l.type === "limit")?.limit_price;
              const sl = bracketOrder?.legs?.find(l => l.type === "stop")?.stop_price
                      || bracketOrder?.legs?.find(l => l.type === "stop_limit")?.stop_price;
              return (
                <div key={p.symbol} style={{
                  background: COLORS.cardGrad,
                  border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div
                        onClick={() => openChartWindow(p.symbol, { assetClass: p.asset_class })}
                        title="Open chart"
                        style={{ fontWeight: 800, fontSize: 13, color: COLORS.text, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                        onMouseEnter={e => e.currentTarget.style.color = COLORS.accent}
                        onMouseLeave={e => e.currentTarget.style.color = COLORS.text}
                      >{p.symbol} <span style={{ fontSize: 9, opacity: 0.4 }}>⤢</span></div>
                      <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
                        {parseFloat(p.qty).toFixed(4)} sh · avg ${parseFloat(p.avg_entry_price).toFixed(2)}
                        {curPrice > 0 && <span style={{ color: COLORS.text, fontWeight: 600 }}> · now ${curPrice.toFixed(2)}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>${parseFloat(p.market_value).toFixed(2)}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: pl >= 0 ? COLORS.green : COLORS.red }}>
                        {pl >= 0 ? "+" : ""}${pl.toFixed(2)} ({plPct >= 0 ? "+" : ""}{plPct.toFixed(2)}%)
                      </div>
                    </div>
                    <button
                      onClick={() => handleClose(p.symbol)}
                      disabled={closing === p.symbol}
                      style={{
                        marginLeft: 12, padding: "5px 10px", borderRadius: 8,
                        border: "1px solid rgba(255,77,109,0.3)", background: "rgba(255,77,109,0.08)",
                        color: COLORS.red, fontSize: 10, cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
                      }}
                    >{closing === p.symbol ? "..." : "Close"}</button>
                  </div>
                  {(sl || tp) && (
                    <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                      {sl && (
                        <div style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", color: COLORS.red, fontWeight: 600 }}>
                          🛑 SL ${parseFloat(sl).toFixed(2)}
                        </div>
                      )}
                      {tp && (
                        <div style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.2)", color: COLORS.green, fontWeight: 600 }}>
                          🎯 TP ${parseFloat(tp).toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent orders */}
      {recentOrders.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
            Recent Orders
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentOrders.map(o => {
              const statusColor = o.status === "filled" ? COLORS.green : o.status === "canceled" ? COLORS.muted : COLORS.gold;
              return (
                <div key={o.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", background: COLORS.cardGrad,
                  border: `1px solid ${COLORS.border}`, borderRadius: 8,
                }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 10,
                      background: o.side === "buy" ? "rgba(0,212,170,0.12)" : "rgba(255,77,109,0.12)",
                      color: o.side === "buy" ? COLORS.accent : COLORS.red,
                    }}>{o.side.toUpperCase()}</span>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>{o.symbol}</span>
                    <span style={{ fontSize: 10, color: COLORS.muted }}>
                      {o.notional ? `$${parseFloat(o.notional).toFixed(2)}` : `${o.qty} shares`}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusColor, textTransform: "capitalize" }}>{o.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
