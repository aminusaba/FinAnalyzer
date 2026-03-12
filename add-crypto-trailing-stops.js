/**
 * One-off script: places Alpaca trailing stop orders on all open crypto positions.
 * Run once: node add-crypto-trailing-stops.js
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config    = JSON.parse(fs.readFileSync(path.join(__dirname, "daemon-config.json"), "utf8"));

const BASE      = config.alpacaMode === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
const TRAIL_PCT = config.cryptoTrailingStopPct ?? 3;

const headers = {
  "APCA-API-KEY-ID":     config.alpacaKey,
  "APCA-API-SECRET-KEY": config.alpacaSecret,
  "Content-Type":        "application/json",
};

async function get(url) {
  const res  = await fetch(`${BASE}${url}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function post(url, body) {
  const res  = await fetch(`${BASE}${url}`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// Fetch open orders so we can skip symbols that already have a trailing stop
async function getOpenOrders() {
  const orders = await get("/v2/orders?status=open&limit=500");
  return new Set(
    orders
      .filter(o => (o.type === "trailing_stop" || o.type === "stop_limit") && o.side === "sell")
      .map(o => o.symbol)
  );
}

async function main() {
  console.log(`Mode: ${config.alpacaMode} | Trail: ${TRAIL_PCT}%\n`);

  const [positions, existingTrailStops] = await Promise.all([
    get("/v2/positions"),
    getOpenOrders(),
  ]);

  const cryptoPositions = positions.filter(p => p.asset_class === "crypto");

  if (!cryptoPositions.length) {
    console.log("No open crypto positions found.");
    return;
  }

  console.log(`Found ${cryptoPositions.length} crypto position(s). Checking for existing trailing stops...\n`);

  for (const p of cryptoPositions) {
    const symbol = p.symbol;
    const qty    = p.qty;

    if (existingTrailStops.has(symbol)) {
      console.log(`  ⏭  ${symbol}: trailing stop already exists — skipping`);
      continue;
    }

    try {
      const currentPrice = parseFloat(p.current_price);
      const stopPrice    = +(currentPrice * (1 - TRAIL_PCT / 100)).toFixed(4);
      const limitPrice   = +(stopPrice * 0.995).toFixed(4); // 0.5% below stop to ensure fill

      await post("/v2/orders", {
        symbol,
        qty,
        side:           "sell",
        type:           "stop_limit",
        time_in_force:  "gtc",
        stop_price:     stopPrice.toFixed(4),
        limit_price:    limitPrice.toFixed(4),
      });
      console.log(`  ✅ ${symbol}: stop_limit placed · qty=${qty} · stop=$${stopPrice} · limit=$${limitPrice} (current=$${currentPrice})`);
    } catch (e) {
      console.log(`  ❌ ${symbol}: failed — ${e.message}`);
    }
  }

  console.log("\nDone.");
}

main().catch(e => { console.error(e.message); process.exit(1); });
