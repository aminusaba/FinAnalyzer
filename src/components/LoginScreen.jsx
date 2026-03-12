import { useState } from "react";
import { COLORS } from "../lib/universe.js";
import { login, register } from "../lib/auth.js";

export function LoginScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = mode === "login"
        ? await login(username, password)
        : await register(username, password);
      onAuth(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "11px 14px",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8, color: COLORS.text, fontSize: 13,
    outline: "none", transition: "border-color 0.2s",
    fontFamily: "inherit",
  };

  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0 }
        body { background: var(--c-bg) }
        input:focus { border-color: #00d4aa !important; }
      `}</style>

      <div style={{
        width: 380, padding: "40px 36px",
        background: COLORS.cardGrad,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 20,
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,170,0.05)",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, margin: "0 auto 14px",
            boxShadow: "0 0 28px rgba(0,212,170,0.4)",
          }}>📡</div>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: -0.5,
            background: "linear-gradient(135deg, #00d4aa, #00b4d8)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>FinAnalyzer</div>
          <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 4, letterSpacing: 1, textTransform: "uppercase" }}>
            Global Market Intelligence
          </div>
        </div>

        {/* Tab toggle */}
        <div style={{
          display: "flex", background: "rgba(255,255,255,0.03)",
          border: `1px solid ${COLORS.border}`, borderRadius: 10,
          padding: 3, marginBottom: 24,
        }}>
          {[["login", "Sign In"], ["register", "Create Account"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
              background: mode === m ? "linear-gradient(135deg, #00d4aa, #00b4d8)" : "transparent",
              color: mode === m ? "#000" : COLORS.muted,
              fontFamily: "inherit",
            }}>{label}</button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: COLORS.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
              Username
            </label>
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 11, color: COLORS.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
              Password
            </label>
            <input
              type="password"
              style={{ ...inputStyle, marginTop: 6 }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 16, padding: "10px 14px",
              background: "rgba(255,77,109,0.08)",
              border: "1px solid rgba(255,77,109,0.25)",
              borderRadius: 8, fontSize: 12, color: COLORS.red,
            }}>
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "12px 0", border: "none", borderRadius: 10,
              fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
              background: loading ? "rgba(0,212,170,0.4)" : "linear-gradient(135deg, #00d4aa, #00b4d8)",
              color: "#000", boxShadow: loading ? "none" : "0 4px 20px rgba(0,212,170,0.35)",
              transition: "all 0.2s", fontFamily: "inherit",
            }}
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: COLORS.muted, lineHeight: 1.6 }}>
          Credentials stored locally in your browser
        </div>
      </div>
    </div>
  );
}
