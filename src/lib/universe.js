export const COLORS = {
  bg:      "#06060a",
  surface: "#0d0d16",
  card:    "#111120",
  border:  "#1c1c2e",
  accent:  "#00d4aa",
  gold:    "#f0b429",
  red:     "#ff4d6d",
  green:   "#00d4aa",
  text:    "#e8e8f8",
  muted:   "#5a5a7a",
  blue:    "#4d9fff",
  purple:  "#a78bfa",
  // gradients
  accentGrad: "linear-gradient(135deg, #00d4aa, #00b4d8)",
  goldGrad:   "linear-gradient(135deg, #f0b429, #f97316)",
  redGrad:    "linear-gradient(135deg, #ff4d6d, #e11d48)",
  purpleGrad: "linear-gradient(135deg, #a78bfa, #7c3aed)",
};

export const UNIVERSE = {
  "US Equities":  ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","JPM","V","XOM","UNH","BAC","AVGO","MA","AMD"],
  "US ETFs":      ["SPY","QQQ","IWM","GLD","TLT","XLK","XLE","XLF","ARKK","SOXX"],
  "Europe/ADRs":  ["ASML","SAP","TTE","SHEL","UL","NVO","AZN","BP","EADSY","SIE"],
  "Asia/ADRs":    ["TSM","BABA","SONY","TM","BIDU","SE","NIO","GRAB","HDB","INFY"],
  "Commodities":  ["GLD","SLV","USO","WEAT","CPER","UNG","DBA","PDBC"],
};

export const CRYPTO_SYMBOLS = [
  { symbol: "BINANCE:BTCUSDT", display: "BTC/USD" },
  { symbol: "BINANCE:ETHUSDT", display: "ETH/USD" },
  { symbol: "BINANCE:SOLUSDT", display: "SOL/USD" },
  { symbol: "BINANCE:BNBUSDT", display: "BNB/USD" },
  { symbol: "BINANCE:XRPUSDT", display: "XRP/USD" },
];

export const FOREX_PAIRS = ["EUR","GBP","JPY","AUD","CAD","CHF"];

export const TOP_N = 3; // top movers per category (Finnhub fallback)

// 45 equity/ETF symbols fetched via Alpaca batch snapshot when keys are available
export const ALPACA_SCAN_SYMBOLS = [
  // US Large Cap & Tech
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
  { symbol: "PLTR",  assetClass: "Equity", market: "US Equities" },
  { symbol: "COIN",  assetClass: "Equity", market: "US Equities" },
  { symbol: "HOOD",  assetClass: "Equity", market: "US Equities" },
  { symbol: "UBER",  assetClass: "Equity", market: "US Equities" },
  // US Financials & Diversified
  { symbol: "JPM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "BAC",   assetClass: "Equity", market: "US Equities" },
  { symbol: "V",     assetClass: "Equity", market: "US Equities" },
  { symbol: "MA",    assetClass: "Equity", market: "US Equities" },
  { symbol: "PYPL",  assetClass: "Equity", market: "US Equities" },
  { symbol: "UNH",   assetClass: "Equity", market: "US Equities" },
  { symbol: "XOM",   assetClass: "Equity", market: "US Equities" },
  { symbol: "DIS",   assetClass: "Equity", market: "US Equities" },
  { symbol: "SHOP",  assetClass: "Equity", market: "US Equities" },
  { symbol: "SOFI",  assetClass: "Equity", market: "US Equities" },
  // ETFs
  { symbol: "SPY",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "QQQ",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "IWM",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "TLT",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLK",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLE",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "XLF",   assetClass: "ETF", market: "US ETFs" },
  { symbol: "ARKK",  assetClass: "ETF", market: "US ETFs" },
  { symbol: "SOXX",  assetClass: "ETF", market: "US ETFs" },
  { symbol: "GLD",   assetClass: "ETF", market: "Commodities" },
  { symbol: "SLV",   assetClass: "ETF", market: "Commodities" },
  { symbol: "USO",   assetClass: "ETF", market: "Commodities" },
  { symbol: "IBIT",  assetClass: "ETF", market: "US ETFs" },
  // Global ADRs (US-listed)
  { symbol: "ASML",  assetClass: "Equity", market: "Europe/ADRs" },
  { symbol: "TSM",   assetClass: "Equity", market: "Asia/ADRs"   },
];
