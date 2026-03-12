import { useState, useRef, useCallback, useEffect } from "react";
import { Radio, Settings, Sun, Moon, Activity, Clock, Briefcase, AlertTriangle, TrendingUp, TrendingDown, ExternalLink, Cpu, Wifi, WifiOff, Zap, Terminal } from "lucide-react";
import { COLORS } from "./lib/universe.js";
import { deepDiveSymbol } from "./lib/openai.js";
import { sendOrderFill } from "./lib/notifications.js";
import { Toast } from "./components/Toast.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag, AssetClassTag } from "./components/Badges.jsx";
import { DeepDivePanel } from "./components/DeepDivePanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { HistoryPanel, useHistory } from "./components/HistoryPanel.jsx";
import { loadScanResults, upsertScanResult, loadScanRuns, isDaemonActive, isDaemonAlive, getScanProgress } from "./lib/db.js";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { getSession, clearSession, getUserSettingsKey } from "./lib/auth.js";
import { PortfolioPanel } from "./components/PortfolioPanel.jsx";
import { DaemonLogPanel } from "./components/DaemonLogPanel.jsx";
import { MarketStatusBar } from "./components/MarketStatusBar.jsx";
import { TickerTape } from "./components/TickerTape.jsx";
import { placeOrder, closePosition, getPositions } from "./lib/trading.js";
import { initialize as mcpInit, reset as mcpReset } from "./lib/mcp-client.js";
import { openChartWindow } from "./lib/chart-window.js";
import { applyTheme, getTheme, THEMES } from "./lib/theme.js";

const DEFAULT_SETTINGS = {
  browserEnabled: true,
  telegramEnabled: false,
  telegramChatId: "",
  minScore: 75,
  minConviction: "HIGH",
  autoScanEnabled: false,
  autoScanInterval: 30,
  alpacaKey: "",
  alpacaSecret: "",
  alpacaMode: "paper",
  autoTradeEnabled: false,
  bracketOrdersEnabled: true,
  tradingCapitalPct: 100,  // % of buying power to allocate for auto-trading (1–100)
  reservePct: 0,           // % of buying power always kept untouched (applied before capital %)
  mcpUrl: "http://localhost:8000",
  mcpEnabled: true,
  aiModel: "o4-mini",
};

const CATEGORIES = ["All", "Equity", "ETF", "Crypto", "Forex", "Commodity", "Europe", "Asia"];

export default function App() {
  const [session, setSession] = useState(() => getSession());

  const handleAuth = (s) => setSession(s);
  const handleLogout = () => { clearSession(); setSession(null); };

  if (!session) return <LoginScreen onAuth={handleAuth} />;
  return <AppInner session={session} onLogout={handleLogout} />;
}

