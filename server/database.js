/**
 * SQLite database layer — runs in Node.js only (Vite plugin + daemon).
 * Uses the built-in node:sqlite module (Node 22.5+ / Node 24 stable).
 * DB file: finanalyzer.db in the project root.
 */

import { DatabaseSync } from 'node:sqlite';
import path             from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, '..', 'finanalyzer.db');

let _db;
function db() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA journal_mode = WAL');   // concurrent reads while daemon writes
    _db.exec('PRAGMA foreign_keys = ON');
    initSchema();
  }
  return _db;
}

function initSchema() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS scan_progress (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      status        TEXT NOT NULL DEFAULT 'idle',
      current_sym   TEXT,
      scanned_count INTEGER DEFAULT 0,
      total_count   INTEGER DEFAULT 0,
      started_at    TEXT,
      updated_at    TEXT NOT NULL
    );
    INSERT OR IGNORE INTO scan_progress (id, status, updated_at) VALUES (1, 'idle', datetime('now'));

    CREATE TABLE IF NOT EXISTS scan_results (
      symbol      TEXT NOT NULL,
      user_key    TEXT NOT NULL,
      signal      TEXT,
      score       INTEGER,
      asset_class TEXT,
      scanned_at  TEXT,
      data        TEXT NOT NULL,
      PRIMARY KEY (symbol, user_key)
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key     TEXT NOT NULL,
      timestamp    TEXT NOT NULL,
      symbol_count INTEGER DEFAULT 0,
      alert_count  INTEGER DEFAULT 0,
      data         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_key    TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      side        TEXT NOT NULL,
      notional    REAL,
      asset_class TEXT,
      placed_at   TEXT NOT NULL,
      data        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS position_meta (
      symbol        TEXT PRIMARY KEY,
      entry_price   REAL NOT NULL,
      entry_date    TEXT NOT NULL,
      target_price  REAL,
      stop_price    REAL,
      high_water    REAL,
      trailing_stop REAL,
      bracket       INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daemon_logs (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      ts    TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      msg   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daemon_heartbeat (
      id  INTEGER PRIMARY KEY CHECK (id = 1),
      ts  TEXT NOT NULL,
      pid INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sr_user   ON scan_results(user_key);
    CREATE INDEX IF NOT EXISTS idx_runs_user ON scan_runs(user_key, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_tr_user   ON trades(user_key, placed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dl_ts     ON daemon_logs(id DESC);
  `);
  // Safe migration — add signal metadata columns to trades (ignored if already exist)
  for (const stmt of [
    'ALTER TABLE trades ADD COLUMN signal_score     INTEGER',
    'ALTER TABLE trades ADD COLUMN signal_conviction TEXT',
    'ALTER TABLE trades ADD COLUMN ai_model          TEXT',
  ]) { try { _db.exec(stmt); } catch {} }
}

// ── Scan results ──────────────────────────────────────────────────────────────

export function loadScanResults(userKey) {
  return db()
    .prepare('SELECT data FROM scan_results WHERE user_key = ?')
    .all(userKey)
    .map(r => JSON.parse(r.data));
}

export function upsertScanResult(result, userKey) {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO scan_results (symbol, user_key, signal, score, asset_class, scanned_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, user_key) DO UPDATE SET
      signal = excluded.signal, score = excluded.score,
      asset_class = excluded.asset_class, scanned_at = excluded.scanned_at,
      data = excluded.data
  `).run(
    result.symbol, userKey,
    result.signal ?? null, result.score ?? null, result.assetClass ?? null,
    now, JSON.stringify({ ...result, userKey, scannedAt: now })
  );
}

export function pruneScanResults(keepSymbols, userKey) {
  if (!keepSymbols.length) return;
  const placeholders = keepSymbols.map(() => '?').join(',');
  db()
    .prepare(`DELETE FROM scan_results WHERE user_key = ? AND symbol NOT IN (${placeholders})`)
    .run(userKey, ...keepSymbols);
}

// ── Scan runs ─────────────────────────────────────────────────────────────────

export function addScanRun(results, userKey, settings, durationMs = null) {
  const entry = {
    userKey,
    timestamp: new Date().toISOString(),
    durationMs,
    results: results.map(r => ({
      symbol:          r.symbol,
      assetClass:      r.assetClass,
      signal:          r.signal,
      conviction:      r.conviction,
      score:           r.score,
      investor_thesis: r.investor_thesis,
    })),
    alerts: results
      .filter(r => r.signal === 'BUY' && r.score >= (settings?.minScore ?? 75))
      .map(r => r.symbol),
  };
  db().prepare(`
    INSERT INTO scan_runs (user_key, timestamp, symbol_count, alert_count, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(userKey, entry.timestamp, entry.results.length, entry.alerts.length, JSON.stringify(entry));
}

export function loadScanRuns(userKey, limit = 50) {
  return db()
    .prepare('SELECT data FROM scan_runs WHERE user_key = ? ORDER BY timestamp DESC LIMIT ?')
    .all(userKey, limit)
    .map(r => JSON.parse(r.data));
}

// ── Trades ────────────────────────────────────────────────────────────────────

export function addTrade(trade, userKey) {
  const now   = new Date().toISOString();
  const entry = { ...trade, userKey, placedAt: now };
  db().prepare(`
    INSERT INTO trades (user_key, symbol, side, notional, asset_class, signal_score, signal_conviction, ai_model, placed_at, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userKey, trade.symbol, trade.side,
    trade.notional ?? null, trade.assetClass ?? null,
    trade.signalScore ?? null, trade.signalConviction ?? null, trade.aiModel ?? null,
    now, JSON.stringify(entry)
  );
}

// ── Position meta (trailing stop / profit target / age tracking) ──────────────

export function upsertPositionMeta(symbol, meta) {
  db().prepare(`
    INSERT INTO position_meta (symbol, entry_price, entry_date, target_price, stop_price, high_water, trailing_stop, bracket)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      entry_price   = excluded.entry_price,
      entry_date    = excluded.entry_date,
      target_price  = excluded.target_price,
      stop_price    = excluded.stop_price,
      high_water    = excluded.high_water,
      trailing_stop = excluded.trailing_stop,
      bracket       = excluded.bracket
  `).run(
    symbol,
    meta.entryPrice, meta.entryDate,
    meta.targetPrice  ?? null, meta.stopPrice ?? null,
    meta.highWater    ?? meta.entryPrice,
    meta.trailingStop ?? null,
    meta.bracket ? 1 : 0,
  );
}

export function updatePositionHighWater(symbol, highWater, trailingStop) {
  db().prepare('UPDATE position_meta SET high_water = ?, trailing_stop = ? WHERE symbol = ?')
    .run(highWater, trailingStop, symbol);
}

export function getAllPositionMeta() {
  return db().prepare('SELECT * FROM position_meta').all();
}

export function deletePositionMeta(symbol) {
  db().prepare('DELETE FROM position_meta WHERE symbol = ?').run(symbol);
}

export function loadTrades(userKey, limit = 200) {
  return db()
    .prepare('SELECT data FROM trades WHERE user_key = ? ORDER BY placed_at DESC LIMIT ?')
    .all(userKey, limit)
    .map(r => JSON.parse(r.data));
}

// ── Scan progress (daemon → browser live feed) ────────────────────────────────

export function setScanProgress({ status, currentSym = null, scannedCount = 0, totalCount = 0, startedAt = null }) {
  const now = new Date().toISOString();
  db().prepare(`
    INSERT INTO scan_progress (id, status, current_sym, scanned_count, total_count, started_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status        = excluded.status,
      current_sym   = excluded.current_sym,
      scanned_count = excluded.scanned_count,
      total_count   = excluded.total_count,
      started_at    = COALESCE(excluded.started_at, started_at),
      updated_at    = excluded.updated_at
  `).run(status, currentSym, scannedCount, totalCount, startedAt, now);
}

export function getScanProgress() {
  return db().prepare('SELECT * FROM scan_progress WHERE id = 1').get() ?? null;
}

// ── Daemon logs ───────────────────────────────────────────────────────────────

export function addDaemonLog(level, msg) {
  const ts = new Date().toISOString();
  db().prepare('INSERT INTO daemon_logs (ts, level, msg) VALUES (?, ?, ?)').run(ts, level, String(msg).slice(0, 4000));
  // Keep last 5000 entries
  db().prepare('DELETE FROM daemon_logs WHERE id NOT IN (SELECT id FROM daemon_logs ORDER BY id DESC LIMIT 5000)').run();
}

export function getDaemonLogs(limit = 300) {
  return db().prepare('SELECT id, ts, level, msg FROM daemon_logs ORDER BY id DESC LIMIT ?').all(limit);
}

export function clearDaemonLogs() {
  db().exec('DELETE FROM daemon_logs');
}

// ── Daemon heartbeat ──────────────────────────────────────────────────────────

export function upsertDaemonHeartbeat(pid) {
  db().prepare(`
    INSERT INTO daemon_heartbeat (id, ts, pid) VALUES (1, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET ts = datetime('now'), pid = excluded.pid
  `).run(pid);
}

export function getDaemonHeartbeat() {
  return db().prepare('SELECT ts, pid FROM daemon_heartbeat WHERE id = 1').get() ?? null;
}

// ── Signal performance stats ───────────────────────────────────────────────────

export function loadSignalPerformance() {
  const rows = db()
    .prepare(`SELECT side, notional, signal_score, signal_conviction, ai_model, placed_at
              FROM trades WHERE signal_score IS NOT NULL ORDER BY placed_at DESC LIMIT 500`)
    .all();
  const buys = rows.filter(r => r.side === 'buy');
  const byModel = {};
  const byScore = { '90+': 0, '80-89': 0, '70-79': 0, '<70': 0 };
  for (const row of buys) {
    const model = row.ai_model || 'unknown';
    if (!byModel[model]) byModel[model] = { count: 0, totalNotional: 0 };
    byModel[model].count++;
    byModel[model].totalNotional = +(( byModel[model].totalNotional + (row.notional || 0))).toFixed(2);
    const bucket = row.signal_score >= 90 ? '90+' : row.signal_score >= 80 ? '80-89' : row.signal_score >= 70 ? '70-79' : '<70';
    byScore[bucket]++;
  }
  return { totalTrades: rows.length, totalBuys: buys.length, byModel, byScore };
}

// ── Account reset ─────────────────────────────────────────────────────────────

export function resetAccountData({ clearTrades = true, clearHistory = false } = {}) {
  db().exec('DELETE FROM position_meta');
  if (clearTrades)   db().exec('DELETE FROM trades');
  if (clearHistory)  { db().exec('DELETE FROM scan_runs'); db().exec('DELETE FROM scan_results'); }
}
