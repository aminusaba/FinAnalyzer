import { useState } from "react";
import { COLORS } from "../lib/universe.js";
import { sendTelegram } from "../lib/notifications.js";
import { getAccount } from "../lib/alpaca.js";

export function SettingsPanel({ settings, onChange, onClose }) {
  const set = (key, val) => onChange({ ...settings, [key]: val });
  const [alpacaTestMsg, setAlpacaTestMsg] = useState("");

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

      {/* Auto-scan frequency */}
      <div style={{ padding:"10px 0", borderBottom:`1px solid ${COLORS.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:COLORS.text }}>Auto-Scan</div>
            <div style={{ fontSize:11, color:COLORS.muted }}>Scan markets automatically</div>
          </div>
          {toggle(settings.autoScanEnabled, "autoScanEnabled")}
        </div>
        {settings.autoScanEnabled && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:11, color:COLORS.muted, marginBottom:8 }}>Scan every:</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[5, 10, 15, 30, 60, 120].map(mins => (
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

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 4 }}>Wallet Size (USD)</div>
          <input type="number" style={inputStyle} value={settings.walletSize || ""} onChange={e => set("walletSize", parseFloat(e.target.value) || 0)} placeholder="e.g. 10000" min={0} />
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
      </div>
    </div>
  );
}
