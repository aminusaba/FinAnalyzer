import { useState, useRef, useCallback } from "react";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;
const MODEL = "claude-sonnet-4-20250514";

// Broad watchlist — quotes fetched from Finnhub, top 10 movers selected dynamically
const WATCHLIST = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","WMT",
  "XOM","UNH","BAC","AVGO","MA","HD","AMD","INTC","QCOM","GS",
  "COST","MCD","CSCO","IBM","GE","CAT","SBUX","TXN","NEE","PFE",
  "SPY","QQQ","IWM","GLD","ARKK",
];

const COLORS = {
  bg:"#0a0a0f", surface:"#12121a", card:"#1a1a28", border:"#2a2a40",
  accent:"#00d4aa", gold:"#f0b429", red:"#ff4d6d", green:"#00d4aa",
  text:"#e0e0f0", muted:"#6b6b8a", blue:"#4d9fff",
};

const TOP_N = 10;

function Toast({ toasts, remove }) {
  return (
    <div style={{ position:"fixed", top:20, right:20, zIndex:9999, display:"flex", flexDirection:"column", gap:10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background: t.type==="alert" ? "#1a0a10" : "#0a1a14",
          border:`1px solid ${t.type==="alert"?COLORS.red:COLORS.accent}`,
          borderLeft:`4px solid ${t.type==="alert"?COLORS.red:COLORS.accent}`,
          borderRadius:8, padding:"12px 16px", maxWidth:340, cursor:"pointer",
          color:COLORS.text, fontSize:13, animation:"slideIn 0.3s ease",
          boxShadow:`0 4px 20px ${t.type==="alert"?"rgba(255,77,109,0.3)":"rgba(0,212,170,0.3)"}`,
        }}>
          <div style={{fontWeight:700, marginBottom:4, color:t.type==="alert"?COLORS.red:COLORS.accent}}>
            {t.type==="alert" ? "⚠ Alert" : "✦ Opportunity"}
          </div>
          <div style={{fontSize:12}}>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

function ScoreBadge({ score }) {
  const c = score >= 75 ? COLORS.green : score >= 50 ? COLORS.gold : COLORS.red;
  return (
    <div style={{ width:40, height:40, borderRadius:"50%", border:`2px solid ${c}`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:c, flexShrink:0 }}>
      {score}
    </div>
  );
}

function SignalBadge({ signal }) {
  const map = { BUY:{color:COLORS.green,bg:"rgba(0,212,170,0.12)"}, SELL:{color:COLORS.red,bg:"rgba(255,77,109,0.12)"}, HOLD:{color:COLORS.gold,bg:"rgba(240,180,41,0.12)"}, WATCH:{color:COLORS.blue,bg:"rgba(77,159,255,0.12)"} };
  const s = map[signal] || map.HOLD;
  return <span style={{fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:20, background:s.bg, color:s.color, whiteSpace:"nowrap"}}>{signal}</span>;
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w=100, h=32, pad=3;
  const vals = data.map(Number).filter(n=>!isNaN(n));
  const min=Math.min(...vals), max=Math.max(...vals), range=max-min||1;
  const pts = vals.map((v,i) => `${pad+(i/(vals.length-1))*(w-pad*2)},${h-pad-((v-min)/range)*(h-pad*2)}`).join(" ");
  const up = vals[vals.length-1] >= vals[0];
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={up?COLORS.green:COLORS.red} strokeWidth={1.5} strokeLinejoin="round"/></svg>;
}

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
  const [filterSignal, setFilterSignal] = useState("All");
  const [prices, setPrices] = useState({});
  const abortRef = useRef(false);
  const toastId = useRef(0);

  const addToast = useCallback((msg, type="insight") => {
    const id = ++toastId.current;
    setToasts(t => [...t, {id, msg, type}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 7000);
  }, []);
  const removeToast = id => setToasts(t => t.filter(x => x.id !== id));

  const pushNotify = useCallback((title, body) => {
    if (Notification.permission === "granted") new Notification(title, {body});
  }, []);

  const fetchTopMovers = async () => {
    // Fetch quotes for all watchlist symbols in parallel
    const quotes = await Promise.all(
      WATCHLIST.map(async (symbol) => {
        try {
          const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
          const d = await r.json();
          if (d && d.c) return { symbol, price: d.c, change_pct: d.dp, change: d.d };
        } catch {}
        return null;
      })
    );
    // Sort by absolute % change, take top N
    return quotes
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, TOP_N)
      .map(s => ({ ...s, market: "🌐 Live Top Movers" }));
  };

  const analyzeSymbol = async (symbol, market, livePrice) => {
    const priceCtx = livePrice ? `Live price: ${livePrice.price.toFixed(2)}, 1-day change: ${livePrice.change_pct.toFixed(2)}%.` : "";
    const isUAE = market.includes("UAE");
    const prompt = `You are a professional swing trade analyst (3-20 day horizon). Analyze ${symbol} (${market}). ${priceCtx} ${isUAE ? "This is a UAE/Gulf market stock on DFM or ADX." : ""}
Return ONLY a valid JSON object, no markdown:
{
  "symbol": "${symbol}",
  "market": "${market}",
  "price": <number>,
  "change_pct": <number>,
  "trend": "up|down|sideways",
  "score": <0-100>,
  "signal": "BUY|SELL|HOLD|WATCH",
  "momentum": <0-100>,
  "risk_reward": <number>,
  "entry": <number>,
  "target": <number>,
  "stop": <number>,
  "prices": [<array of 15 recent daily closes as numbers>],
  "summary": "<2 sentence swing trade thesis>"
}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body: JSON.stringify({
        model: MODEL, max_tokens:600,
        messages:[{role:"user", content: prompt}]
      })
    });
    const data = await res.json();
    const text = data.content?.map(b=>b.type==="text"?b.text:"").join("") || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON");
    return JSON.parse(match[0]);
  };

  const startScan = async () => {
    if (Notification.permission !== "granted") await Notification.requestPermission();
    abortRef.current = false;
    setScanning(true);
    setProgress(0);
    setResults([]);
    setPrices({});

    setProgressLabel("Fetching top movers from Alpha Vantage...");
    let symbols = [];
    try {
      symbols = await fetchTopMovers();
    } catch(e) {
      setProgressLabel(`Failed to fetch movers: ${e.message}`);
      setScanning(false);
      return;
    }

    if (symbols.length === 0) {
      setProgressLabel("No symbols returned. Check your Alpha Vantage key.");
      setScanning(false);
      return;
    }

    for (let i = 0; i < symbols.length; i++) {
      if (abortRef.current) break;
      const { symbol, market, price, change_pct } = symbols[i];
      setProgressLabel(`Analyzing ${symbol}...`);
      const livePrice = price ? { price, change_pct } : null;
      if (livePrice) setPrices(p => ({...p, [symbol]: livePrice}));
      try {
        const r = await analyzeSymbol(symbol, market, livePrice);
        setResults(prev => [...prev, r]);
        if (r.signal === "BUY" && r.score >= 75) {
          addToast(`${r.symbol} — Score ${r.score} | ${r.summary?.slice(0,80)}`, "alert");
          pushNotify(`🔥 BUY: ${r.symbol}`, `Score: ${r.score} | Target: ${r.target}`);
        }
      } catch(e) { console.error(symbol, e.message); }
      setProgress(Math.round(((i+1)/symbols.length)*100));
      await new Promise(r => setTimeout(r, 300));
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
      const prompt = `You are a senior swing trade analyst. Deep analysis of ${sym.symbol} (${sym.market}).
Price: ${sym.price}, Signal: ${sym.signal}, Score: ${sym.score}.
Return ONLY valid JSON:
{
  "overview": "<3-4 sentence market overview>",
  "technical": "<3-4 sentence technical analysis>",
  "catalysts": ["<c1>","<c2>","<c3>"],
  "risks": ["<r1>","<r2>"],
  "swing_plan": "<detailed 3-5 sentence plan with entry/target/stop rationale>",
  "confidence": <1-10>
}`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body: JSON.stringify({ model:MODEL, max_tokens:800, messages:[{role:"user",content:prompt}] })
      });
      const data = await res.json();
      const text = data.content?.map(b=>b.type==="text"?b.text:"").join("")||"";
      const match = text.match(/\{[\s\S]*\}/);
      setDeepDive(match ? JSON.parse(match[0]) : {error:"Parse failed"});
    } catch(e) { setDeepDive({error:e.message}); }
    setDeepLoading(false);
  };

  const filtered = results
    .filter(r => filterSignal === "All" || r.signal === filterSignal)
    .sort((a,b) => sortBy==="score"?b.score-a.score : sortBy==="rr"?b.risk_reward-a.risk_reward : b.momentum-a.momentum);

  const topPicks = results.filter(r=>r.signal==="BUY").sort((a,b)=>b.score-a.score).slice(0,5);

  return (
    <div style={{minHeight:"100vh", background:COLORS.bg, fontFamily:"'Inter',sans-serif", color:COLORS.text}}>
      <style>{`@keyframes slideIn{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}} *{box-sizing:border-box} ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:#12121a} ::-webkit-scrollbar-thumb{background:#2a2a40;border-radius:3px}`}</style>
      <Toast toasts={toasts} remove={removeToast}/>

      {/* Header */}
      <div style={{background:COLORS.surface, borderBottom:`1px solid ${COLORS.border}`, padding:"13px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100}}>
        <div style={{fontWeight:800, fontSize:17, color:COLORS.accent}}>📡 AI Market Scanner</div>
        <div style={{display:"flex", gap:10, alignItems:"center"}}>
          {scanning && (
            <div style={{display:"flex", alignItems:"center", gap:10}}>
              <div style={{width:140, height:4, background:COLORS.border, borderRadius:2}}>
                <div style={{width:`${progress}%`, height:"100%", background:COLORS.accent, borderRadius:2, transition:"width 0.3s"}}/>
              </div>
              <span style={{color:COLORS.gold, fontSize:12}}>{progress}% — {progressLabel}</span>
            </div>
          )}
          {!scanning && results.length > 0 && <span style={{color:COLORS.muted, fontSize:12}}>{results.length} symbols analyzed</span>}
          {!scanning
            ? <button onClick={startScan} style={{padding:"8px 20px", background:COLORS.accent, color:"#000", border:"none", borderRadius:20, fontWeight:700, fontSize:13, cursor:"pointer"}}>▶ Scan Markets</button>
            : <button onClick={stopScan} style={{padding:"8px 20px", background:COLORS.red, color:"#fff", border:"none", borderRadius:20, fontWeight:700, fontSize:13, cursor:"pointer"}}>■ Stop</button>
          }
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"1fr 370px", height:"calc(100vh - 53px)"}}>

        {/* Left */}
        <div style={{overflowY:"auto", padding:20}}>

          {/* Top Picks */}
          {topPicks.length > 0 && (
            <div style={{marginBottom:20}}>
              <div style={{fontSize:12, fontWeight:700, color:COLORS.gold, textTransform:"uppercase", letterSpacing:1, marginBottom:10}}>🔥 Top Buy Picks</div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10}}>
                {topPicks.map(r => (
                  <div key={r.symbol} onClick={()=>openDeepDive(r)} style={{background:COLORS.card, border:`1px solid rgba(0,212,170,0.25)`, borderRadius:10, padding:12, cursor:"pointer"}}>
                    <div style={{fontWeight:800, fontSize:14, color:COLORS.accent}}>{r.symbol}</div>
                    <div style={{fontSize:11, color:COLORS.muted, marginBottom:6}}>{r.market.replace(/\p{Emoji}/gu,"").trim()}</div>
                    <ScoreBadge score={r.score}/>
                    <Sparkline data={r.prices}/>
                    <div style={{fontSize:11, color:COLORS.gold, marginTop:4}}>R/R {r.risk_reward}x</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center"}}>
            {["All","BUY","WATCH","HOLD","SELL"].map(s => (
              <button key={s} onClick={()=>setFilterSignal(s)} style={{padding:"5px 12px", borderRadius:16, border:`1px solid ${filterSignal===s?COLORS.accent:COLORS.border}`, background:filterSignal===s?"rgba(0,212,170,0.1)":"transparent", color:filterSignal===s?COLORS.accent:COLORS.muted, fontSize:11, cursor:"pointer", fontWeight:600}}>{s}</button>
            ))}
            <div style={{marginLeft:"auto", display:"flex", gap:6, alignItems:"center"}}>
              <span style={{color:COLORS.muted, fontSize:11}}>Sort:</span>
              {[["score","Score"],["rr","R/R"],["momentum","Mom"]].map(([k,l])=>(
                <button key={k} onClick={()=>setSortBy(k)} style={{padding:"4px 10px", borderRadius:12, border:`1px solid ${sortBy===k?COLORS.accent:COLORS.border}`, background:sortBy===k?"rgba(0,212,170,0.1)":"transparent", color:sortBy===k?COLORS.accent:COLORS.muted, fontSize:11, cursor:"pointer"}}>{l}</button>
              ))}
            </div>
          </div>

          {/* Results */}
          {filtered.length === 0 ? (
            <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:60, textAlign:"center", color:COLORS.muted}}>
              <div style={{fontSize:40, marginBottom:12}}>📡</div>
              <div style={{fontSize:15, marginBottom:6}}>{scanning ? `Scanning... ${progressLabel}` : "No results yet."}</div>
              <div style={{fontSize:13}}>{!scanning && `Hit "Scan Markets" to fetch the top ${TOP_N} live movers from Alpha Vantage and analyze them with Claude.`}</div>
            </div>
          ) : (
            <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:12, overflow:"hidden"}}>
              <div style={{display:"grid", gridTemplateColumns:"44px 80px 70px 110px 70px 60px 70px 70px 70px 1fr", padding:"9px 14px", borderBottom:`1px solid ${COLORS.border}`, fontSize:10, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1}}>
                <div></div><div>Symbol</div><div>Market</div><div>Price</div><div>Signal</div><div>Score</div><div>Mom</div><div>R/R</div><div>Target</div><div>Summary</div>
              </div>
              {filtered.map(r => (
                <div key={r.symbol+r.market} onClick={()=>openDeepDive(r)}
                  style={{display:"grid", gridTemplateColumns:"44px 80px 70px 110px 70px 60px 70px 70px 70px 1fr", padding:"11px 14px", borderBottom:`1px solid ${COLORS.border}`, cursor:"pointer", transition:"background 0.15s", background:selected?.symbol===r.symbol?"rgba(0,212,170,0.05)":"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                  onMouseLeave={e=>e.currentTarget.style.background=selected?.symbol===r.symbol?"rgba(0,212,170,0.05)":"transparent"}>
                  <div style={{display:"flex",alignItems:"center"}}><ScoreBadge score={r.score}/></div>
                  <div style={{display:"flex",alignItems:"center",fontWeight:700,fontSize:13}}>{r.symbol}</div>
                  <div style={{display:"flex",alignItems:"center",fontSize:10,color:COLORS.muted}}>{r.market.replace(/\p{Emoji}/gu,"").trim()}</div>
                  <div style={{display:"flex",flexDirection:"column",justifyContent:"center"}}>
                    <div style={{fontSize:13,fontWeight:600}}>${r.price?.toFixed(2)}</div>
                    <div style={{fontSize:10,color:r.change_pct>=0?COLORS.green:COLORS.red}}>{r.change_pct>=0?"+":""}{r.change_pct?.toFixed(2)}%</div>
                    <Sparkline data={r.prices}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center"}}><SignalBadge signal={r.signal}/></div>
                  <div style={{display:"flex",alignItems:"center",fontSize:13,fontWeight:700,color:r.score>=75?COLORS.green:r.score>=50?COLORS.gold:COLORS.red}}>{r.score}</div>
                  <div style={{display:"flex",alignItems:"center"}}>
                    <div style={{width:40,height:5,background:COLORS.border,borderRadius:3,overflow:"hidden"}}>
                      <div style={{width:`${r.momentum}%`,height:"100%",background:r.momentum>70?COLORS.green:r.momentum>40?COLORS.gold:COLORS.red}}/>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",fontSize:12,color:COLORS.gold}}>{r.risk_reward}x</div>
                  <div style={{display:"flex",alignItems:"center",fontSize:12,color:COLORS.green}}>${r.target?.toFixed(2)}</div>
                  <div style={{display:"flex",alignItems:"center",fontSize:11,color:COLORS.muted,paddingLeft:8}}>{r.summary?.slice(0,70)}...</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deep Dive Panel */}
        <div style={{background:COLORS.surface, borderLeft:`1px solid ${COLORS.border}`, overflowY:"auto", padding:20}}>
          {!selected ? (
            <div style={{color:COLORS.muted, textAlign:"center", marginTop:80}}>
              <div style={{fontSize:36, marginBottom:12}}>🔍</div>
              <div style={{fontSize:14}}>Click any symbol</div>
              <div style={{fontSize:12, marginTop:4}}>for a full Claude deep-dive</div>
            </div>
          ) : (
            <div>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18}}>
                <div>
                  <div style={{fontSize:22, fontWeight:800, color:COLORS.accent}}>{selected.symbol}</div>
                  <div style={{fontSize:13, color:COLORS.muted, marginTop:2}}>{selected.market}</div>
                  <div style={{fontSize:20, fontWeight:700, marginTop:4}}>${selected.price?.toFixed(2)} <span style={{fontSize:13, color:selected.change_pct>=0?COLORS.green:COLORS.red}}>{selected.change_pct>=0?"+":""}{selected.change_pct?.toFixed(2)}%</span></div>
                  <div style={{marginTop:8, display:"flex", gap:8}}>
                    <SignalBadge signal={selected.signal}/>
                    <span style={{fontSize:11, color:COLORS.muted, padding:"3px 0"}}>{selected.trend} trend</span>
                  </div>
                </div>
                <ScoreBadge score={selected.score}/>
              </div>

              <Sparkline data={selected.prices}/>

              <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14, marginTop:12, marginBottom:14}}>
                <div style={{fontSize:10, color:COLORS.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10}}>Trade Levels</div>
                {[["Entry",selected.entry,COLORS.blue],["Target",selected.target,COLORS.green],["Stop",selected.stop,COLORS.red],["R/R",`${selected.risk_reward}x`,COLORS.gold]].map(([l,v,c])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{color:COLORS.muted,fontSize:12}}>{l}</span>
                    <span style={{fontWeight:700,color:c,fontSize:13}}>{typeof v==="string"?v:`${Number(v)?.toFixed(2)}`}</span>
                  </div>
                ))}
              </div>

              <div style={{color:COLORS.muted, fontSize:12, lineHeight:1.7, marginBottom:16}}>{selected.summary}</div>

              {deepLoading && <div style={{color:COLORS.accent, fontSize:13, textAlign:"center", padding:24}}>⟳ Claude analyzing...</div>}

              {deepDive && !deepDive.error && (
                <div style={{display:"flex", flexDirection:"column", gap:12}}>
                  {[["📊 Overview",deepDive.overview,COLORS.accent],["📈 Technical",deepDive.technical,COLORS.blue],["📋 Swing Plan",deepDive.swing_plan,COLORS.green]].map(([title,content,tc])=>(
                    <div key={title} style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14}}>
                      <div style={{fontWeight:700, fontSize:11, color:tc, marginBottom:8, textTransform:"uppercase", letterSpacing:1}}>{title}</div>
                      <div style={{fontSize:12, color:COLORS.muted, lineHeight:1.7}}>{content}</div>
                    </div>
                  ))}
                  {deepDive.catalysts && (
                    <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14}}>
                      <div style={{fontWeight:700, fontSize:11, color:COLORS.gold, marginBottom:8, textTransform:"uppercase", letterSpacing:1}}>⚡ Catalysts</div>
                      {deepDive.catalysts.map((c,i)=><div key={i} style={{fontSize:12,color:COLORS.muted,marginBottom:4}}>• {c}</div>)}
                    </div>
                  )}
                  {deepDive.risks && (
                    <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14}}>
                      <div style={{fontWeight:700, fontSize:11, color:COLORS.red, marginBottom:8, textTransform:"uppercase", letterSpacing:1}}>⚠ Risks</div>
                      {deepDive.risks.map((r,i)=><div key={i} style={{fontSize:12,color:COLORS.muted,marginBottom:4}}>• {r}</div>)}
                    </div>
                  )}
                  <div style={{background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, padding:14, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                    <span style={{fontSize:12,color:COLORS.muted}}>AI Confidence</span>
                    <span style={{fontWeight:800, fontSize:20, color:deepDive.confidence>=7?COLORS.green:deepDive.confidence>=5?COLORS.gold:COLORS.red}}>{deepDive.confidence}/10</span>
                  </div>
                </div>
              )}
              {deepDive?.error && <div style={{color:COLORS.red, fontSize:12, marginTop:8}}>Error: {deepDive.error}</div>}
            </div>
          )}
        </div>
      </div>

      <div style={{position:"fixed", bottom:10, left:"50%", transform:"translateX(-50%)", color:COLORS.muted, fontSize:10, background:COLORS.surface, padding:"3px 14px", borderRadius:20, border:`1px solid ${COLORS.border}`, zIndex:99}}>
        ⚠ AI-generated analysis only — not financial advice
      </div>
    </div>
  );
}
