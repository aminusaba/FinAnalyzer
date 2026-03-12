import { useState, useEffect, useRef } from "react";
import { COLORS } from "../lib/universe.js";
import { Trash2, RefreshCw } from "lucide-react";

const LEVEL_COLOR = { info: COLORS.text, warn: "#f0b429", error: "#ef4444" };
const LEVEL_BG    = { info: "transparent", warn: "rgba(240,180,41,0.06)", error: "rgba(239,68,68,0.06)" };

async function fetchLogs(limit = 300) {
  const r = await fetch(`/api/db/daemon-logs?limit=${limit}`);
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
}

async function clearLogs() {
  await fetch("/api/db/daemon-logs", { method: "DELETE" });
}

export function DaemonLogPanel() {
  const [logs, setLogs]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("all"); // all | info | warn | error
  const bottomRef = useRef(null);
  const timerRef  = useRef(null);

  const load = async () => {
    try { setLogs(await fetchLogs()); } catch {}
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5000);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    await clearLogs();
    setLogs([]);
  };

  const handleRefresh = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };

  const filtered = filter === "all" ? logs : logs.filter(l => l.level === filter);
  // logs come newest-first from DB; display oldest-first
  const display = [...filtered].reverse();

  const fmt = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ts; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: COLORS.bg }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
        borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1 }}>
          Daemon Log
        </span>
        <div style={{ marginLeft: 8, display: "flex", gap: 4 }}>
          {["all", "info", "warn", "error"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "2px 9px", borderRadius: 10, border: `1px solid ${filter === f ? COLORS.accent : COLORS.border}`,
              background: filter === f ? "rgba(0,212,170,0.1)" : "transparent",
              color: filter === f ? COLORS.accent : COLORS.muted, fontSize: 10, cursor: "pointer", fontWeight: 600,
            }}>{f}</button>
          ))}
        </div>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10, color: COLORS.muted }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ accentColor: COLORS.accent }} />
          Auto-scroll
        </label>
        <button onClick={handleRefresh} title="Refresh" style={{
          background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8,
          color: COLORS.muted, cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center",
        }}>
          <RefreshCw size={12} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} />
        </button>
        <button onClick={handleClear} title="Clear logs" style={{
          background: "transparent", border: `1px solid ${COLORS.border}`, borderRadius: 8,
          color: COLORS.muted, cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4,
        }}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflowY: "auto", fontFamily: "'Fira Mono','Consolas','monospace'", fontSize: 11 }}>
        {display.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: COLORS.muted, fontSize: 12 }}>
            No logs yet — daemon will write here when it runs.
          </div>
        ) : display.map(l => (
          <div key={l.id} style={{
            display: "grid", gridTemplateColumns: "72px 38px 1fr",
            padding: "3px 14px", borderBottom: `1px solid rgba(255,255,255,0.03)`,
            background: LEVEL_BG[l.level] ?? "transparent",
            lineHeight: 1.5,
          }}>
            <span style={{ color: COLORS.muted, userSelect: "none", flexShrink: 0 }}>{fmt(l.ts)}</span>
            <span style={{
              color: LEVEL_COLOR[l.level] ?? COLORS.text,
              fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5,
              alignSelf: "center",
            }}>{l.level}</span>
            <span style={{ color: LEVEL_COLOR[l.level] ?? COLORS.text, wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
              {l.msg}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
