const TELEGRAM_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;

async function tgSend(chatId, text) {
  if (!chatId || !TELEGRAM_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text }),
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

export const sendTelegram = async (chatId, result) => {
  const { symbol, signal, score, conviction, assetClass, market, sector, investor_thesis, swing_thesis, target, stop } = result;
  const emoji = signal === "BUY" ? "🟢" : signal === "SELL" ? "🔴" : "🟡";
  const text =
    `${emoji} <b>${signal}: ${symbol}</b> [${market || assetClass}]\n` +
    `📊 Score: ${score} | Conviction: ${conviction}\n` +
    (sector ? `🏷 Sector: ${sector}\n` : "") +
    (target  ? `🎯 Target: ${target} | 🛑 Stop: ${stop}\n` : "") +
    (swing_thesis || investor_thesis ? `\n💡 ${(swing_thesis || investor_thesis || "").slice(0, 300)}` : "");
  return tgSend(chatId, text);
};

export const sendOrderFill = async (settings, { symbol, side, notional, stop, target, bracket }) => {
  if (!settings.telegramEnabled || !settings.telegramChatId) return;
  const emoji = side === "buy" ? "🛒" : "📤";
  const bracketNote = bracket && stop && target ? `\nSL: $${Number(stop).toFixed(2)} | TP: $${Number(target).toFixed(2)}` : "";
  const text = `${emoji} <b>Order placed: ${side.toUpperCase()} ${symbol}</b>\nAmount: $${Number(notional).toFixed(2)}${bracketNote}`;
  return tgSend(settings.telegramChatId, text);
};

function isUSMarketOpenNow() {
  const now = new Date();
  if (now.getDay() === 0 || now.getDay() === 6) return false;
  const et   = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins < 960; // 9:30 AM–4:00 PM ET
}

export const sendAlerts = async (result, settings) => {
  const { signal, score, conviction, assetClass } = result;
  const meetsThreshold =
    signal === "BUY" &&
    score >= settings.minScore &&
    (settings.minConviction === "ANY" || conviction === "HIGH");

  if (!meetsThreshold) return;

  // Suppress BUY alerts outside market hours — crypto exempt (trades 24/7)
  const isCrypto = assetClass === "Crypto";
  if (!isCrypto && !isUSMarketOpenNow()) return;

  if (settings.browserEnabled && Notification.permission === "granted") {
    new Notification(`${signal}: ${result.symbol}`, {
      body: `Score: ${score} | Conviction: ${conviction} | Target: ${result.target}`,
    });
  }

  if (settings.telegramEnabled && settings.telegramChatId) {
    await sendTelegram(settings.telegramChatId, result);
  }
};
