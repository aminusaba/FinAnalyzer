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

export const TOP_N = 3; // top movers per category
