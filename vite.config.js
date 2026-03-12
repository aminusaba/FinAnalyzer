import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import * as sqliteDb from './server/database.js';

// Maps UI settings keys → daemon-config.json keys
function toDaemonConfig(s) {
  return {
    alpacaKey:            s.alpacaKey            ?? '',
    alpacaSecret:         s.alpacaSecret          ?? '',
    alpacaMode:           s.alpacaMode            ?? 'paper',
    telegramChatId:       s.telegramChatId        ?? '',
    intervalMinutes:      s.autoScanInterval      ?? 30,
    maxSymbols:           s.maxSymbols            ?? 60,
    minScore:             s.minScore              ?? 75,
    minConviction:        s.minConviction         ?? 'HIGH',
    autoTradeEnabled:     s.autoTradeEnabled      ?? false,
    bracketOrdersEnabled: s.bracketOrdersEnabled  ?? true,
    tradingCapitalPct:       s.tradingCapitalPct       ?? 100,
    reservePct:              s.reservePct              ?? 0,
    cryptoMinScore:          s.cryptoMinScore          ?? 80,
    cryptoMinConviction:     s.cryptoMinConviction     ?? 'HIGH',
    cryptoFearGreedMaxBuy:   s.cryptoFearGreedMaxBuy   ?? 80,
    cryptoCapitalPct:        s.cryptoCapitalPct        ?? 10,
    cryptoTrailingStopPct:   s.cryptoTrailingStopPct   ?? 3,
    aiModel:                 s.aiModel                  ?? 'o4-mini',
    regimeGateEnabled:       s.regimeGateEnabled      ?? false,
    earningsBlackoutDays:    s.earningsBlackoutDays   ?? 2,
    maxSectorExposurePct:    s.maxSectorExposurePct   ?? 25,
    weeklyTrendGateEnabled:  s.weeklyTrendGateEnabled ?? false,
    premarketScanEnabled: s.premarketScanEnabled ?? true,
    dailyLossLimitPct:    s.dailyLossLimitPct    ?? 3,
    maxOpenPositions:     s.maxOpenPositions      ?? 20,
  };
}

// Maps daemon-config.json keys → UI settings keys (reverse of above)
function fromDaemonConfig(d) {
  return {
    alpacaKey:            d.alpacaKey            ?? '',
    alpacaSecret:         d.alpacaSecret          ?? '',
    alpacaMode:           d.alpacaMode            ?? 'paper',
    telegramChatId:       d.telegramChatId        ?? '',
    autoScanInterval:     d.intervalMinutes       ?? 30,
    maxSymbols:           d.maxSymbols            ?? 60,
    minScore:             d.minScore              ?? 75,
    minConviction:        d.minConviction         ?? 'HIGH',
    autoTradeEnabled:     d.autoTradeEnabled      ?? false,
    bracketOrdersEnabled: d.bracketOrdersEnabled  ?? true,
    tradingCapitalPct:       d.tradingCapitalPct       ?? 100,
    reservePct:              d.reservePct              ?? 0,
    cryptoMinScore:          d.cryptoMinScore          ?? 80,
    cryptoMinConviction:     d.cryptoMinConviction     ?? 'HIGH',
    cryptoFearGreedMaxBuy:   d.cryptoFearGreedMaxBuy   ?? 80,
    cryptoCapitalPct:        d.cryptoCapitalPct        ?? 10,
    cryptoTrailingStopPct:   d.cryptoTrailingStopPct   ?? 3,
    aiModel:                 d.aiModel                  ?? 'o4-mini',
    regimeGateEnabled:       d.regimeGateEnabled      ?? false,
    earningsBlackoutDays:    d.earningsBlackoutDays   ?? 2,
    maxSectorExposurePct:    d.maxSectorExposurePct   ?? 25,
    weeklyTrendGateEnabled:  d.weeklyTrendGateEnabled ?? false,
    premarketScanEnabled: d.premarketScanEnabled ?? true,
    dailyLossLimitPct:    d.dailyLossLimitPct    ?? 3,
    maxOpenPositions:     d.maxOpenPositions      ?? 20,
  };
}

