import { COLORS } from "../lib/universe.js";

export function Toast({ toasts, remove }) {
  return (
    <div style={{ position: "fixed", top: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background: t.type === "alert"
            ? "linear-gradient(135deg, #1a0812, #120a1a)"
            : "linear-gradient(135deg, #071412, #070e14)",
          border: `1px solid ${t.type === "alert" ? "rgba(255,77,109,0.4)" : "rgba(0,212,170,0.4)"}`,
          borderLeft: `4px solid ${t.type === "alert" ? COLORS.red : COLORS.accent}`,
          borderRadius: 10, padding: "14px 18px", maxWidth: 360, cursor: "pointer",
          color: COLORS.text, fontSize: 13, animation: "slideIn 0.3s ease",
          boxShadow: t.type === "alert"
            ? "0 8px 32px rgba(255,77,109,0.25), 0 0 0 1px rgba(255,77,109,0.1)"
            : "0 8px 32px rgba(0,212,170,0.2), 0 0 0 1px rgba(0,212,170,0.1)",
          backdropFilter: "blur(12px)",
        }}>
          <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: t.type === "alert" ? COLORS.red : COLORS.accent }}>
            {t.type === "alert" ? "⚠ Buy Alert" : "✦ Insight"}
          </div>
          <div style={{ fontSize: 12, color: "#9090b0", lineHeight: 1.6 }}>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}
