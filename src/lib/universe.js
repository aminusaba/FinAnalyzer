// COLORS references CSS custom properties — updated globally when theme toggles.
// Components use these values in inline styles; the browser resolves them via CSS vars.
export const COLORS = {
  bg:           "var(--c-bg)",
  surface:      "var(--c-surface)",
  card:         "var(--c-card)",
  border:       "var(--c-border)",
  accent:       "var(--c-accent)",
  gold:         "var(--c-gold)",
  red:          "var(--c-red)",
  green:        "var(--c-green)",
  text:         "var(--c-text)",
  muted:        "var(--c-muted)",
  blue:         "var(--c-blue)",
  purple:       "var(--c-purple)",
  // Background gradients — use these instead of hardcoded hex gradient strings
  cardGrad:     "var(--c-cardGrad)",
  surfaceGrad:  "var(--c-surfaceGrad)",
  headerGrad:   "var(--c-headerGrad)",
  overlay:      "var(--c-overlay)",
  overlayStrong:"var(--c-overlayStrong)",
  // Fixed-palette gradients (accent/signal colours don't change much between themes)
  accentGrad:  "var(--c-accentGrad)",
  goldGrad:    "linear-gradient(135deg, var(--c-gold), #f97316)",
  redGrad:     "linear-gradient(135deg, var(--c-red), #e11d48)",
  purpleGrad:  "linear-gradient(135deg, var(--c-purple), #7c3aed)",
};

export const UNIVERSE = {
  "US Equities":  ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","XOM","UNH","BAC","AVGO","MA","AMD"],
  "US ETFs":      ["SPY","QQQ","IWM","GLD","TLT","XLK","XLE","XLF","ARKK","SOXX"],
  "Europe/ADRs":  ["ASML","SAP","TTE","SHEL","UL","NVO","AZN","BP","EADSY","SIE"],
  "Asia/ADRs":    ["TSM","BABA","SONY","TM","BIDU","SE","NIO","GRAB","HDB","INFY"],
  "Commodities":  ["GLD","SLV","USO","WEAT","CPER","UNG","DBA","PDBC"],
};

export const CRYPTO_SYMBOLS = [
  { symbol: "BINANCE:BTCUSDT",  display: "BTC/USD"  },
  { symbol: "BINANCE:ETHUSDT",  display: "ETH/USD"  },
  { symbol: "BINANCE:SOLUSDT",  display: "SOL/USD"  },
  { symbol: "BINANCE:XRPUSDT",  display: "XRP/USD"  },
  { symbol: "BINANCE:DOGEUSDT", display: "DOGE/USD" },
  { symbol: "BINANCE:AVAXUSDT", display: "AVAX/USD" },
  { symbol: "BINANCE:LINKUSDT", display: "LINK/USD" },
  { symbol: "BINANCE:ADAUSDT",  display: "ADA/USD"  },
];

// Forex exposure via currency ETFs — fully tradeable on Alpaca (Wisdomtree + Invesco)
export const FOREX_PAIRS = ["EUR","GBP","JPY","AUD","CAD","CHF"]; // kept for reference

export const TOP_N = 3; // top movers per category