function daemonSyncPlugin() {
  return {
    name: 'daemon-sync',
    configureServer(server) {
      server.middlewares.use('/api/sync-daemon-config', (req, res) => {
        const configPath = path.join(process.cwd(), 'daemon-config.json');

        // GET — return current daemon config translated to UI settings keys
        if (req.method === 'GET') {
          try {
            const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(fromDaemonConfig(existing)));
          } catch {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({}));
          }
          return;
        }

        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const settings = JSON.parse(body);
            // Preserve any daemon-only fields not covered by toDaemonConfig
            let existing = {};
            try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
            const merged = { ...existing, ...toDaemonConfig(settings) };
            fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

function signalPerformancePlugin() {
  return {
    name: 'signal-performance',
    configureServer(server) {
      server.middlewares.use('/api/db/signal-performance', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        try {
          const stats = sqliteDb.loadSignalPerformance();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(stats));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

function sqlitePlugin() {
  return {
    name: 'sqlite-api',
    configureServer(server) {
      // Helper: read JSON body then call handler
      const json = (req, res, fn) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const ok = (data) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
            const err = (e, code=500) => { res.statusCode=code; res.end(JSON.stringify({error:e?.message||e})); };
            fn(body ? JSON.parse(body) : {}, ok, err);
          } catch(e) { res.statusCode=400; res.end(JSON.stringify({error:e.message})); }
        });
      };

      server.middlewares.use('/api/db', (req, res, next) => {
        const url = req.url.split('?')[0];
        const qs  = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));

        try {
          // Scan results
          if (url === '/scan-results' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.loadScanResults(qs.userKey)));

          if (url === '/scan-results' && req.method === 'PUT')
            return json(req, res, ({result, userKey}, ok) => { sqliteDb.upsertScanResult(result, userKey); ok({ok:true}); });

          if (url === '/scan-results/prune' && req.method === 'POST')
            return json(req, res, ({keepSymbols, userKey}, ok) => { sqliteDb.pruneScanResults(keepSymbols, userKey); ok({ok:true}); });

          // Scan runs
          if (url === '/scan-runs' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.loadScanRuns(qs.userKey, parseInt(qs.limit)||50)));

          if (url === '/scan-runs' && req.method === 'POST')
            return json(req, res, ({results, userKey, settings}, ok) => { sqliteDb.addScanRun(results, userKey, settings); ok({ok:true}); });

          // Trades
          if (url === '/trades' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.loadTrades(qs.userKey, parseInt(qs.limit)||200)));

          if (url === '/trades' && req.method === 'POST')
            return json(req, res, ({trade, userKey}, ok) => { sqliteDb.addTrade(trade, userKey); ok({ok:true}); });

          // Scan progress (daemon live feed)
          if (url === '/scan-progress' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.getScanProgress() ?? { status: 'idle', scanned_count: 0, total_count: 0, current_sym: null }));

          // Daemon logs
          if (url === '/daemon-logs' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.getDaemonLogs(parseInt(qs.limit)||300)));

          if (url === '/daemon-logs' && req.method === 'DELETE')
            return json(req, res, (_, ok) => { sqliteDb.clearDaemonLogs(); ok({ok:true}); });

          // Daemon heartbeat
          if (url === '/daemon-heartbeat' && req.method === 'GET')
            return json(req, res, (_, ok) => ok(sqliteDb.getDaemonHeartbeat() ?? null));

          // Account reset
          if (url === '/reset-account' && req.method === 'POST')
            return json(req, res, ({clearTrades, clearHistory}, ok) => {
              sqliteDb.resetAccountData({ clearTrades, clearHistory });
              ok({ ok: true });
            });

          next();
        } catch(e) { res.statusCode=500; res.end(JSON.stringify({error:e.message})); }
      });
    },
  };
}

function avMcpProxyPlugin() {
  return {
    name: 'av-mcp-proxy',
    configureServer(server) {
      const AV_KEY = process.env.VITE_ALPHA_VANTAGE_KEY;
      server.middlewares.use('/av-mcp', async (req, res) => {
        if (!AV_KEY) { res.statusCode = 503; res.end(JSON.stringify({ error: 'VITE_ALPHA_VANTAGE_KEY not set' })); return; }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const upstream = await fetch(`https://mcp.alphavantage.co/mcp?apikey=${AV_KEY}`, {
              method: 'POST',
              headers: {
                'Content-Type':  req.headers['content-type']  || 'application/json',
                'Accept':        req.headers['accept']        || 'application/json, text/event-stream',
                ...(req.headers['mcp-session-id'] ? { 'Mcp-Session-Id': req.headers['mcp-session-id'] } : {}),
              },
              body,
            });
            const sessionId = upstream.headers.get('Mcp-Session-Id');
            if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);
            res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
            res.statusCode = upstream.status;
            const buf = await upstream.arrayBuffer();
            res.end(Buffer.from(buf));
          } catch (e) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), daemonSyncPlugin(), signalPerformancePlugin(), sqlitePlugin(), avMcpProxyPlugin()],
  server: {
    host: '0.0.0.0',
    port: 80,
    allowedHosts: ['finanalyzer', 'localhost'],
    proxy: {
      '/mcp':          { target: 'http://localhost:8000', changeOrigin: true, headers: { origin: 'http://localhost:8000', host: 'localhost:8000' } },
      '/alpaca-paper': { target: 'https://paper-api.alpaca.markets',    changeOrigin: true, rewrite: p => p.replace(/^\/alpaca-paper/, '') },
      '/alpaca-live':  { target: 'https://api.alpaca.markets',          changeOrigin: true, rewrite: p => p.replace(/^\/alpaca-live/,  '') },
      '/alpaca-data':  { target: 'https://data.alpaca.markets',         changeOrigin: true, rewrite: p => p.replace(/^\/alpaca-data/,  '') },
    },
  },
});