function AppInner({ session, onLogout }) {
  const [results, setResults] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [deepDive, setDeepDive] = useState(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const deepDiveCacheRef = useRef(new Map()); // symbol → { data, ts }
  const [sortBy, setSortBy] = useState("score");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterSignal, setFilterSignal] = useState("All");
  const [showSettings, setShowSettings] = useState(false);
  const [notifSettings, setNotifSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(getUserSettingsKey(session.key));
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });
  const [activeTab, setActiveTab] = useState("scan"); // "scan" | "history" | "portfolio" | "logs"
  const [history, setHistory]   = useState([]);
  const [trades, setTrades]     = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError]     = useState(null);
  const { fetchHistory, fetchTrades } = useHistory(session.key);
  const [mcpStatus, setMcpStatus] = useState("disconnected"); // "disconnected" | "connecting" | "connected"
  const [buyingPower, setBuyingPower] = useState(null); // updated after each account fetch
  const [lastScanTime, setLastScanTime] = useState(null);
  const [daemonActive, setDaemonActive] = useState(false);
  const [scanProgress, setScanProgressState] = useState(null);
  const [heldSymbols, setHeldSymbols] = useState(new Set());
  const [theme, setTheme] = useState(() => getTheme());

  const [showThemePicker, setShowThemePicker] = useState(false);
  const switchTheme = (id) => { applyTheme(id); setTheme(id); setShowThemePicker(false); };
  useEffect(() => {
    if (!showThemePicker) return;
    const close = () => setShowThemePicker(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showThemePicker]);

  // Load persisted results + last scan time + daemon status on mount
  // Also pull daemon-config.json so UI stays in sync with daemon settings
  useEffect(() => {
    loadScanResults(session.key)
      .then(rows => { if (rows.length) setResults(rows); })
      .catch(() => {});
    loadScanRuns(session.key, 1)
      .then(runs => { if (runs[0]) setLastScanTime(new Date(runs[0].timestamp)); })
      .catch(() => {});
    isDaemonAlive().then(setDaemonActive).catch(() => {});
    // Sync settings from daemon-config.json → UI (daemon is source of truth for interval etc.)
    fetch('/api/sync-daemon-config')
      .then(r => r.ok ? r.json() : null)
      .then(daemonSettings => {
        if (daemonSettings && Object.keys(daemonSettings).length > 0) {
          setNotifSettings(prev => {
            const merged = { ...prev, ...daemonSettings };
            try { localStorage.setItem(getUserSettingsKey(session.key), JSON.stringify(merged)); } catch {}
            return merged;
          });
        }
      })
      .catch(() => {});
  }, []);
  const toastId = useRef(0);

  const settingsKey = getUserSettingsKey(session.key);

  const updateSettings = (newSettings) => {
    setNotifSettings(newSettings);
    try { localStorage.setItem(settingsKey, JSON.stringify(newSettings)); } catch {}
    // Sync to daemon-config.json via Vite dev server so background daemon stays in sync
    fetch('/api/sync-daemon-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    }).catch(() => {}); // fire and forget — daemon sync is best-effort
  };

  // MCP auto-connect
  useEffect(() => {
    if (!notifSettings.mcpEnabled) { mcpReset(); setMcpStatus("disconnected"); return; }
    setMcpStatus("connecting");
    mcpInit(notifSettings.mcpUrl)
      .then(() => setMcpStatus("connected"))
      .catch(() => setMcpStatus("disconnected"));
  }, [notifSettings.mcpEnabled, notifSettings.mcpUrl]);

  // Fetch scan history + trades when history tab is opened
  useEffect(() => {
    if (activeTab !== "history") return;
    setHistoryLoading(true);
    setHistoryError(null);
    Promise.all([fetchHistory(), fetchTrades()])
      .then(([runs, tradeList]) => {
        setHistory(Array.isArray(runs) ? runs : []);
        setTrades(Array.isArray(tradeList) ? tradeList : []);
      })
      .catch(e => setHistoryError(e.message))
      .finally(() => setHistoryLoading(false));
  }, [activeTab]);

  // Auto-scan is daemon-only — browser never auto-scans

  // Held positions — refreshed every 30s independently of scan polling
  // Never clears on failure so the badge doesn't flicker during fast scan polls
  useEffect(() => {
    const normalizeSymbol = s => s.length > 3 && !s.includes("/") && s.endsWith("USD")
      ? s.slice(0, -3) + "/USD" : s;

    const refresh = () => {
      if (!notifSettings.alpacaKey || !notifSettings.alpacaSecret) return;
      getPositions(notifSettings)
        .then(pos => {
          if (Array.isArray(pos) && pos.length >= 0)
            setHeldSymbols(new Set(pos.map(p => normalizeSymbol(p.symbol))));
        })
        .catch(() => {}); // keep last known Set on error
    };

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [notifSettings.alpacaKey, notifSettings.alpacaSecret]);

  // Adaptive polling — 3s while daemon is scanning, 60s while idle
  useEffect(() => {
    let timerId;
    const poll = async () => {
      let prog = null;
      try { prog = await getScanProgress(); setScanProgressState(prog); } catch {}

      try {
        const rows = await loadScanResults(session.key);
        if (rows.length) setResults(rows);
      } catch {}

      if (prog?.status !== 'scanning') {
        try {
          const runs = await loadScanRuns(session.key, 1);
          if (runs[0]) setLastScanTime(new Date(runs[0].timestamp));
        } catch {}
      }

      isDaemonAlive().then(setDaemonActive).catch(() => {});

      timerId = setTimeout(poll, prog?.status === 'scanning' ? 3_000 : 60_000);
    };
    poll();
    return () => clearTimeout(timerId);
  }, []);

  const addToast = useCallback((msg, type = "insight") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000);
  }, []);

  const removeToast = id => setToasts(t => t.filter(x => x.id !== id));


  const DEEP_DIVE_TTL = 15 * 60 * 1000; // 15-min cache — saves GPT cost on repeated clicks
  const openDeepDive = async (sym) => {
    setSelected(sym);
    const cached = deepDiveCacheRef.current.get(sym.symbol);
    if (cached && Date.now() - cached.ts < DEEP_DIVE_TTL && !cached.error) {
      setDeepDive(cached.data);
      setDeepLoading(false);
      return;
    }
    setDeepDive(null);
    setDeepLoading(true);
    try {
      const d = await deepDiveSymbol(sym, notifSettings.aiModel);
      deepDiveCacheRef.current.set(sym.symbol, { data: d, ts: Date.now() });
      setDeepDive(d);
    } catch (e) {
      setDeepDive({ error: e.message });
    }
    setDeepLoading(false);
  };

  const convictionOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const filtered = results
    .filter(r => filterCategory === "All" || r.assetClass === filterCategory)
    .filter(r => filterSignal === "All" || r.signal === filterSignal)
    .sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "rr") return b.risk_reward - a.risk_reward;
      if (sortBy === "momentum") return b.momentum - a.momentum;
      if (sortBy === "conviction") return (convictionOrder[a.conviction] ?? 2) - (convictionOrder[b.conviction] ?? 2);
      if (sortBy === "held") return (heldSymbols.has(b.symbol) ? 1 : 0) - (heldSymbols.has(a.symbol) ? 1 : 0);
      return 0;
    });

  const topPicks = results.filter(r => r.signal === "BUY" && r.conviction === "HIGH").sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <div style={{ minHeight:"100vh", background:COLORS.bg, fontFamily:"'Inter',sans-serif", color:COLORS.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        @keyframes slideIn { from { transform:translateX(40px);opacity:0 } to { transform:translateX(0);opacity:1 } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes glow { 0%,100%{box-shadow:0 0 8px rgba(0,212,170,0.4)} 50%{box-shadow:0 0 20px rgba(0,212,170,0.8)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box; margin:0; padding:0 }
        body { background: var(--c-bg) }
        ::-webkit-scrollbar { width:4px }
        ::-webkit-scrollbar-track { background:transparent }
        ::-webkit-scrollbar-thumb { background:linear-gradient(180deg,#00d4aa44,#00b4d844); border-radius:4px }
        ::-webkit-scrollbar-thumb:hover { background:linear-gradient(180deg,#00d4aa88,#00b4d888) }
        input[type=range] { accent-color:#00d4aa }
        input,button { font-family:inherit }
        .row-animate { animation: fadeIn 0.3s ease both }
      `}</style>

      <Toast toasts={toasts} remove={removeToast} />
      {showSettings && <SettingsPanel settings={notifSettings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <div style={{
        background: COLORS.headerGrad,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, height: 58,
        boxShadow: "0 4px 32px rgba(0,0,0,0.6)",
      }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 16px rgba(0,212,170,0.4)",
          }}><Radio size={16} color="#000" /></div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, background: "linear-gradient(135deg, #00d4aa, #00b4d8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              FinAnalyzer
            </div>
            <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 1, textTransform: "uppercase" }}>Global Market Intelligence</div>
          </div>
        </div>

        {/* Center status */}
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          {/* MCP status */}
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{
              width:7, height:7, borderRadius:"50%",
              background: mcpStatus === "connected" ? COLORS.green : mcpStatus === "connecting" ? COLORS.gold : COLORS.border,
              boxShadow: mcpStatus === "connected" ? `0 0 6px ${COLORS.green}` : "none",
              animation: mcpStatus === "connecting" ? "pulse 1s infinite" : "none",
            }} />
            <span style={{ fontSize:10, color: mcpStatus === "connected" ? COLORS.green : COLORS.muted, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>
              {mcpStatus === "connected" ? <Wifi size={11} /> : <WifiOff size={11} />}
              MCP {mcpStatus === "connected" ? "Connected" : mcpStatus === "connecting" ? "Connecting..." : "Off"}
            </span>
          </div>
          {results.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:COLORS.accent }} />
              <span style={{ color:COLORS.muted, fontSize:11 }}>{results.length} assets analyzed</span>
            </div>
          )}
          {daemonActive && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ background:"rgba(240,180,41,0.08)", border:"1px solid rgba(240,180,41,0.2)", borderRadius:20, padding:"4px 12px", display:"flex", alignItems:"center", gap:6 }}>
                <Cpu size={12} color={COLORS.gold} style={{ animation:"pulse 1s infinite" }} />
                <span style={{ color:COLORS.gold, fontSize:11, fontWeight:600 }}>
                  {scanProgress?.status === 'scanning'
                    ? `Scanning ${scanProgress.current_sym ?? '…'} [${scanProgress.scanned_count}/${scanProgress.total_count}]`
                    : 'Daemon active'}
                </span>
              </div>
              {scanProgress?.status === 'scanning' && scanProgress.total_count > 0 && (
                <div style={{ width:80, height:3, background:COLORS.border, borderRadius:2, overflow:'hidden' }}>
                  <div style={{
                    height:'100%', borderRadius:2, background:COLORS.gold,
                    width:`${Math.round((scanProgress.scanned_count / scanProgress.total_count) * 100)}%`,
                    transition:'width 0.5s ease',
                  }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {/* User badge */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:4 }}>
            <div style={{
              width:28, height:28, borderRadius:"50%",
              background:"linear-gradient(135deg,#00d4aa,#00b4d8)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:12, fontWeight:800, color:"#000",
            }}>
              {session.username[0].toUpperCase()}
            </div>
            <span style={{ fontSize:12, color:COLORS.muted, fontWeight:500 }}>{session.username}</span>
            <button onClick={onLogout} style={{
              padding:"4px 10px", borderRadius:12, border:`1px solid ${COLORS.border}`,
              background:"transparent", color:COLORS.muted, fontSize:10,
              cursor:"pointer", fontWeight:600, fontFamily:"inherit",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=COLORS.red; e.currentTarget.style.color=COLORS.red; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=COLORS.border; e.currentTarget.style.color=COLORS.muted; }}
            >Sign out</button>
          </div>
          {/* Theme picker */}
          <div style={{ position: "relative" }}>
            <button onClick={e => { e.stopPropagation(); setShowThemePicker(s => !s); }} title="Switch theme" style={{
              width: 34, height: 34, cursor: "pointer", fontSize: 16,
              background: COLORS.overlay, border: `1px solid ${COLORS.border}`,
              borderRadius: 20, color: COLORS.muted, transition: "all 0.2s",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.accent; e.currentTarget.style.color = COLORS.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.muted; }}
            >{THEMES[theme]?.dark === false ? <Sun size={15} /> : <Moon size={15} />}</button>
            {showThemePicker && (
              <div style={{
                position: "absolute", right: 0, top: 42, zIndex: 200,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: 10, padding: 6, minWidth: 170,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}>
                {Object.entries(THEMES).map(([id, t]) => (
                  <button key={id} onClick={() => switchTheme(id)} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "7px 10px", border: "none", cursor: "pointer",
                    background: theme === id ? `${COLORS.accent}18` : "transparent",
                    borderRadius: 6, color: theme === id ? COLORS.accent : COLORS.text,
                    fontSize: 12, fontWeight: theme === id ? 700 : 400, textAlign: "left",
                  }}>
                    <span style={{ fontSize: 10 }}>{t.dark === false ? "☀️" : "🌙"}</span>
                    {t.label}
                    {theme === id && <span style={{ marginLeft: "auto", fontSize: 10 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setShowSettings(s => !s)} style={{
            padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: COLORS.overlay, border: `1px solid ${COLORS.border}`,
            borderRadius: 20, color: COLORS.muted, transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.accent; e.currentTarget.style.color = COLORS.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.muted; }}
          ><Settings size={13} style={{ marginRight:5, verticalAlign:"middle" }} />Settings</button>
        </div>
      </div>

      <TickerTape results={results} settings={notifSettings} />

      {/* Tab bar */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "0 28px", display: "flex", gap: 2 }}>
        {[["scan", <><Activity size={12} style={{marginRight:5,verticalAlign:"middle"}}/>Signals</>], ["history", <><Clock size={12} style={{marginRight:5,verticalAlign:"middle"}}/>History</>], ["portfolio", <><Briefcase size={12} style={{marginRight:5,verticalAlign:"middle"}}/>Portfolio</>], ["logs", <><Terminal size={12} style={{marginRight:5,verticalAlign:"middle"}}/>Daemon Log</>]].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "12px 20px", background: "none", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
            color: activeTab === tab ? COLORS.accent : COLORS.muted,
            borderBottom: `2px solid ${activeTab === tab ? COLORS.accent : "transparent"}`,
            transition: "all 0.2s",
          }}>{label}</button>
        ))}
      </div>

      <MarketStatusBar settings={notifSettings} />

      {activeTab === "logs" ? (
        <div style={{ height:"calc(100vh - 144px)" }}>
          <DaemonLogPanel />
        </div>
      ) : null}

      <div style={{ display: activeTab === "logs" ? "none" : "grid", gridTemplateColumns: activeTab === "scan" ? "1fr 390px" : "1fr", height:"calc(100vh - 144px)" }}>

        {/* Left panel */}
        <div style={{ overflowY:"auto", padding:20 }}>
        {activeTab === "history" ? (
          <HistoryPanel history={history} trades={trades} loading={historyLoading} error={historyError} settings={notifSettings} />
        ) : activeTab === "portfolio" ? (
          <PortfolioPanel settings={notifSettings} mcpStatus={mcpStatus} />
        ) : (<>

          {/* Top picks */}
          {topPicks.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, fontWeight:700, color:COLORS.gold, textTransform:"uppercase", letterSpacing:1.5, marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ display:"inline-block", width:3, height:12, background:"linear-gradient(180deg,#f0b429,#f97316)", borderRadius:2 }}/>
                High Conviction Buys
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
                {topPicks.map(r => (
                  <div key={r.symbol} onClick={() => openDeepDive(r)} style={{
                    background: COLORS.cardGrad,
                    border: "1px solid rgba(0,212,170,0.2)",
                    borderRadius: 12, padding: 14, cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                    transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.5)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,212,170,0.15)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)"; }}
                  >
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ fontWeight:900, fontSize:14, color:COLORS.accent, letterSpacing:-0.3 }}>{r.symbol}</div>
                      <span
                        onClick={e => { e.stopPropagation(); openChartWindow(r.symbol, { assetClass: r.assetClass, entry: r.entry, stop: r.stop, target: r.target, price: r.price }); }}
                        title="Open chart"
                        style={{ fontSize:12, color:COLORS.muted, cursor:"pointer" }}
                        onMouseEnter={e => e.currentTarget.style.color = COLORS.accent}
                        onMouseLeave={e => e.currentTarget.style.color = COLORS.muted}
                      ><ExternalLink size={11} /></span>
                    </div>
                    <div style={{ fontSize:9, color:COLORS.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>{r.assetClass}</div>
                    <ScoreBadge score={r.score} />
                    <div style={{ marginTop:6 }}><Sparkline data={r.prices} /></div>
                    <div style={{ fontSize:10, color:COLORS.gold, marginTop:6, fontWeight:600 }}>R/R {r.risk_reward}x · {r.allocation_pct}%</div>
                    <div style={{ marginTop:4 }}><HorizonTag horizon={r.horizon} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last scan timestamp */}
          {lastScanTime && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background: COLORS.accent }} />
              <span style={{ fontSize:10, color: COLORS.muted }}>
                Last scan:{" "}
                <span style={{ color: COLORS.text, fontWeight:600 }}>
                  {lastScanTime.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
                </span>
                <span style={{ color:COLORS.muted, marginLeft:6 }}>· {results.length} symbols</span>
              </span>
            </div>
          )}

          {/* Filters */}
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setFilterCategory(c)} style={{
                  padding:"4px 10px", borderRadius:14, border:`1px solid ${filterCategory === c ? COLORS.accent : COLORS.border}`,
                  background: filterCategory === c ? "rgba(0,212,170,0.1)" : "transparent",
                  color: filterCategory === c ? COLORS.accent : COLORS.muted, fontSize:10, cursor:"pointer", fontWeight:600,
                }}>{c}</button>
              ))}
            </div>
            <div style={{ width:1, height:18, background:COLORS.border }} />
            {["All","BUY","WATCH","HOLD","SELL"].map(s => (
              <button key={s} onClick={() => setFilterSignal(s)} style={{
                padding:"4px 10px", borderRadius:14, border:`1px solid ${filterSignal === s ? COLORS.accent : COLORS.border}`,
                background: filterSignal === s ? "rgba(0,212,170,0.1)" : "transparent",
                color: filterSignal === s ? COLORS.accent : COLORS.muted, fontSize:10, cursor:"pointer", fontWeight:600,
              }}>{s}</button>
            ))}
            <div style={{ marginLeft:"auto", display:"flex", gap:5, alignItems:"center" }}>
              <span style={{ color:COLORS.muted, fontSize:10 }}>Sort:</span>
              {[["score","Score"],["conviction","Conviction"],["rr","R/R"],["momentum","Mom"],["held","Held"]].map(([k, l]) => (
                <button key={k} onClick={() => setSortBy(k)} style={{
                  padding:"4px 8px", borderRadius:12, border:`1px solid ${sortBy === k ? COLORS.accent : COLORS.border}`,
                  background: sortBy === k ? "rgba(0,212,170,0.1)" : "transparent",
                  color: sortBy === k ? COLORS.accent : COLORS.muted, fontSize:10, cursor:"pointer",
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Results table */}
          {filtered.length === 0 ? (
            <div style={{
              background: COLORS.cardGrad,
              border: `1px solid ${COLORS.border}`, borderRadius: 14,
              padding: 60, textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}>
              <div style={{ marginBottom: 16, opacity: 0.3, display:"flex", justifyContent:"center" }}><Radio size={48} color={COLORS.muted} /></div>
              <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.muted, marginBottom: 8 }}>No results yet.</div>
              <div style={{ fontSize: 12, color: COLORS.muted }}>Waiting for the daemon to scan markets. Check daemon-config.json to configure the scan schedule.</div>
            </div>
          ) : (
            <div style={{
              background: COLORS.cardGrad,
              border: `1px solid ${COLORS.border}`, borderRadius: 14,
              overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}>
              {/* Table header */}
              <div style={{ display:"grid", gridTemplateColumns:"44px 80px 70px 90px 74px 60px 70px 60px 70px 1fr", padding:"10px 16px", borderBottom:`1px solid ${COLORS.border}`, fontSize:9, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1.2, fontWeight:700, background:COLORS.overlay }}>
                <div/><div>Symbol</div><div>Class</div><div>Price</div><div>Signal</div><div>Score</div><div>Conv.</div><div>R/R</div><div>Horizon</div><div>Thesis</div>
              </div>
              {filtered.map((r, idx) => {
                const isSelected = selected?.symbol === r.symbol;
                const isHeld = heldSymbols.has(r.symbol);
                return (
                  <div key={r.symbol + r.market} className="row-animate" onClick={() => openDeepDive(r)}
                    style={{
                      display:"grid", gridTemplateColumns:"44px 80px 70px 90px 74px 60px 70px 60px 70px 1fr",
                      padding:"12px 16px", borderBottom:`1px solid ${COLORS.border}`,
                      cursor:"pointer", transition:"background 0.15s",
                      background: isSelected
                        ? "linear-gradient(90deg, rgba(0,212,170,0.07), transparent)"
                        : idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                      animationDelay: `${idx * 0.04}s`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = isSelected ? "linear-gradient(90deg, rgba(0,212,170,0.1), transparent)" : "rgba(255,255,255,0.04)"}
                    onMouseLeave={e => e.currentTarget.style.background = isSelected ? "linear-gradient(90deg, rgba(0,212,170,0.07), transparent)" : idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"}>
                    <div style={{ display:"flex", alignItems:"center" }}><ScoreBadge score={r.score} /></div>
                    <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontWeight:800, fontSize:13, color: isSelected ? COLORS.accent : COLORS.text, letterSpacing:-0.2 }}>{r.symbol}</span>
                        <span
                          onClick={e => { e.stopPropagation(); openChartWindow(r.symbol, { assetClass: r.assetClass, entry: r.entry, stop: r.stop, target: r.target, price: r.price }); }}
                          title="Open chart"
                          style={{ color:COLORS.muted, cursor:"pointer", lineHeight:1, display:"flex" }}
                          onMouseEnter={e => e.currentTarget.style.color = COLORS.accent}
                          onMouseLeave={e => e.currentTarget.style.color = COLORS.muted}
                        ><ExternalLink size={10} /></span>
                      </div>
                      {isHeld && (
                        <span title="Position held" style={{ fontSize:9, fontWeight:700, color:"#1a1a2e", background:COLORS.accent, borderRadius:3, padding:"1px 4px", lineHeight:1.4, letterSpacing:0.3, alignSelf:"flex-start" }}>HELD</span>
                      )}
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}><AssetClassTag assetClass={r.assetClass} /></div>
                    <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{r.assetClass === "Forex" ? r.price?.toFixed(4) : `$${r.price?.toFixed(2)}`}</div>
                      <div style={{ fontSize:10, fontWeight:600, color: r.change_pct >= 0 ? COLORS.green : COLORS.red, display:"flex", alignItems:"center", gap:2 }}>{r.change_pct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {Math.abs(r.change_pct)?.toFixed(2)}%</div>
                      <Sparkline data={r.prices} />
                    </div>
                    <div style={{ display:"flex", alignItems:"center" }}><SignalBadge signal={r.signal} /></div>
                    <div style={{ display:"flex", alignItems:"center", fontSize:14, fontWeight:800, color: r.score >= 75 ? COLORS.green : r.score >= 50 ? COLORS.gold : COLORS.red }}>{r.score}</div>
                    <div style={{ display:"flex", alignItems:"center" }}><ConvictionBadge conviction={r.conviction} /></div>
                    <div style={{ display:"flex", alignItems:"center", fontSize:12, fontWeight:700, color:COLORS.gold }}>{r.risk_reward}x</div>
                    <div style={{ display:"flex", alignItems:"center" }}><HorizonTag horizon={r.horizon} /></div>
                    <div style={{ display:"flex", alignItems:"center", fontSize:11, color:"#6060a0", paddingLeft:8, lineHeight:1.5 }}>{r.investor_thesis?.slice(0, 65)}…</div>
                  </div>
                );
              })}
            </div>
          )}

        </>)}
        </div>

        {/* Deep dive panel — scan tab only */}
        {activeTab === "scan" && <div style={{ background:COLORS.surfaceGrad, borderLeft:`1px solid ${COLORS.border}`, overflowY:"auto", padding:20 }}>
          <DeepDivePanel
            selected={selected}
            deepDive={deepDive}
            deepLoading={deepLoading}
            settings={notifSettings}
            buyingPower={buyingPower}
            onBuy={async (sym, notional, useBracket) => {
              const opts = useBracket && sym.stop && sym.target && !sym._bracketInvalid
                ? { stopPrice: sym.stop, takeProfitPrice: sym.target, price: sym.price }
                : { price: sym.price };
              await placeOrder(sym.symbol, "buy", notional, { ...notifSettings, _assetClass: sym.assetClass }, opts);
              await sendOrderFill(notifSettings, { symbol: sym.symbol, side: "buy", notional, stop: sym.stop, target: sym.target, bracket: !!opts.stopPrice });
              addToast(`🛒 Bought ${sym.symbol} · $${notional.toFixed(0)}`, "insight");
            }}
            onSell={async (sym) => {
              await closePosition(sym.symbol, notifSettings);
              await sendOrderFill(notifSettings, { symbol: sym.symbol, side: "sell", notional: 0 });
              addToast(`📤 Closed position in ${sym.symbol}`, "insight");
            }}
          />
        </div>}
      </div>

      <div style={{ position:"fixed", bottom:14, left:"50%", transform:"translateX(-50%)", color:COLORS.muted, fontSize:10, background:COLORS.surface, padding:"4px 16px", borderRadius:20, border:`1px solid ${COLORS.border}`, zIndex:99, backdropFilter:"blur(8px)", letterSpacing:0.5, display:"flex", alignItems:"center", gap:5 }}>
        <AlertTriangle size={10} /> AI-generated analysis only — not financial advice
      </div>
    </div>
  );
}
