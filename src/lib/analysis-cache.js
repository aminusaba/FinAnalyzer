// Caches GPT analysis results per symbol to avoid re-analyzing recently seen symbols.
// TTL matches the auto-scan interval to ensure each symbol is only analyzed once per cycle.

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

function key(userKey) {
  return `finanalyzer_analysis_${userKey}`;
}

export function getCached(symbol, userKey, ttl = DEFAULT_TTL) {
  try {
    const cache = JSON.parse(localStorage.getItem(key(userKey)) || "{}");
    const entry = cache[symbol];
    if (entry && Date.now() - entry.ts < ttl) return entry.result;
  } catch {}
  return null;
}

export function setCache(symbol, result, userKey) {
  try {
    const k = key(userKey);
    const cache = JSON.parse(localStorage.getItem(k) || "{}");
    cache[symbol] = { result, ts: Date.now() };
    // Prune entries older than 2x TTL
    for (const sym of Object.keys(cache)) {
      if (Date.now() - cache[sym].ts > DEFAULT_TTL * 2) delete cache[sym];
    }
    localStorage.setItem(k, JSON.stringify(cache));
  } catch {}
}

export function clearCache(userKey) {
  localStorage.removeItem(key(userKey));
}
