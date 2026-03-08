import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Maps UI settings keys → daemon-config.json keys
function toDaemonConfig(s) {
  return {
    alpacaKey:            s.alpacaKey            ?? '',
    alpacaSecret:         s.alpacaSecret          ?? '',
    alpacaMode:           s.alpacaMode            ?? 'paper',
    telegramChatId:       s.telegramChatId        ?? '',
    walletSize:           s.walletSize            ?? 10000,
    intervalMinutes:      s.autoScanInterval      ?? 30,
    minScore:             s.minScore              ?? 75,
    minConviction:        s.minConviction         ?? 'HIGH',
    autoTradeEnabled:     s.autoTradeEnabled      ?? false,
    bracketOrdersEnabled: s.bracketOrdersEnabled  ?? true,
    tradingCapitalPct:    s.tradingCapitalPct      ?? 100,
  };
}

function daemonSyncPlugin() {
  return {
    name: 'daemon-sync',
    configureServer(server) {
      server.middlewares.use('/api/sync-daemon-config', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const settings   = JSON.parse(body);
            const configPath = path.join(process.cwd(), 'daemon-config.json');
            // Preserve daemon-only fields (maxSymbols etc.) not present in UI
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

export default defineConfig({
  plugins: [react(), daemonSyncPlugin()],
  server: {
    proxy: {
      '/mcp': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
