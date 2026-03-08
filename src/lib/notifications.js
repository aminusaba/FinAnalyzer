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
  const { symbol, signal, score, conviction, assetClass, investor_thesis, target, stop } = result;
  const emoji = signal === "BUY" ? "🟢" : signal === "SELL" ? "🔴" : "🟡";
  const text = `${emoji} <b>${signal}: ${symbol}</b> [${assetClass}]\nScore: ${score} | Conviction: ${conviction}\nTarget: ${target} | Stop: ${stop}\n\n${investor_thesis}`;
  return tgSend(chatId, text);
};

export const sendOrderFill = async (settings, { symbol, side, notional, stop, target, bracket }) => {
  if (!settings.telegramEnabled || !settings.telegramChatId) return;
  const emoji = side === "buy" ? "🛒" : "📤";
  const bracketNote = bracket ? `\nSL: ${stop} | TP: ${target}` : "";
  const text = `${emoji} <b>Order placed: ${side.toUpperCase()} ${symbol}</b>\nAmount: $${Number(notional).toFixed(2)}${bracketNote}`;
  return tgSend(settings.telegramChatId, text);
};

export const sendAlerts = async (result, settings) => {
  const { signal, score, conviction } = result;
  const meetsThreshold =
    signal === "BUY" &&
    score >= settings.minScore &&
    (settings.minConviction === "ANY" || conviction === "HIGH");

  if (!meetsThreshold) return;

  if (settings.browserEnabled && Notification.permission === "granted") {
    new Notification(`${signal}: ${result.symbol}`, {
      body: `Score: ${score} | Conviction: ${conviction} | Target: ${result.target}`,
    });
  }

  if (settings.telegramEnabled && settings.telegramChatId) {
    await sendTelegram(settings.telegramChatId, result);
  }
};
