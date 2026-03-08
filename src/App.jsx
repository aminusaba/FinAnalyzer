import { useState, useRef, useCallback, useEffect } from "react";
import { COLORS } from "./lib/universe.js";
import { fetchAllMarketData } from "./lib/market-data.js";
import { getCached, setCache } from "./lib/analysis-cache.js";
import { analyzeSymbol, deepDiveSymbol } from "./lib/openai.js";
import { sendAlerts, sendOrderFill } from "./lib/notifications.js";
import { Toast } from "./components/Toast.jsx";
import { Sparkline } from "./components/Sparkline.jsx";
import { ScoreBadge, SignalBadge, ConvictionBadge, HorizonTag, AssetClassTag } from "./components/Badges.jsx";
import { DeepDivePanel } from "./components/DeepDivePanel.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { HistoryPanel, useHistory, saveHistory } from "./components/HistoryPanel.jsx";
import { LoginScreen } from "./components/LoginScreen.jsx";
import { getSession, clearSession, getUserSettingsKey } from "./lib/auth.js";
import { PortfolioPanel } from "./components/PortfolioPanel.jsx";
import { placeOrder, closePosition, isAlpacaSupported, getMarketBars, getAccount, getPositions } from "./lib/trading.js";
import { initialize as mcpInit, ping as mcpPing, reset as mcpReset } from "./lib/mcp-client.js";

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
  walletSize: 10000,
  autoTradeEnabled: false,
  bracketOrdersEnabled: true,
  mcpUrl: "http://localhost:8000",
  mcpEnabled: true,
};

