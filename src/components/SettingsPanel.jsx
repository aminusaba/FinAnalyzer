import { useState } from "react";
import { COLORS } from "../lib/universe.js";
import { sendTelegram } from "../lib/notifications.js";
import { getAccount } from "../lib/alpaca.js";

export function SettingsPanel({ settings, onChange, onClose }) {
  const set = (key, val) => onChange({ ...settings, [key]: val });
  const [alpacaTestMsg, setAlpacaTestMsg] = useState("");
  const [resetStatus, setResetStatus]     = useState(null); // null | "confirm" | "done" | "error"
  const [resetOpts, setResetOpts]         = useState({ clearTrades: true, clearHistory: false });

  const testTelegram = async () => {
    if (!settings.telegramChatId) return alert("Enter your Telegram Chat ID first");
    await sendTelegram(settings.telegramChatId, {
      symbol: "TEST", signal: "BUY", score: 90, conviction: "HIGH",
      assetClass: "Equity", investor_thesis: "This is a test alert from FinAnalyzer.",
      target: 100, stop: 90,
    });
    alert("Test message sent! Check your Telegram.");
  };

  const inputStyle = {
    width:"100%", padding:"8px 10px", background:COLORS.bg, border:`1px solid ${COLORS.border}`,
    borderRadius:6, color:COLORS.text, fontSize:12, outline:"none", marginTop:4,
  };

  const rowStyle = {
    display:"flex", justifyContent:"space-between", alignItems:"center",
    padding:"10px 0", borderBottom:`1px solid ${COLORS.border}`,
  };

  const toggle = (checked, key) => (
    <div onClick={() => set(key, !checked)} style={{
      width:36, height:20, borderRadius:10, cursor:"pointer", transition:"background 0.2s",
      background: checked ? COLORS.accent : COLORS.border, position:"relative",
    }}>
      <div style={{
        width:16, height:16, borderRadius:"50%", background:"#fff",
        position:"absolute", top:2, left: checked ? 18 : 2, transition:"left 0.2s",
      }}/>
    </div>
  );

  return (
    <div style={{
      position:"fixed", top:0, right:0, width:360, height:"100vh", zIndex:200,
      background:COLORS.surface, borderLeft:`1px solid ${COLORS.border}`,
      overflowY:"auto", padding:24, boxShadow:"-8px 0 32px rgba(0,0,0,0.4)",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <div style={{ fontWeight:800, fontSize:16, color:COLORS.accent }}>⚙ Alert Settings</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:COLORS.muted, fontSize:20, cursor:"pointer" }}>✕</button>
      </div>

      {/* AI Model */}
      <div style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`, marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>AI Analysis Model</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { id: "o4-mini",  label: "o4-mini",  tag: "Recommended",  desc: "Best value — fast reasoning, great signal quality" },
            { id: "o3",       label: "o3",        tag: "Best quality", desc: "Deepest reasoning, highest cost per scan" },
            { id: "gpt-5",    label: "gpt-5",     tag: "",             desc: "Strong instruct model, less reasoning depth" },
            { id: "gpt-5-mini", label: "gpt-5-mini", tag: "Fastest", desc: "Cheapest, lower consistency on complex signals" },
          ].map(({ id, label, tag, desc }) => {
            const active = (settings.aiModel ?? "o4-mini") === id;
            return (
              <div key={id} onClick={() => set("aiModel", id)} style={{
                padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
                background: active ? "rgba(0,212,170,0.06)" : "transparent",
                transition: "all 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${active ? COLORS.accent : COLORS.border}`,
                    background: active ? COLORS.accent : "transparent",
                    boxShadow: active ? `0 0 6px ${COLORS.accent}` : "none",
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: active ? COLORS.accent : COLORS.text }}>{label}</span>
                  {tag && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: COLORS.gold, background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.25)", borderRadius: 8, padding: "1px 6px" }}>{tag}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 4, paddingLeft: 22 }}>{desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Browser notifications */}
      <div style={rowStyle}>
        <div>
          <div style={{ fontSize:13, fontWeight:600, color:COLORS.text }}>Browser Notifications</div>
          <div style={{ fontSize:11, color:COLORS.muted }}>Pop-up alerts in this browser</div>
        </div>
        {toggle(settings.browserEnabled, "browserEnabled")}
      </div>

      {/* Telegram */}
      <div style={{ padding:"10px 0", borderBottom:`1px solid ${COLORS.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:COLORS.text }}>Telegram Alerts</div>
            <div style={{ fontSize:11, color:COLORS.muted }}>Send to your Telegram bot</div>
          </div>
          {toggle(settings.telegramEnabled, "telegramEnabled")}
        </div>
        {settings.telegramEnabled && (
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:11, color:COLORS.muted }}>Your Chat ID</div>
            <input
              style={inputStyle}
              value={settings.telegramChatId}
              onChange={e => set("telegramChatId", e.target.value)}
              placeholder="e.g. 8337593109"
            />
            <button onClick={testTelegram} style={{
              marginTop:8, padding:"6px 14px", background:"rgba(0,212,170,0.1)",
              border:`1px solid ${COLORS.accent}`, borderRadius:6, color:COLORS.accent,
              fontSize:11, cursor:"pointer", fontWeight:600,
            }}>Send Test Message</button>
          </div>
        )}
      </div>

      {/* Auto-scan frequency — daemon only */}
      <div style={{ padding:"10px 0", borderBottom:`1px solid ${COLORS.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:COLORS.text }}>
              Auto-Scan
              <span style={{ marginLeft:6, fontSize:9, fontWeight:700, color:COLORS.gold, background:"rgba(240,180,41,0.1)", border:"1px solid rgba(240,180,41,0.25)", borderRadius:8, padding:"1px 6px", verticalAlign:"middle" }}>DAEMON ONLY</span>
            </div>
            <div style={{ fontSize:11, color:COLORS.muted }}>Runs via scan-daemon.js — not in this browser</div>
          </div>
          {toggle(settings.autoScanEnabled, "autoScanEnabled")}
        </div>
        {settings.autoScanEnabled && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:11, color:COLORS.muted, marginBottom:8 }}>Daemon scans every:</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[5, 10, 15, 20, 30, 60, 120].map(mins => (
                <button key={mins} onClick={() => set("autoScanInterval", mins)} style={{
                  padding:"5px 12px", borderRadius:14, fontSize:11, fontWeight:600, cursor:"pointer",
                  border:`1px solid ${settings.autoScanInterval === mins ? COLORS.accent : COLORS.border}`,
                  background: settings.autoScanInterval === mins ? "rgba(0,212,170,0.1)" : "transparent",
                  color: settings.autoScanInterval === mins ? COLORS.accent : COLORS.muted,
                }}>{mins < 60 ? `${mins}m` : `${mins / 60}h`}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MCP Server */}
      <div style={{ padding: "14px 0", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>MCP Server</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Enable Alpaca MCP</div>
            <div style={{ fontSize: 11, color: COLORS.muted }}>Use MCP server for trading (run start-mcp.bat)</div>
          </div>
          {toggle(settings.mcpEnabled, "mcpEnabled")}
        </div>
        {settings.mcpEnabled && (
          <div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>MCP Server URL</div>
            <input style={inputStyle} value={settings.mcpUrl || "http://localhost:8000"} onChange={e => set("mcpUrl", e.target.value)} placeholder="http://localhost:8000" />
            <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 6 }}>
              Run <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 3 }}>start-mcp.bat</code> in the project folder to start
            </div>
          </div>
        )}
      </div>

      {/* Alpaca Trading */}
      <div style={{ padding: "14px 0", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Alpaca Auto-Trading</div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>API Key ID</div>
          <input style={inputStyle} value={settings.alpacaKey || ""} onChange={e => set("alpacaKey", e.target.value)} placeholder="PKXXXXXXXXXXXXXXXXXXXXXXXX" />
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>Secret Key</div>
          <input type="password" style={inputStyle} value={settings.alpacaSecret || ""} onChange={e => set("alpacaSecret", e.target.value)} placeholder="••••••••••••••••••••••••••••••••" />
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>Mode</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["paper", "🧪 Paper"], ["live", "⚡ Live"]].map(([m, label]) => (
              <button key={m} onClick={() => set("alpacaMode", m)} style={{
                padding: "5px 14px", borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${settings.alpacaMode === m ? (m === "live" ? COLORS.red : COLORS.gold) : COLORS.border}`,
                background: settings.alpacaMode === m ? (m === "live" ? "rgba(255,77,109,0.1)" : "rgba(240,180,41,0.1)") : "transparent",
                color: settings.alpacaMode === m ? (m === "live" ? COLORS.red : COLORS.gold) : COLORS.muted,
                fontFamily: "inherit",
              }}>{label}</button>
            ))}
          </div>
        </div>


        {/* Reserve — mutually exclusive: fixed $ OR % slider */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: COLORS.muted }}>Reserve</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.gold }}>
              {settings.reserveFixed > 0
                ? `$${settings.reserveFixed.toLocaleString()} fixed`
                : `${settings.reservePct ?? 0}% of BP`}
            </div>
          </div>

          {/* Fixed $ input — when filled, disables the slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: COLORS.muted, whiteSpace: "nowrap" }}>Fixed $</span>
            <input type="number" min={0} step={100} placeholder="leave blank to use %"
              value={settings.reserveFixed ?? ""}
              onChange={e => {
                const val = e.target.value === "" ? null : parseFloat(e.target.value);
                set("reserveFixed", val);
                if (val > 0) set("reservePct", 0); // clear % when fixed is set
              }}
              style={{ flex: 1, background: COLORS.surface, border: `1px solid ${settings.reserveFixed > 0 ? COLORS.gold : COLORS.border}`, borderRadius: 4, padding: "4px 8px", color: COLORS.text, fontSize: 12 }}
            />
          </div>

          {/* % slider — disabled when fixed $ is active */}
          <input type="range" min={0} max={50} step={5}
            value={settings.reservePct ?? 0}
            disabled={settings.reserveFixed > 0}
            onChange={e => set("reservePct", parseInt(e.target.value))}
            style={{ width: "100%", accentColor: COLORS.gold, opacity: settings.reserveFixed > 0 ? 0.3 : 1, cursor: settings.reserveFixed > 0 ? "not-allowed" : "pointer" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
            <span>0%</span>
            <span style={{ color: settings.reserveFixed > 0 ? COLORS.muted : "inherit" }}>
              {settings.reserveFixed > 0 ? "% disabled — fixed $ active" : "50% of BP"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
            Fixed $ never shrinks as BP drops. Clear it to use % instead.
          </div>
        </div>

        <button onClick={async () => {
          setAlpacaTestMsg("Connecting...");
          try {
            const acc = await getAccount(settings);
            setAlpacaTestMsg(`✓ Connected — Portfolio: $${parseFloat(acc.equity).toFixed(2)}`);
          } catch (e) {
            setAlpacaTestMsg(`✗ ${e.message}`);
          }
        }} style={{
          padding: "6px 14px", background: "rgba(0,212,170,0.1)",
          border: `1px solid ${COLORS.accent}`, borderRadius: 6, color: COLORS.accent,
          fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
        }}>Test Connection</button>
        {alpacaTestMsg && (
          <div style={{ marginTop: 8, fontSize: 11, color: alpacaTestMsg.startsWith("✓") ? COLORS.green : COLORS.red }}>{alpacaTestMsg}</div>
        )}
      </div>

      {/* Auto-trade toggle */}
      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Auto-Trade on BUY signals</div>
          <div style={{ fontSize: 11, color: COLORS.muted }}>Place orders automatically during scans</div>
        </div>
        {toggle(settings.autoTradeEnabled, "autoTradeEnabled")}
      </div>

      {/* Bracket orders toggle */}
      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>Stop Loss & Take Profit</div>
          <div style={{ fontSize: 11, color: COLORS.muted }}>Attach AI-calculated SL/TP to every order</div>
        </div>
        {toggle(settings.bracketOrdersEnabled, "bracketOrdersEnabled")}
      </div>

      {/* Thresholds */}
      <div style={{ padding:"14px 0" }}>
        <div style={{ fontSize:12, fontWeight:700, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Alert Thresholds</div>

        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:12, color:COLORS.text, marginBottom:4 }}>Minimum Score: <span style={{ color:COLORS.accent, fontWeight:700 }}>{settings.minScore}</span></div>
          <input type="range" min={50} max={95} value={settings.minScore}
            onChange={e => set("minScore", parseInt(e.target.value))}
            style={{ width:"100%", accentColor:COLORS.accent }}
          />
        </div>

        <div>
          <div style={{ fontSize:12, color:COLORS.text, marginBottom:8 }}>Minimum Conviction</div>
          <div style={{ display:"flex", gap:8 }}>
            {["HIGH", "ANY"].map(v => (
              <button key={v} onClick={() => set("minConviction", v)} style={{
                padding:"5px 14px", borderRadius:16, fontSize:11, fontWeight:600, cursor:"pointer",
                border:`1px solid ${settings.minConviction === v ? COLORS.accent : COLORS.border}`,
                background: settings.minConviction === v ? "rgba(0,212,170,0.1)" : "transparent",
                color: settings.minConviction === v ? COLORS.accent : COLORS.muted,
              }}>{v === "HIGH" ? "HIGH only" : "HIGH + MED"}</button>
            ))}
          </div>
        </div>

        {/* Crypto-specific thresholds */}
        <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(0,212,170,0.04)", border: "1px solid rgba(0,212,170,0.15)", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🪙 Crypto Auto-Trade Thresholds</div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>Min Score (Crypto): <span style={{ color: COLORS.accent, fontWeight: 700 }}>{settings.cryptoMinScore ?? 80}</span></div>
            <input type="range" min={50} max={95} value={settings.cryptoMinScore ?? 80}
              onChange={e => set("cryptoMinScore", parseInt(e.target.value))}
              style={{ width: "100%", accentColor: COLORS.accent }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 8 }}>Min Conviction (Crypto)</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["HIGH", "ANY"].map(v => (
                <button key={v} onClick={() => set("cryptoMinConviction", v)} style={{
                  padding: "5px 14px", borderRadius: 16, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${(settings.cryptoMinConviction ?? "HIGH") === v ? COLORS.accent : COLORS.border}`,
                  background: (settings.cryptoMinConviction ?? "HIGH") === v ? "rgba(0,212,170,0.1)" : "transparent",
                  color: (settings.cryptoMinConviction ?? "HIGH") === v ? COLORS.accent : COLORS.muted,
                }}>{v === "HIGH" ? "HIGH only" : "HIGH + MED"}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>
              Fear & Greed Max Buy: <span style={{ color: COLORS.gold, fontWeight: 700 }}>{settings.cryptoFearGreedMaxBuy ?? 80}</span>
              <span style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>— block buys above this level</span>
            </div>
            <input type="range" min={60} max={100} value={settings.cryptoFearGreedMaxBuy ?? 80}
              onChange={e => set("cryptoFearGreedMaxBuy", parseInt(e.target.value))}
              style={{ width: "100%", accentColor: COLORS.gold }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
              <span>60 (Greed)</span><span>75 (High Greed)</span><span>90 (Extreme)</span><span>100</span>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>
              Crypto Capital: <span style={{ color: COLORS.accent, fontWeight: 700 }}>{settings.cryptoCapitalPct ?? 10}%</span>
              <span style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>of usable buying power</span>
            </div>
            <input type="range" min={0} max={50} step={5}
              value={settings.cryptoCapitalPct ?? 10}
              onChange={e => set("cryptoCapitalPct", parseInt(e.target.value))}
              style={{ width: "100%", accentColor: COLORS.accent }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
              <span>0% (none)</span><span>10% (default)</span><span>25%</span><span>50%</span>
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
              Dedicated bucket for crypto — rest goes to equities/ETFs.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>
              Trailing Stop (Crypto): <span style={{ color: COLORS.red, fontWeight: 700 }}>{settings.cryptoTrailingStopPct ?? 3}%</span>
              <span style={{ fontSize: 10, color: COLORS.muted, marginLeft: 6 }}>tighter than equity</span>
            </div>
            <input type="range" min={1} max={10} step={0.5}
              value={settings.cryptoTrailingStopPct ?? 3}
              onChange={e => set("cryptoTrailingStopPct", parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: COLORS.red }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.muted, marginTop: 2 }}>
              <span>1% (tight)</span><span>3% (default)</span><span>5%</span><span>10% (wide)</span>
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 4 }}>
              Separate from equity trailing stop — crypto volatility warrants a tighter trail.
            </div>
          </div>
        </div>

        {/* ── Account Reset ─────────────────────────────────── */}
        <div style={{ marginTop: 28, padding: "16px 20px", background: "rgba(255,77,109,0.05)", border: `1px solid rgba(255,77,109,0.2)`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.red, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            Account Reset
          </div>
          <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
            Clears local app data when switching to a new Alpaca account. Does not affect Alpaca itself.
          </div>

          {/* Options */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {[
              { key: "clearTrades",  label: "Clear trade history",          note: "Removes locally recorded trades" },
              { key: "clearHistory", label: "Clear scan history & results",  note: "Removes all scan runs and cached signals" },
            ].map(({ key, label, note }) => (
              <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={resetOpts[key]}
                  onChange={e => setResetOpts(o => ({ ...o, [key]: e.target.checked }))}
                  style={{ marginTop: 2, accentColor: COLORS.red }}
                />
                <span>
                  <span style={{ fontSize: 12, color: COLORS.text }}>{label}</span>
                  <span style={{ display: "block", fontSize: 10, color: COLORS.muted }}>{note}</span>
                </span>
              </label>
            ))}
          </div>

          {resetStatus === "confirm" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: COLORS.red, flex: 1 }}>This cannot be undone. Confirm?</span>
              <button onClick={async () => {
                try {
                  const res = await fetch("/api/db/reset-account", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(resetOpts),
                  });
                  if (!res.ok) throw new Error("Server error");
                  setResetStatus("done");
                  setTimeout(() => setResetStatus(null), 4000);
                } catch { setResetStatus("error"); }
              }} style={{ padding: "6px 14px", background: COLORS.red, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
                Yes, reset
              </button>
              <button onClick={() => setResetStatus(null)}
                style={{ padding: "6px 14px", background: "transparent", color: COLORS.muted, border: `1px solid ${COLORS.border}`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          ) : resetStatus === "done" ? (
            <div style={{ fontSize: 12, color: COLORS.green }}>Reset complete. Update your Alpaca keys and restart the daemon.</div>
          ) : resetStatus === "error" ? (
            <div style={{ fontSize: 12, color: COLORS.red }}>Reset failed — check console.</div>
          ) : (
            <button onClick={() => setResetStatus("confirm")}
              style={{ padding: "7px 18px", background: "rgba(255,77,109,0.12)", color: COLORS.red, border: `1px solid rgba(255,77,109,0.3)`, borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              Reset account data
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
