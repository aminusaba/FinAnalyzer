/**
 * Browser-side DB client — talks to the SQLite API served by the Vite plugin.
 * All functions are async and return plain JS objects, same interface as before.
 */

const API = '/api/db';

async function get(path, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}?${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path, body, method = 'POST') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Scan results ──────────────────────────────────────────────────────────────

// Load results for the user AND the daemon, merging them (user's own results win)
export async function loadScanResults(userKey) {
  const [mine, daemon] = await Promise.all([
    get('/scan-results', { userKey }),
    get('/scan-results', { userKey: 'daemon' }),
  ]);
  const map = new Map();
  for (const r of daemon) map.set(r.symbol, r); // daemon first (lower priority)
  for (const r of mine)   map.set(r.symbol, r); // browser scan overwrites
  return [...map.values()];
}

export const upsertScanResult = (result, userKey)      => post('/scan-results', { result, userKey }, 'PUT');
export const pruneScanResults = (keepSymbols, userKey) => post('/scan-results/prune', { keepSymbols, userKey });

// ── Scan runs ─────────────────────────────────────────────────────────────────

// Merge browser + daemon scan runs sorted by timestamp descending
export async function loadScanRuns(userKey, limit = 50) {
  const [mine, daemon] = await Promise.all([
    get('/scan-runs', { userKey, limit }),
    get('/scan-runs', { userKey: 'daemon', limit }),
  ]);
  const merged = [...mine, ...daemon]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  return merged;
}

export const addScanRun = (results, userKey, settings) => post('/scan-runs', { results, userKey, settings });

// ── Trades ────────────────────────────────────────────────────────────────────

// Merge browser + daemon trades sorted by placedAt descending
export async function loadTrades(userKey, limit = 200) {
  const [mine, daemon] = await Promise.all([
    get('/trades', { userKey, limit }),
    get('/trades', { userKey: 'daemon', limit }),
  ]);
  return [...mine, ...daemon]
    .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
    .slice(0, limit);
}

export const addTrade = (trade, userKey) => post('/trades', { trade, userKey });

// ── Scan progress ─────────────────────────────────────────────────────────────

export async function getScanProgress() {
  return get('/scan-progress', {});
}

// Returns true if the daemon has run within the last 2 hours
export async function isDaemonActive() {
  try {
    const runs = await get('/scan-runs', { userKey: 'daemon', limit: 1 });
    if (!runs.length) return false;
    const lastRun = new Date(runs[0].timestamp);
    return (Date.now() - lastRun.getTime()) < 2 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function loadSignalPerformance() {
  try {
    const res = await fetch('/api/db/signal-performance');
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// Returns true if the daemon heartbeat is within the last 3 minutes
export async function isDaemonAlive() {
  try {
    const hb = await get('/daemon-heartbeat', {});
    if (!hb?.ts) return false;
    // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" — convert to ISO 8601 for reliable parsing
    const iso = hb.ts.replace(' ', 'T') + 'Z';
    return (Date.now() - new Date(iso).getTime()) < 3 * 60 * 1000;
  } catch {
    return isDaemonActive();
  }
}
