import { UNIVERSE, CRYPTO_SYMBOLS, FOREX_PAIRS, TOP_N } from "./universe.js";

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY;

const fetchQuote = async (symbol) => {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d && d.c) return { price: d.c, change_pct: d.dp, change: d.d };
  } catch {}
  return null;
};

const fetchCryptoQuote = async ({ symbol, display }) => {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 86400 * 2;
    const r = await fetch(`https://finnhub.io/api/v1/crypto/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (d && d.s === "ok" && d.c?.length >= 2) {
      const price = d.c[d.c.length - 1];
      const prev = d.c[d.c.length - 2];
      const change_pct = ((price - prev) / prev) * 100;
      return { symbol: display, price, change_pct, assetClass: "Crypto", market: "Crypto" };
    }
  } catch {}
  return null;
};

const fetchForexQuotes = async () => {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/forex/rates?base=USD&token=${FINNHUB_KEY}`);
    const d = await r.json();
    if (!d?.quote) return [];
    return FOREX_PAIRS.map(currency => {
      const rate = d.quote[currency];
      if (!rate) return null;
      return {
        symbol: `${currency}/USD`,
        price: parseFloat((1 / rate).toFixed(5)),
        change_pct: 0,
        assetClass: "Forex",
        market: "Forex",
      };
    }).filter(Boolean);
  } catch {}
  return [];
};

export const fetchTopMovers = async () => {
  const results = [];

  // Fetch US equities, ETFs, Europe/Asia ADRs, Commodities in parallel per category
  for (const [category, symbols] of Object.entries(UNIVERSE)) {
    const quotes = await Promise.all(
      symbols.map(async (symbol) => {
        const q = await fetchQuote(symbol);
        if (!q) return null;
        const assetClass = category === "US ETFs" ? "ETF"
          : category === "Commodities" ? "Commodity"
          : category.includes("Europe") ? "Europe"
          : category.includes("Asia") ? "Asia"
          : "Equity";
        return { symbol, price: q.price, change_pct: q.change_pct, assetClass, market: category };
      })
    );
    const topMovers = quotes
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, TOP_N);
    results.push(...topMovers);
  }

  // Fetch crypto
  const cryptoQuotes = await Promise.all(CRYPTO_SYMBOLS.map(fetchCryptoQuote));
  const topCrypto = cryptoQuotes
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, TOP_N);
  results.push(...topCrypto);

  // Fetch forex
  const forexQuotes = await fetchForexQuotes();
  results.push(...forexQuotes.slice(0, TOP_N));

  return results;
};
