import { useState, useRef, useCallback, useEffect } from "react";
import { COLORS } from "./lib/universe.js";
import { fetchTopMovers } from "./lib/finnhub.js";
import { analyzeSymbol, deepDiveSymbol } from "./lib/openai.js";
import { sendAlerts } from "./lib/notifications.js";
import { Toast } from "./components/Toast.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag, AssetClassTag } from "./components/Badges.jsx";
import { DeepDivePanel } from "./components/DeepDivePanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { HistoryPanel, useHistory } from "./components/HistoryPanel.jsx";

const DEFAULT_SETTINGS = {
  browserEnabled: true,
  telegramEnabled: false,
  telegramChatId: "",
  minScore: 75,
  minConviction: "HIGH",
  autoScanEnabled: false,
  autoScanInterval: 30, // minutes
};

const SCAN_INTERVALS = [5, 10, 15, 30, 60, 120];

const CATEGORIES = ["All", "Equity", "ETF", "Crypto", "Forex", "Commodity", "Europe", "Asia"];

export default function App() {
  const [results, setResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [toasts, setToasts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [deepDive, setDeepDive] = useState(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [sortBy, setSortBy] = useState("score");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterSignal, setFilterSignal] = useState("All");
  const [showSettings, setShowSettings] = useState(false);
  const [notifSettings, setNotifSettings] = useState(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState("scan"); // "scan" | "history"
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const { fetchHistory } = useHistory();
  const [nextScanIn, setNextScanIn] = useState(null); // seconds until next auto-scan
  const abortRef = useRef(false);
  const toastId = useRef(0);
  const autoScanTimer = useRef(null);
  const countdownTimer = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem("finanalyzer_notif");
    if (saved) setNotifSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
  }, []);

  useEffect(() => {
    localStorage.setItem("finanalyzer_notif", JSON.stringify(notifSettings));
  }, [notifSettings]);

  // Fetch history when tab is opened
  useEffect(() => {
    if (activeTab !== "history") return;
    setHistoryLoading(true);
    setHistoryError(null);
    fetchHistory()
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(e => setHistoryError(e.message))
      .finally(() => setHistoryLoading(false));
  }, [activeTab]);

  // Auto-scan scheduler
  useEffect(() => {
    clearInterval(autoScanTimer.current);
    clearInterval(countdownTimer.current);
    setNextScanIn(null);

    if (!notifSettings.autoScanEnabled) return;

    const intervalMs = notifSettings.autoScanInterval * 60 * 1000;

    const scheduleNext = () => {
      let secondsLeft = notifSettings.autoScanInterval * 60;
      setNextScanIn(secondsLeft);
      countdownTimer.current = setInterval(() => {
        secondsLeft -= 1;
        setNextScanIn(secondsLeft);
      }, 1000);

      autoScanTimer.current = setTimeout(() => {
        clearInterval(countdownTimer.current);
        startScan();
        scheduleNext();
      }, intervalMs);
    };

    scheduleNext();

    return () => {
      clearTimeout(autoScanTimer.current);
      clearInterval(countdownTimer.current);
    };
  }, [notifSettings.autoScanEnabled, notifSettings.autoScanInterval]);

  const addToast = useCallback((msg, type = "insight") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000);
  }, []);

  const removeToast = id => setToasts(t => t.filter(x => x.id !== id));

  const startScan = async () => {
    if (notifSettings.browserEnabled && Notification.permission !== "granted") {
      await Notification.requestPermission();
    }
    abortRef.current = false;
    setScanning(true);
    setProgress(0);
    setResults([]);

    setProgressLabel("Fetching live market data...");
    let symbols = [];
    try {
      symbols = await fetchTopMovers();
    } catch (e) {
      setProgressLabel(`Feed error: ${e.message}`);
      setScanning(false);
      return;
    }

    if (!symbols.length) {
      setProgressLabel("No symbols returned. Check your Finnhub key.");
      setScanning(false);
      return;
    }

    for (let i = 0; i < symbols.length; i++) {
      if (abortRef.current) break;
      const sym = symbols[i];
      setProgressLabel(`Analyzing ${sym.symbol}...`);
      try {
        const r = await analyzeSymbol(sym);
        setResults(prev => [...prev, r]);
        await sendAlerts(r, notifSettings);
        if (r.signal === "BUY" && r.score >= notifSettings.minScore) {
          addToast(`${r.symbol} [${r.assetClass}] — Score ${r.score} | ${r.conviction} conviction | ${r.investor_thesis?.slice(0, 80)}`, "alert");
        }
      } catch (e) {
        console.error(sym.symbol, e.message);
      }
      setProgress(Math.round(((i + 1) / symbols.length) * 100));
      await new Promise(r => setTimeout(r, 200));
    }
    setProgressLabel("Scan complete");
    setScanning(false);
  };

  const stopScan = () => { abortRef.current = true; setScanning(false); setProgressLabel("Stopped"); };

  const openDeepDive = async (sym) => {
    setSelected(sym);
    setDeepDive(null);
    setDeepLoading(true);
    try {
      const d = await deepDiveSymbol(sym);
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
      return 0;
    });

  const topPicks = results.filter(r => r.signal === "BUY" && r.conviction === "HIGH").sort((a, b) => b.score - a.score).slice(0, 5);

  return (
    <div style={{ minHeight:"100vh", background:COLORS.bg, fontFamily:"'Inter',sans-serif", color:COLORS.text }}>
      <style>{`
        @keyframes slideIn { from { transform:translateX(40px); opacity:0 } to { transform:translateX(0); opacity:1 } }
        * { box-sizing:border-box }
        ::-webkit-scrollbar { width:5px }
        ::-webkit-scrollbar-track { background:#12121a }
        ::-webkit-scrollbar-thumb { background:#2a2a40; border-radius:3px }
        input[type=range] { accent-color: #00d4aa }
      `}</style>

      <Toast toasts={toasts} remove={removeToast} />
      {showSettings && <SettingsPanel settings={notifSettings} onChange={setNotifSettings} onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <div style={{ background:COLORS.surface, borderBottom:`1px solid ${COLORS.border}`, padding:"13px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ fontWeight:800, fontSize:17, color:COLORS.accent }}>📡 FinAnalyzer — Global Market Intelligence</div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {scanning && (
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:140, height:4, background:COLORS.border, borderRadius:2 }}>
                <div style={{ width:`${progress}%`, height:"100%", background:COLORS.accent, borderRadius:2, transition:"width 0.3s" }} />
              </div>
              <span style={{ color:COLORS.gold, fontSize:12 }}>{progress}% — {progressLabel}</span>
            </div>
          )}
          {!scanning && results.length > 0 && <span style={{ color:COLORS.muted, fontSize:12 }}>{results.length} assets analyzed</span>}
          {!scanning && nextScanIn !== null && (
            <span style={{ color:COLORS.gold, fontSize:12 }}>
              ⏱ Next scan in {Math.floor(nextScanIn / 60)}:{String(nextScanIn % 60).padStart(2, "0")}
            </span>
          )}
          <button onClick={() => setShowSettings(s => !s)} style={{ padding:"7px 14px", background:"transparent", border:`1px solid ${COLORS.border}`, borderRadius:20, color:COLORS.muted, fontSize:12, cursor:"pointer" }}>
            ⚙ Alerts
          </button>
          {!scanning
            ? <button onClick={startScan} style={{ padding:"8px 20px", background:COLORS.accent, color:"#000", border:"none", borderRadius:20, fontWeight:700, fontSize:13, cursor:"pointer" }}>▶ Scan Markets</button>
            : <button onClick={stopScan} style={{ padding:"8px 20px", background:COLORS.red, color:"#fff", border:"none", borderRadius:20, fontWeight:700, fontSize:13, cursor:"pointer" }}>■ Stop</button>
          }
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "0 24px", display: "flex", gap: 4 }}>
        {[["scan", "📡 Live Scan"], ["history", "🕓 History"]].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "10px 18px", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
            color: activeTab === tab ? COLORS.accent : COLORS.muted,
            borderBottom: `2px solid ${activeTab === tab ? COLORS.accent : "transparent"}`,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 390px", height:"calc(100vh - 90px)" }}>

        {/* Left panel */}
        <div style={{ overflowY:"auto", padding:20 }}>
        {activeTab === "history" ? (
          <HistoryPanel history={history} loading={historyLoading} error={historyError} />
        ) : (<>

          {/* Top picks */}
          {topPicks.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, fontWeight:700, color:COLORS.gold, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>🔥 High Conviction Buys</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
                {topPicks.map(r => (
                  <div key={r.symbol} onClick={() => openDeepDive(r)} style={{ background:COLORS.card, border:`1px solid rgba(0,212,170,0.25)`, borderRadius:10, padding:12, cursor:"pointer" }}>
                    <div style={{ fontWeight:800, fontSize:14, color:COLORS.accent }}>{r.symbol}</div>
                    <div style={{ fontSize:10, color:COLORS.muted, marginBottom:4 }}>{r.assetClass}</div>
                    <ScoreBadge score={r.score} />
                    <Sparkline data={r.prices} />
                    <div style={{ fontSize:10, color:COLORS.gold, marginTop:4 }}>R/R {r.risk_reward}x · {r.allocation_pct}%</div>
                    <HorizonTag horizon={r.horizon} />
                  </div>
                ))}
              </div>
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
              {[["score","Score"],["conviction","Conviction"],["rr","R/R"],["momentum","Mom"]].map(([k, l]) => (
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
            <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:60, textAlign:"center", color:COLORS.muted }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📡</div>
              <div style={{ fontSize:15, marginBottom:6 }}>{scanning ? `Scanning... ${progressLabel}` : "No results yet."}</div>
              <div style={{ fontSize:13 }}>{!scanning && "Hit \"Scan Markets\" to analyze top movers across US, Europe, Asia, Crypto, Forex & Commodities."}</div>
            </div>
          ) : (
            <div style={{ background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:12, overflow:"hidden" }}>
              <div style={{ display:"grid", gridTemplateColumns:"44px 80px 70px 80px 70px 60px 70px 60px 70px 1fr", padding:"9px 14px", borderBottom:`1px solid ${COLORS.border}`, fontSize:10, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1 }}>
                <div></div><div>Symbol</div><div>Class</div><div>Price</div><div>Signal</div><div>Score</div><div>Conv.</div><div>R/R</div><div>Horizon</div><div>Thesis</div>
              </div>
              {filtered.map(r => (
                <div key={r.symbol + r.market} onClick={() => openDeepDive(r)}
                  style={{ display:"grid", gridTemplateColumns:"44px 80px 70px 80px 70px 60px 70px 60px 70px 1fr", padding:"11px 14px", borderBottom:`1px solid ${COLORS.border}`, cursor:"pointer", transition:"background 0.15s", background: selected?.symbol === r.symbol ? "rgba(0,212,170,0.05)" : "transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = selected?.symbol === r.symbol ? "rgba(0,212,170,0.05)" : "transparent"}>
                  <div style={{ display:"flex", alignItems:"center" }}><ScoreBadge score={r.score} /></div>
                  <div style={{ display:"flex", alignItems:"center", fontWeight:700, fontSize:13 }}>{r.symbol}</div>
                  <div style={{ display:"flex", alignItems:"center" }}><AssetClassTag assetClass={r.assetClass} /></div>
                  <div style={{ display:"flex", flexDirection:"column", justifyContent:"center" }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{r.price?.toFixed(r.assetClass === "Forex" ? 4 : 2)}</div>
                    <div style={{ fontSize:10, color: r.change_pct >= 0 ? COLORS.green : COLORS.red }}>{r.change_pct >= 0 ? "+" : ""}{r.change_pct?.toFixed(2)}%</div>
                    <Sparkline data={r.prices} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center" }}><SignalBadge signal={r.signal} /></div>
                  <div style={{ display:"flex", alignItems:"center", fontSize:13, fontWeight:700, color: r.score >= 75 ? COLORS.green : r.score >= 50 ? COLORS.gold : COLORS.red }}>{r.score}</div>
                  <div style={{ display:"flex", alignItems:"center" }}><ConvictionBadge conviction={r.conviction} /></div>
                  <div style={{ display:"flex", alignItems:"center", fontSize:12, color:COLORS.gold }}>{r.risk_reward}x</div>
                  <div style={{ display:"flex", alignItems:"center" }}><HorizonTag horizon={r.horizon} /></div>
                  <div style={{ display:"flex", alignItems:"center", fontSize:11, color:COLORS.muted, paddingLeft:8 }}>{r.investor_thesis?.slice(0, 65)}...</div>
                </div>
              ))}
            </div>
          )}

        </>)}
        </div>

        {/* Deep dive panel */}
        <div style={{ background:COLORS.surface, borderLeft:`1px solid ${COLORS.border}`, overflowY:"auto", padding:20 }}>
          <DeepDivePanel selected={selected} deepDive={deepDive} deepLoading={deepLoading} />
        </div>
      </div>

      <div style={{ position:"fixed", bottom:10, left:"50%", transform:"translateX(-50%)", color:COLORS.muted, fontSize:10, background:COLORS.surface, padding:"3px 14px", borderRadius:20, border:`1px solid ${COLORS.border}`, zIndex:99 }}>
        ⚠ AI-generated analysis only — not financial advice
      </div>
    </div>
  );
}