// ~80 equity/ETF symbols fetched via Alpaca batch snapshot (SIP feed — Algo Trader Plus)
export const ALPACA_SCAN_SYMBOLS = [
  // US Mega-Cap Tech
  { symbol: "AAPL",  assetClass: "Equity", market: "US Equities" },
  { symbol: "MSFT",  assetClass: "Equity", market: "US Equities" },
  { symbol: "NVDA",  assetClass: "Equity", market: "US Equities" },
  { symbol: "AMZN",  assetClass: "Equity", market: "US Equities" },
  { symbol: "GOOGL", assetClass: "Equity", market: "US Equities" },
  { symbol: "META",  assetClass: "Equity", market: "US Equities" },
  { symbol: "TSLA",  assetClass: "Equity", market: "US Equities" },
  { symbol: "NFLX",  assetClass: "Equity", market: "US Equities" },
  { symbol: "ORCL",  assetClass: "Equity", market: "US Equities" },
  { symbol: "CRM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "ADBE",  assetClass: "Equity", market: "US Equities" },
  { symbol: "AMD",   assetClass: "Equity", market: "US Equities" },
  { symbol: "AVGO",  assetClass: "Equity", market: "US Equities" },
  { symbol: "QCOM",  assetClass: "Equity", market: "US Equities" },
  { symbol: "INTC",  assetClass: "Equity", market: "US Equities" },
  { symbol: "MU",    assetClass: "Equity", market: "US Equities" },
  { symbol: "ARM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "MRVL",  assetClass: "Equity", market: "US Equities" },
  { symbol: "SMCI",  assetClass: "Equity", market: "US Equities" },
  // High-Growth & Momentum
  { symbol: "PLTR",  assetClass: "Equity", market: "US Equities" },
  { symbol: "COIN",  assetClass: "Equity", market: "US Equities" },
  { symbol: "HOOD",  assetClass: "Equity", market: "US Equities" },
  { symbol: "UBER",  assetClass: "Equity", market: "US Equities" },
  { symbol: "MSTR",  assetClass: "Equity", market: "US Equities" },
  { symbol: "RBLX",  assetClass: "Equity", market: "US Equities" },
  { symbol: "SHOP",  assetClass: "Equity", market: "US Equities" },
  { symbol: "SOFI",  assetClass: "Equity", market: "US Equities" },
  // Cybersecurity & Cloud
  { symbol: "CRWD",  assetClass: "Equity", market: "US Equities" },
  { symbol: "PANW",  assetClass: "Equity", market: "US Equities" },
  { symbol: "ZS",    assetClass: "Equity", market: "US Equities" },
  { symbol: "NET",   assetClass: "Equity", market: "US Equities" },
  { symbol: "DDOG",  assetClass: "Equity", market: "US Equities" },
  { symbol: "SNOW",  assetClass: "Equity", market: "US Equities" },
  // US Financials
  { symbol: "JPM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "BAC",   assetClass: "Equity", market: "US Equities" },
  { symbol: "GS",    assetClass: "Equity", market: "US Equities" },
  { symbol: "MS",    assetClass: "Equity", market: "US Equities" },
  { symbol: "V",     assetClass: "Equity", market: "US Equities" },
  { symbol: "MA",    assetClass: "Equity", market: "US Equities" },
  { symbol: "PYPL",  assetClass: "Equity", market: "US Equities" },
  // US Consumer & Healthcare
  { symbol: "AMGN",  assetClass: "Equity", market: "US Equities" },
  { symbol: "LLY",   assetClass: "Equity", market: "US Equities" },
  { symbol: "UNH",   assetClass: "Equity", market: "US Equities" },
  { symbol: "ABBV",  assetClass: "Equity", market: "US Equities" },
  { symbol: "COST",  assetClass: "Equity", market: "US Equities" },
  { symbol: "WMT",   assetClass: "Equity", market: "US Equities" },
  { symbol: "HD",    assetClass: "Equity", market: "US Equities" },
  // Energy & Industrials
  { symbol: "XOM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "CVX",   assetClass: "Equity", market: "US Equities" },
  { symbol: "CAT",   assetClass: "Equity", market: "US Equities" },
  { symbol: "GE",    assetClass: "Equity", market: "US Equities" },
  { symbol: "BA",    assetClass: "Equity", market: "US Equities" },
  // Entertainment & Media
  { symbol: "DIS",   assetClass: "Equity", market: "US Equities" },
  // Core ETFs — market regime & sector rotation
  { symbol: "SPY",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "QQQ",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "IWM",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "TLT",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "HYG",   assetClass: "ETF", market: "US ETFs" },  // high-yield credit spread
  { symbol: "EEM",   assetClass: "ETF", market: "US ETFs" },  // emerging markets
  // Sector ETFs
  { symbol: "XLK",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLE",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLF",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLV",   assetClass: "ETF", market: "US ETFs" },  // healthcare
  { symbol: "XLI",   assetClass: "ETF", market: "US ETFs" },  // industrials
  { symbol: "XLY",   assetClass: "ETF", market: "US ETFs" },  // consumer discretionary
  { symbol: "ARKK",  assetClass: "ETF", market: "US ETFs" },
  { symbol: "SOXX",  assetClass: "ETF", market: "US ETFs" },
  { symbol: "IBIT",  assetClass: "ETF", market: "US ETFs" },  // Bitcoin ETF
  // Commodities
  { symbol: "GLD",   assetClass: "ETF", market: "Commodities" },
  { symbol: "SLV",   assetClass: "ETF", market: "Commodities" },
  { symbol: "USO",   assetClass: "ETF", market: "Commodities" },
  // Global ADRs (US-listed)
  { symbol: "ASML",  assetClass: "Equity", market: "Europe/ADRs" },
  { symbol: "TSM",   assetClass: "Equity", market: "Asia/ADRs"   },
  { symbol: "NVO",   assetClass: "Equity", market: "Europe/ADRs" }, // Novo Nordisk (GLP-1)
  { symbol: "SAP",   assetClass: "Equity", market: "Europe/ADRs" },
  // Forex via currency ETFs (Wisdomtree + Invesco) — tracks spot FX, no leverage
  { symbol: "FXE",   assetClass: "ETF", market: "Forex ETFs" }, // EUR/USD
  { symbol: "FXB",   assetClass: "ETF", market: "Forex ETFs" }, // GBP/USD
  { symbol: "FXY",   assetClass: "ETF", market: "Forex ETFs" }, // JPY/USD
  { symbol: "FXA",   assetClass: "ETF", market: "Forex ETFs" }, // AUD/USD
  { symbol: "FXF",   assetClass: "ETF", market: "Forex ETFs" }, // CHF/USD
  { symbol: "UUP",   assetClass: "ETF", market: "Forex ETFs" }, // USD Index (bullish)
];
