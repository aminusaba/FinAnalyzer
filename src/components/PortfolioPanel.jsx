import { useState, useEffect, useCallback } from "react";
import { COLORS } from "../lib/universe.js";
import { getAccount, getPositions, getOrders, closePosition, isAlpacaSupported } from "../lib/alpaca.js";

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #111120, #0d0d1a)",
      border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || COLORS.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function PortfolioPanel({ settings }) {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(null);

  const hasCredentials = settings.alpacaKey && settings.alpacaSecret;

  const load = useCallback(async () => {
    if (!hasCredentials) return;
    setLoading(true);
    setError(null);
    try {
      const [acc, pos, ords] = await Promise.all([
        getAccount(settings),
        getPositions(settings),
        getOrders(settings),
      ]);
      setAccount(acc);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [settings.alpacaKey, settings.alpacaSecret, settings.alpacaMode]);

  useEffect(() => { load(); }, [load]);

  const handleClose = async (symbol) => {
    setClosing(symbol);
    try {
      await closePosition(symbol, settings);
      await load();
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
        <div style={{ fontSize: 13, fontWeight: 600, color: "#404060" }}>No Alpaca credentials</div>
        <div style={{ fontSize: 12, marginTop: 6, color: "#2a2a45" }}>Add your API keys in ⚙ Alerts settings</div>
      </div>
    );
  }

  if (loading && !account) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTop: `2px solid ${COLORS.accent}`, margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
        <div style={{ color: COLORS.muted, fontSize: 12 }}>Loading portfolio...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  const equity = parseFloat(account?.equity || 0);
  const buyingPower = parseFloat(account?.buying_power || 0);
  const dayPL = parseFloat(account?.equity || 0) - parseFloat(account?.last_equity || 0);
  const dayPLPct = account?.last_equity > 0 ? (dayPL / parseFloat(account.last_equity)) * 100 : 0;

  const recentOrders = orders.slice(0, 10);

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {error && (
        <div style={{ color: COLORS.red, fontSize: 12, padding: "10px 14px", background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: 8, marginBottom: 14 }}>
          ⚠ {error}
        </div>
      )}

      {/* Mode badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "4px 12px", borderRadius: 20, letterSpacing: 1, textTransform: "uppercase",
          background: settings.alpacaMode === "live" ? "rgba(255,77,109,0.15)" : "rgba(240,180,41,0.12)",
          border: `1px solid ${settings.alpacaMode === "live" ? "rgba(255,77,109,0.4)" : "rgba(240,180,41,0.3)"}`,
          color: settings.alpacaMode === "live" ? COLORS.red : COLORS.gold,
        }}>
          {settings.alpacaMode === "live" ? "⚡ Live Trading" : "🧪 Paper Trading"}
        </span>
        <button onClick={load} disabled={loading} style={{
          padding: "5px 12px", borderRadius: 12, border: `1px solid ${COLORS.border}`,
          background: "transparent", color: COLORS.muted, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
        }}>↻ Refresh</button>
      </div>

      {/* Account stats */}
      {account && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <StatCard label="Portfolio Value" value={`$${equity.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={COLORS.accent} />
          <StatCard label="Buying Power" value={`$${buyingPower.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={COLORS.blue} />
          <StatCard
            label="Day P&L"
            value={`${dayPL >= 0 ? "+" : ""}$${dayPL.toFixed(2)}`}
            color={dayPL >= 0 ? COLORS.green : COLORS.red}
            sub={`${dayPLPct >= 0 ? "+" : ""}${dayPLPct.toFixed(2)}% today`}
          />
          <StatCard label="Wallet Size" value={`$${(settings.walletSize || 0).toLocaleString()}`} color={COLORS.purple} sub="configured" />
        </div>
      )}

      {/* Open positions */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10 }}>
          Open Positions ({positions.length})
        </div>
        {positions.length === 0 ? (
          <div style={{ fontSize: 12, color: "#2a2a45", padding: "20px 0", textAlign: "center" }}>No open positions</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {positions.map(p => {
              const pl = parseFloat(p.unrealized_pl);
              const plPct = parseFloat(p.unrealized_plpc) * 100;
              // Find bracket legs from open orders for this symbol
              const bracketOrder = orders.find(o =>
                o.symbol === p.symbol && o.order_class === "bracket" &&
                ["accepted", "pending_new", "new", "partially_filled"].includes(o.status)
              );
              const tp = bracketOrder?.legs?.find(l => l.type === "limit")?.limit_price;
              const sl = bracketOrder?.legs?.find(l => l.type === "stop")?.stop_price
                      || bracketOrder?.legs?.find(l => l.type === "stop_limit")?.stop_price;
              return (
                <div key={p.symbol} style={{
                  background: "linear-gradient(135deg, #111120, #0d0d1a)",
                  border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, color: COLORS.text }}>{p.symbol}</div>
                      <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
                        {parseFloat(p.qty).toFixed(4)} shares · avg ${parseFloat(p.avg_entry_price).toFixed(2)}
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
                  padding: "10px 14px", background: "linear-gradient(135deg, #111120, #0d0d1a)",
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
