import { COLORS } from "../lib/universe.js";

export function Toast({ toasts, remove }) {
  return (
    <div style={{ position:"fixed", top:20, right:20, zIndex:9999, display:"flex", flexDirection:"column", gap:10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background: t.type === "alert" ? "#1a0a10" : "#0a1a14",
          border: `1px solid ${t.type === "alert" ? COLORS.red : COLORS.accent}`,
          borderLeft: `4px solid ${t.type === "alert" ? COLORS.red : COLORS.accent}`,
          borderRadius:8, padding:"12px 16px", maxWidth:340, cursor:"pointer",
          color:COLORS.text, fontSize:13, animation:"slideIn 0.3s ease",
          boxShadow: `0 4px 20px ${t.type === "alert" ? "rgba(255,77,109,0.3)" : "rgba(0,212,170,0.3)"}`,
        }}>
          <div style={{ fontWeight:700, marginBottom:4, color: t.type === "alert" ? COLORS.red : COLORS.accent }}>
            {t.type === "alert" ? "⚠ Alert" : "✦ Opportunity"}
          </div>
          <div style={{ fontSize:12 }}>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}
