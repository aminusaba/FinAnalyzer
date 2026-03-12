/**
 * reattach-exits.js
 * One-shot script to place OCO sell orders for open positions
 * whose bracket exit legs expired (stop-loss + take-profit).
 *
 * Usage:
 *   node reattach-exits.js --dry-run
 *   node reattach-exits.js
 *   node reattach-exits.js --stop-pct 5 --target-pct 10
 *
 * Stop and target are computed from avg_entry_price unless stored in DB.
 * Defaults: stop = 5% below entry, target = 10% above entry (2:1 R/R).
 */

import fs               from "node:fs";
import path             from "node:path";
import { fileURLToPath } from "node:url";
import { getAllPositionMeta } from "./server/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ─────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes("--dry-run");
const stopPct   = parseFloat(args[args.indexOf("--stop-pct")   + 1]) || 5;
const targetPct = parseFloat(args[args.indexOf("--target-pct") + 1]) || 10;

// ── Config ───────────────────────────────────────────────────────────────────

const config  = JSON.parse(fs.readFileSync(path.join(__dirname, "daemon-config.json"), "utf8"));
const BASE    = config.alpacaMode === "live"
  ? "https://api.alpaca.markets"
  : "https://paper-api.alpaca.markets";

const HEADERS = {
  "APCA-API-KEY-ID":     config.alpacaKey,
  "APCA-API-SECRET-KEY": config.alpacaSecret,
  "Content-Type":        "application/json",
};

async function alpacaGet(p) {
  const res  = await fetch(`${BASE}${p}`, { headers: HEADERS });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
  return data;
}

async function alpacaPost(p, body) {
  const res  = await fetch(`${BASE}${p}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Alpaca ${res.status}`);
  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n=== Reattach Exit Orders (${DRY_RUN ? "DRY RUN — " : ""}${config.alpacaMode?.toUpperCase()}) ===`);
  console.log(`    Stop: ${stopPct}% below entry  |  Target: ${targetPct}% above entry\n`);

  const meta      = getAllPositionMeta();
  const positions = await alpacaGet("/v2/positions");
  if (!positions.length) { console.log("No open positions on Alpaca."); return; }

  const openOrders     = await alpacaGet("/v2/orders?status=open&limit=500");
  const symbolsWithSell = new Set(
    openOrders.filter(o => o.side === "sell").map(o => o.symbol)
  );

  let placed = 0, skipped = 0;

  for (const pos of positions) {
    const sym   = pos.symbol;
    const qty   = parseFloat(pos.qty);
    const entry = parseFloat(pos.avg_entry_price);
    if (qty <= 0 || !entry) continue;

    if (symbolsWithSell.has(sym)) {
      console.log(`  SKIP  ${sym.padEnd(8)} — already has open sell order`);
      skipped++; continue;
    }

    // Use DB levels if available, otherwise compute from entry price
    const m = meta.find(r => r.symbol === sym);
    const stop   = m?.stop_price   ?? parseFloat((entry * (1 - stopPct   / 100)).toFixed(4));
    const target = m?.target_price ?? parseFloat((entry * (1 + targetPct / 100)).toFixed(4));
    const source = m?.stop_price ? "DB" : `entry $${entry.toFixed(2)}`;

    // Sanity: stop must be below current price, target above
    const current = parseFloat(pos.current_price || entry);
    if (stop >= current) {
      console.log(`  WARN  ${sym.padEnd(8)} — stop $${stop} >= current $${current.toFixed(2)}, skipping`);
      skipped++; continue;
    }
    if (target <= current) {
      console.log(`  WARN  ${sym.padEnd(8)} — target $${target} <= current $${current.toFixed(2)}, skipping`);
      skipped++; continue;
    }

    // OCO requires whole shares
    const wholeQty = Math.floor(qty);
    if (wholeQty < 1) {
      console.log(`  SKIP  ${sym.padEnd(8)} — qty ${qty} < 1 whole share`);
      skipped++; continue;
    }

    console.log(`  ORDER ${sym.padEnd(8)} qty=${wholeQty}  stop=$${stop}  target=$${target}  (from ${source})`);

    if (!DRY_RUN) {
      try {
        const order = await alpacaPost("/v2/orders", {
          symbol:        sym,
          qty:           String(wholeQty),
          side:          "sell",
          type:          "limit",
          time_in_force: "gtc",
          order_class:   "oco",
          take_profit:   { limit_price: target.toFixed(2) },
          stop_loss:     { stop_price:  stop.toFixed(2) },
        });
        console.log(`         → placed OCO ${order.id}`);
        placed++;
      } catch (err) {
        console.log(`         → ERROR: ${err.message}`);
      }
    } else {
      placed++;
    }
  }

  console.log(`\nDone. ${placed} order(s) ${DRY_RUN ? "would be placed" : "placed"}, ${skipped} skipped.\n`);
})();
