/**
 * Theme management — 5 dark variants + light mode.
 * Uses CSS custom properties so all COLORS references update automatically.
 */

export const THEMES = {
  "midnight-slate": {
    label: "Midnight Slate",
    dark: true,
    bg:           "#06060a",
    surface:      "#0d0d16",
    card:         "#111120",
    border:       "#1c1c2e",
    accent:       "#00d4aa",
    gold:         "#f0b429",
    red:          "#ff4d6d",
    green:        "#00d4aa",
    text:         "#e8e8f8",
    muted:        "#5a5a7a",
    blue:         "#4d9fff",
    purple:       "#a78bfa",
    cardGrad:     "linear-gradient(135deg, #111120, #0d0d1a)",
    surfaceGrad:  "linear-gradient(135deg, #0f0f1e, #0d0d16)",
    headerGrad:   "linear-gradient(180deg, #0f0f1e 0%, #0d0d16 100%)",
    overlay:      "rgba(0,0,0,0.20)",
    overlayStrong:"rgba(0,0,0,0.40)",
    chartBg:      "#06060a",
    chartGrid:    "#12121f",
    chartText:    "#6060a0",
    chartBorder:  "#1c1c2e",
    accentGrad:   "linear-gradient(135deg, #00d4aa, #00b4d8)",
  },
  "carbon": {
    label: "Carbon",
    dark: true,
    bg:           "#000000",
    surface:      "#0a0a0a",
    card:         "#111111",
    border:       "#1a1a1a",
    accent:       "#2979ff",
    gold:         "#f0b429",
    red:          "#ff1744",
    green:        "#00e676",
    text:         "#e0e0e0",
    muted:        "#555555",
    blue:         "#2979ff",
    purple:       "#a78bfa",
    cardGrad:     "linear-gradient(135deg, #111111, #0a0a0a)",
    surfaceGrad:  "linear-gradient(135deg, #0f0f0f, #0a0a0a)",
    headerGrad:   "linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)",
    overlay:      "rgba(255,255,255,0.03)",
    overlayStrong:"rgba(255,255,255,0.06)",
    chartBg:      "#000000",
    chartGrid:    "#0f0f0f",
    chartText:    "#555555",
    chartBorder:  "#1a1a1a",
    accentGrad:   "linear-gradient(135deg, #2979ff, #0d47a1)",
  },
  "deep-forest": {
    label: "Deep Forest",
    dark: true,
    bg:           "#050d08",
    surface:      "#0a1a0f",
    card:         "#0f2018",
    border:       "#1a3025",
    accent:       "#39d353",
    gold:         "#e3a008",
    red:          "#f05252",
    green:        "#39d353",
    text:         "#d1fae5",
    muted:        "#4a7c59",
    blue:         "#34d399",
    purple:       "#a78bfa",
    cardGrad:     "linear-gradient(135deg, #0f2018, #0a1a0f)",
    surfaceGrad:  "linear-gradient(135deg, #0d1f12, #0a1a0f)",
    headerGrad:   "linear-gradient(180deg, #0d1f12 0%, #0a1a0f 100%)",
    overlay:      "rgba(0,0,0,0.25)",
    overlayStrong:"rgba(0,0,0,0.45)",
    chartBg:      "#050d08",
    chartGrid:    "#0d1f12",
    chartText:    "#4a7c59",
    chartBorder:  "#1a3025",
    accentGrad:   "linear-gradient(135deg, #39d353, #16a34a)",
  },
  "obsidian": {
    label: "Obsidian",
    dark: true,
    bg:           "#0f0e0c",
    surface:      "#1a1814",
    card:         "#211f1a",
    border:       "#2e2b24",
    accent:       "#f59e0b",
    gold:         "#f59e0b",
    red:          "#ef4444",
    green:        "#10b981",
    text:         "#f5f0e8",
    muted:        "#6b6454",
    blue:         "#60a5fa",
    purple:       "#a78bfa",
    cardGrad:     "linear-gradient(135deg, #211f1a, #1a1814)",
    surfaceGrad:  "linear-gradient(135deg, #1e1c17, #1a1814)",
    headerGrad:   "linear-gradient(180deg, #1e1c17 0%, #1a1814 100%)",
    overlay:      "rgba(0,0,0,0.25)",
    overlayStrong:"rgba(0,0,0,0.45)",
    chartBg:      "#0f0e0c",
    chartGrid:    "#1e1c17",
    chartText:    "#6b6454",
    chartBorder:  "#2e2b24",
    accentGrad:   "linear-gradient(135deg, #f59e0b, #d97706)",
  },
  "cyberpunk": {
    label: "Cyberpunk",
    dark: true,
    bg:           "#08020f",
    surface:      "#110820",
    card:         "#180d2a",
    border:       "#2d1a4a",
    accent:       "#00fff5",
    gold:         "#ffb800",
    red:          "#ff0055",
    green:        "#00fff5",
    text:         "#f0e8ff",
    muted:        "#6a4a8a",
    blue:         "#00fff5",
    purple:       "#bf5af2",
    cardGrad:     "linear-gradient(135deg, #180d2a, #110820)",
    surfaceGrad:  "linear-gradient(135deg, #150a25, #110820)",
    headerGrad:   "linear-gradient(180deg, #150a25 0%, #110820 100%)",
    overlay:      "rgba(0,0,0,0.30)",
    overlayStrong:"rgba(0,0,0,0.50)",
    chartBg:      "#08020f",
    chartGrid:    "#150a25",
    chartText:    "#6a4a8a",
    chartBorder:  "#2d1a4a",
    accentGrad:   "linear-gradient(135deg, #00fff5, #bf5af2)",
  },
  "light": {
    label: "Light",
    dark: false,
    bg:           "#f0f1f7",
    surface:      "#ffffff",
    card:         "#ffffff",
    border:       "#dde0f0",
    accent:       "#00a882",
    gold:         "#c47f00",
    red:          "#dc2626",
    green:        "#059669",
    text:         "#1a1a2e",
    muted:        "#7777aa",
    blue:         "#2563eb",
    purple:       "#6d28d9",
    cardGrad:     "linear-gradient(135deg, #ffffff, #f7f7fc)",
    surfaceGrad:  "linear-gradient(135deg, #f7f7fc, #f0f1f7)",
    headerGrad:   "linear-gradient(180deg, #ffffff 0%, #f7f7fc 100%)",
    overlay:      "rgba(0,0,0,0.04)",
    overlayStrong:"rgba(0,0,0,0.07)",
    chartBg:      "#f7f7fc",
    chartGrid:    "#e8e8f4",
    chartText:    "#8888aa",
    chartBorder:  "#dde0f0",
    accentGrad:   "linear-gradient(135deg, #00a882, #0077b6)",
  },
};

// Keep DARK/LIGHT exports for getRawTheme() compatibility
export const DARK  = THEMES["midnight-slate"];
export const LIGHT = THEMES["light"];

const VAR_KEYS = Object.keys(DARK);

/** Apply a theme by ID */
export function applyTheme(themeId) {
  const theme = THEMES[themeId] ?? THEMES["midnight-slate"];
  const root  = document.documentElement;
  VAR_KEYS.forEach(k => root.style.setProperty(`--c-${k}`, theme[k]));
  root.setAttribute("data-theme", themeId);
  try { localStorage.setItem("finanalyzer_theme", themeId); } catch {}
}

/** Read the saved theme ID (default: midnight-slate) */
export function getTheme() {
  try { return localStorage.getItem("finanalyzer_theme") || "midnight-slate"; } catch { return "midnight-slate"; }
}

export function resolveColor(cssVar) {
  const name = cssVar.replace(/var\(/, "").replace(/\)$/, "").trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function getRawTheme() {
  return THEMES[getTheme()] ?? THEMES["midnight-slate"];
}