const SCAN_INTERVALS = [5, 10, 15, 30, 60, 120];

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
  const [notifSettings, setNotifSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(getUserSettingsKey(session.key));
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });
  const [activeTab, setActiveTab] = useState("scan"); // "scan" | "history" | "portfolio"
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const { fetchHistory } = useHistory();
  const [nextScanIn, setNextScanIn] = useState(null); // seconds until next auto-scan
  const [mcpStatus, setMcpStatus] = useState("disconnected"); // "disconnected" | "connecting" | "connected"
  const abortRef = useRef(false);
  const toastId = useRef(0);
  const autoScanTimer = useRef(null);
  const countdownTimer = useRef(null);
  const startScanRef = useRef(null);       // always points to latest startScan (avoids stale closure in timer)
  const circuitBreaker = useRef({ failures: 0, tripped: false }); // stops auto-trade after 3 consecutive failures

  const settingsKey = getUserSettingsKey(session.key);

  const updateSettings = (newSettings) => {
    setNotifSettings(newSettings);
    try { localStorage.setItem(settingsKey, JSON.stringify(newSettings)); } catch {}
  };

  // MCP auto-connect
  useEffect(() => {
    if (!notifSettings.mcpEnabled) { mcpReset(); setMcpStatus("disconnected"); return; }
    setMcpStatus("connecting");
    mcpInit(notifSettings.mcpUrl)
      .then(() => setMcpStatus("connected"))
      .catch(() => setMcpStatus("disconnected"));
  }, [notifSettings.mcpEnabled, notifSettings.mcpUrl]);

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

  // Auto-scan scheduler — uses ref to always call the latest startScan (fixes stale closure)
  useEffect(() => {
    clearTimeout(autoScanTimer.current);
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
        startScanRef.current?.(); // always uses latest startScan
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
    circuitBreaker.current = { failures: 0, tripped: false }; // reset circuit breaker each scan
    setScanning(true);
    setProgress(0);
    setResults([]);

    // Step 1: gather market data in parallel (Finnhub + Alpaca + MCP crypto)
    setProgressLabel("Gathering market data from all sources...");
    let allSymbols = [];
    try {
      allSymbols = await fetchAllMarketData(notifSettings);
    } catch (e) {
      setProgressLabel(`Feed error: ${e.message}`);
      setScanning(false);
      return;
    }

    if (!allSymbols.length) {
      setProgressLabel("No market data returned. Check your API keys.");
      setScanning(false);
      return;
    }

    // Step 2: fetch account state — buying power + full position map for GPT context
    let buyingPower = null;
    let currentPositions = new Map(); // symbol → { qty, avgPrice, marketValue }

    if (notifSettings.alpacaKey && notifSettings.alpacaSecret) {
      try {
        const [account, positions] = await Promise.all([
          getAccount(notifSettings),
          getPositions(notifSettings),
        ]);
        buyingPower = parseFloat(account.buying_power || account.cash || 0);
        if (Array.isArray(positions)) {
          for (const p of positions) {
            currentPositions.set(p.symbol, {
              qty:         parseFloat(p.qty || 0),
              avgPrice:    parseFloat(p.avg_entry_price || 0),
              marketValue: parseFloat(p.market_value || 0),
            });
          }
        }
      } catch {
        // Non-fatal — continue without account data
      }
    }

    // Builds a concise portfolio summary for GPT — called before each symbol analysis
    const buildPortfolioContext = (positions, bp) => {
      const totalInvested = [...positions.values()].reduce((s, p) => s + p.marketValue, 0);
      const header = `Buying power: $${bp?.toFixed(0) ?? "unknown"} | Total invested: $${totalInvested.toFixed(0)}`;
      if (!positions.size) return header;
      const holdings = [...positions.entries()]
        .map(([sym, p]) => `${sym}: ${p.qty.toFixed(4)} shares @ avg $${p.avgPrice.toFixed(2)} (value $${p.marketValue.toFixed(0)})`)
        .join("; ");
      return `${header}\nHoldings: ${holdings}`;
    };

    // Step 3: separate cached from uncached
    const toAnalyze = [];
    const cachedResults = [];
    for (const sym of allSymbols) {
      const hit = getCached(sym.symbol, session.key);
      if (hit) {
        cachedResults.push({ ...hit, price: sym.price, change_pct: sym.change_pct });
      } else {
        toAnalyze.push(sym);
      }
    }

    if (cachedResults.length) setResults(cachedResults);
    setProgressLabel(`Found ${allSymbols.length} symbols — analyzing ${toAnalyze.length} new...`);

    // Step 4: GPT analysis + auto-trade
    let remainingBuyingPower = buyingPower;
    for (let i = 0; i < toAnalyze.length; i++) {
      if (abortRef.current) break;
      const sym = toAnalyze[i];
      setProgressLabel(`Analyzing ${sym.symbol} (${i + 1}/${toAnalyze.length})...`);
      try {
        const bars = await getMarketBars(sym.symbol, sym.assetClass);
        // Rebuild portfolio context before every GPT call so it reflects orders placed this scan
        const portfolioContext = buildPortfolioContext(currentPositions, remainingBuyingPower);
        const r = await analyzeSymbol({ ...sym, bars, portfolioContext });
        setCache(sym.symbol, r, session.key);
        setResults(prev => [...prev.filter(x => x.symbol !== r.symbol), r]);
        await sendAlerts(r, notifSettings);

        if (r.signal === "BUY" && r.score >= notifSettings.minScore) {
          addToast(`${r.symbol} [${r.assetClass}] — Score ${r.score} | ${r.conviction} conviction | ${r.investor_thesis?.slice(0, 80)}`, "alert");
        }

        // Auto-trade
        if (notifSettings.autoTradeEnabled && notifSettings.alpacaKey && notifSettings.alpacaSecret) {
          const supported = isAlpacaSupported(r.assetClass);
          const targetNotional = (notifSettings.walletSize || 0) * (r.allocation_pct / 100);
          const existingPosition = currentPositions.get(r.symbol);
          const alreadyInvested = existingPosition?.marketValue ?? 0;
          // Only buy the difference between target allocation and what we already hold
          const notional = Math.max(0, targetNotional - alreadyInvested);
          const meetsScore = r.score >= notifSettings.minScore;
          const meetsConviction = notifSettings.minConviction === "ANY" || r.conviction === "HIGH";

          if (r.signal === "BUY") {
            if (circuitBreaker.current.tripped) {
              addToast(`⚡ ${r.symbol} BUY skipped — circuit breaker tripped`, "alert");
            } else if (!supported) {
              addToast(`⚡ ${r.symbol} BUY skipped — ${r.assetClass} not supported on Alpaca`, "insight");
            } else if (!meetsScore) {
              addToast(`⚡ ${r.symbol} BUY skipped — score ${r.score} < min ${notifSettings.minScore}`, "insight");
            } else if (!meetsConviction) {
              addToast(`⚡ ${r.symbol} BUY skipped — conviction ${r.conviction} below threshold`, "insight");
            } else if (alreadyInvested >= targetNotional * 0.9) {
              addToast(`⚡ ${r.symbol} BUY skipped — already holding $${alreadyInvested.toFixed(0)} (target $${targetNotional.toFixed(0)})`, "insight");
            } else if (notional < 1) {
              addToast(`⚡ ${r.symbol} BUY skipped — wallet size not set or allocation too small`, "insight");
            } else if (remainingBuyingPower !== null && notional > remainingBuyingPower) {
              addToast(`⚡ ${r.symbol} BUY skipped — insufficient buying power ($${remainingBuyingPower.toFixed(0)} available, $${notional.toFixed(0)} needed)`, "insight");
            } else {
              try {
                const useBracket = notifSettings.bracketOrdersEnabled && r.stop && r.target && !r._bracketInvalid;
                await placeOrder(r.symbol, "buy", notional, { ...notifSettings, _assetClass: r.assetClass }, { stopPrice: r.stop, takeProfitPrice: r.target, price: r.price });
                circuitBreaker.current.failures = 0;
                if (remainingBuyingPower !== null) remainingBuyingPower -= notional;
                // Update live position map so subsequent GPT calls know we now hold this
                const newQty = (existingPosition?.qty ?? 0) + (r.price ? notional / r.price : 0);
                currentPositions.set(r.symbol, {
                  qty: newQty,
                  avgPrice: r.price ?? existingPosition?.avgPrice ?? 0,
                  marketValue: alreadyInvested + notional,
                });
                const existingNote = alreadyInvested > 0 ? ` (adding to existing $${alreadyInvested.toFixed(0)} position)` : "";
                const bracketNote = useBracket
                  ? ` · SL $${Number(r.stop).toFixed(2)} / TP $${Number(r.target).toFixed(2)}`
                  : r._bracketInvalid ? " · (bracket skipped — invalid R/R)" : "";
                addToast(`🛒 Auto-bought ${r.symbol} · $${notional.toFixed(0)}${existingNote}${bracketNote}`, "insight");
                await sendOrderFill(notifSettings, { symbol: r.symbol, side: "buy", notional, stop: r.stop, target: r.target, bracket: useBracket });
              } catch (e) {
                circuitBreaker.current.failures++;
                if (circuitBreaker.current.failures >= 3) {
                  circuitBreaker.current.tripped = true;
                  addToast(`⛔ Circuit breaker tripped — auto-trade paused for rest of scan`, "alert");
                }
                addToast(`⚠ Order failed for ${r.symbol}: ${e.message}`, "alert");
              }
            }
          } else if (r.signal === "SELL" && supported) {
            try {
              await closePosition(r.symbol, notifSettings);
              currentPositions.delete(r.symbol); // remove from live map
              addToast(`📤 Auto-closed position in ${r.symbol}`, "insight");
              await sendOrderFill(notifSettings, { symbol: r.symbol, side: "sell", notional: alreadyInvested });
            } catch {
              // No position to close — silently ignore
            }
          }
        }
      } catch (e) {
        console.error(sym.symbol, e.message);
      }
      setProgress(Math.round(((i + 1) / toAnalyze.length) * 100));
      await new Promise(r => setTimeout(r, 200));
    }

    // Save scan to local history
    setResults(prev => {
      saveHistory(prev, notifSettings);
      return prev;
    });

    setProgressLabel(`Scan complete — ${allSymbols.length} symbols, ${toAnalyze.length} analyzed, ${cachedResults.length} from cache`);
    setScanning(false);
  };

  // Keep ref always pointing to latest startScan (fixes stale closure in auto-scan timer)
  startScanRef.current = startScan;

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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        @keyframes slideIn { from { transform:translateX(40px);opacity:0 } to { transform:translateX(0);opacity:1 } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes glow { 0%,100%{box-shadow:0 0 8px rgba(0,212,170,0.4)} 50%{box-shadow:0 0 20px rgba(0,212,170,0.8)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box; margin:0; padding:0 }
        body { background:#06060a }
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
        background: "linear-gradient(180deg, #0f0f1e 0%, #0d0d16 100%)",
        borderBottom: "1px solid #1c1c2e",
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
            fontSize: 16, boxShadow: "0 0 16px rgba(0,212,170,0.4)",
          }}>📡</div>
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
              background: mcpStatus === "connected" ? COLORS.green : mcpStatus === "connecting" ? COLORS.gold : "#3a3a5a",
              boxShadow: mcpStatus === "connected" ? `0 0 6px ${COLORS.green}` : "none",
              animation: mcpStatus === "connecting" ? "pulse 1s infinite" : "none",
            }} />
            <span style={{ fontSize:10, color: mcpStatus === "connected" ? COLORS.green : COLORS.muted, fontWeight:600 }}>
              MCP {mcpStatus === "connected" ? "Connected" : mcpStatus === "connecting" ? "Connecting..." : "Off"}
            </span>
          </div>
          {scanning && (
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:COLORS.accent, animation:"pulse 1s infinite", boxShadow:`0 0 8px ${COLORS.accent}` }} />
              <div style={{ width:160, height:3, background:COLORS.border, borderRadius:4, overflow:"hidden" }}>
                <div style={{ width:`${progress}%`, height:"100%", background:"linear-gradient(90deg,#00d4aa,#00b4d8)", borderRadius:4, transition:"width 0.4s ease", boxShadow:"0 0 8px rgba(0,212,170,0.6)" }} />
              </div>
              <span style={{ color:COLORS.gold, fontSize:11, fontWeight:600 }}>{progress}% · {progressLabel}</span>
            </div>
          )}
          {!scanning && results.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:COLORS.accent }} />
              <span style={{ color:COLORS.muted, fontSize:11 }}>{results.length} assets analyzed</span>
            </div>
          )}
          {!scanning && nextScanIn !== null && (
            <div style={{ background:"rgba(240,180,41,0.08)", border:"1px solid rgba(240,180,41,0.2)", borderRadius:20, padding:"4px 12px" }}>
              <span style={{ color:COLORS.gold, fontSize:11, fontWeight:600 }}>
                ⏱ {Math.floor(nextScanIn / 60)}:{String(nextScanIn % 60).padStart(2, "0")}
              </span>
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
          <button onClick={() => setShowSettings(s => !s)} style={{
            padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: "rgba(255,255,255,0.04)", border: "1px solid #1c1c2e",
            borderRadius: 20, color: COLORS.muted, transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS.accent; e.currentTarget.style.color = COLORS.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1c1c2e"; e.currentTarget.style.color = COLORS.muted; }}
          >⚙ Alerts</button>
          {!scanning
            ? <button onClick={startScan} style={{
                padding: "8px 22px", border: "none", borderRadius: 20,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
                color: "#000", boxShadow: "0 4px 16px rgba(0,212,170,0.35)",
                transition: "all 0.2s",
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,212,170,0.6)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,212,170,0.35)"}
              >▶ Scan Markets</button>
            : <button onClick={stopScan} style={{
                padding: "8px 22px", border: "none", borderRadius: 20,
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                background: "linear-gradient(135deg, #ff4d6d, #e11d48)",
                color: "#fff", boxShadow: "0 4px 16px rgba(255,77,109,0.35)",
              }}>■ Stop</button>
          }
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "0 28px", display: "flex", gap: 2 }}>
        {[["scan", "📡 Live Scan"], ["history", "🕓 History"], ["portfolio", "💼 Portfolio"]].map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "12px 20px", background: "none", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
            color: activeTab === tab ? COLORS.accent : COLORS.muted,
            borderBottom: `2px solid ${activeTab === tab ? COLORS.accent : "transparent"}`,
            transition: "all 0.2s",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 390px", height:"calc(100vh - 90px)" }}>

        {/* Left panel */}
        <div style={{ overflowY:"auto", padding:20 }}>
        {activeTab === "history" ? (
          <HistoryPanel history={history} loading={historyLoading} error={historyError} />
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
                    background: "linear-gradient(135deg, #141424, #0f0f1e)",
                    border: "1px solid rgba(0,212,170,0.2)",
                    borderRadius: 12, padding: 14, cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                    transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.5)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,212,170,0.15)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,212,170,0.2)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)"; }}
                  >
                    <div style={{ fontWeight:900, fontSize:14, color:COLORS.accent, letterSpacing:-0.3 }}>{r.symbol}</div>
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
            <div style={{
              background: "linear-gradient(135deg, #111120, #0d0d1a)",
              border: `1px solid ${COLORS.border}`, borderRadius: 14,
              padding: 60, textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📡</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#404060", marginBottom: 8 }}>{scanning ? progressLabel : "No results yet."}</div>
              <div style={{ fontSize: 12, color: "#2a2a42" }}>{!scanning && "Click Scan Markets to analyze top movers across US, Europe, Asia, Crypto, Forex & Commodities."}</div>
            </div>
          ) : (
            <div style={{
              background: "linear-gradient(180deg, #111120, #0d0d1a)",
              border: `1px solid ${COLORS.border}`, borderRadius: 14,
              overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}>
              {/* Table header */}
              <div style={{ display:"grid", gridTemplateColumns:"44px 80px 70px 90px 74px 60px 70px 60px 70px 1fr", padding:"10px 16px", borderBottom:`1px solid ${COLORS.border}`, fontSize:9, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1.2, fontWeight:700, background:"rgba(0,0,0,0.2)" }}>
                <div/><div>Symbol</div><div>Class</div><div>Price</div><div>Signal</div><div>Score</div><div>Conv.</div><div>R/R</div><div>Horizon</div><div>Thesis</div>
              </div>
              {filtered.map((r, idx) => {
                const isSelected = selected?.symbol === r.symbol;
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
                    <div style={{ display:"flex", alignItems:"center", fontWeight:800, fontSize:13, color: isSelected ? COLORS.accent : COLORS.text, letterSpacing:-0.2 }}>{r.symbol}</div>
                    <div style={{ display:"flex", alignItems:"center" }}><AssetClassTag assetClass={r.assetClass} /></div>
                    <div style={{ display:"flex", flexDirection:"column", justifyContent:"center", gap:2 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{r.assetClass === "Forex" ? r.price?.toFixed(4) : `$${r.price?.toFixed(2)}`}</div>
                      <div style={{ fontSize:10, fontWeight:600, color: r.change_pct >= 0 ? COLORS.green : COLORS.red }}>{r.change_pct >= 0 ? "▲" : "▼"} {Math.abs(r.change_pct)?.toFixed(2)}%</div>
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

        {/* Deep dive panel */}
        <div style={{ background:"linear-gradient(180deg, #0d0d16, #0a0a12)", borderLeft:`1px solid ${COLORS.border}`, overflowY:"auto", padding:20 }}>
          <DeepDivePanel selected={selected} deepDive={deepDive} deepLoading={deepLoading} />
        </div>
      </div>

      <div style={{ position:"fixed", bottom:14, left:"50%", transform:"translateX(-50%)", color:"#3a3a5a", fontSize:10, background:"rgba(13,13,22,0.9)", padding:"4px 16px", borderRadius:20, border:"1px solid #1c1c2e", zIndex:99, backdropFilter:"blur(8px)", letterSpacing:0.5 }}>
        ⚠ AI-generated analysis only — not financial advice
      </div>
    </div>
  );
}
