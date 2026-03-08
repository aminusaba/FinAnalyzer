const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY;
const MODEL = "gpt-4o";

const callGPT = async (prompt, maxTokens) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  return JSON.parse(match[0]);
};

export const analyzeSymbol = async ({ symbol, assetClass, market, price, change_pct }) => {
  const priceCtx = price ? `Live price: ${price}, 1-day change: ${(change_pct || 0).toFixed(2)}%.` : "";
  const prompt = `You are a senior portfolio analyst covering global markets.
Asset: ${symbol} | Class: ${assetClass} | Market: ${market}
${priceCtx}
Today: ${new Date().toISOString().slice(0, 10)}

Return ONLY valid JSON, no markdown:
{
  "symbol": "${symbol}",
  "assetClass": "${assetClass}",
  "sector": "<sector or macro theme>",
  "market": "${market}",
  "price": <number>,
  "change_pct": <number>,
  "trend": "up|down|sideways",
  "score": <0-100>,
  "signal": "BUY|SELL|HOLD|WATCH",
  "conviction": "HIGH|MEDIUM|LOW",
  "horizon": "swing|medium|long",
  "momentum": <0-100>,
  "risk_reward": <number>,
  "entry": <number>,
  "target": <number>,
  "stop": <number>,
  "allocation_pct": <1-10>,
  "investor_thesis": "<2-3 sentence long-term investment case>",
  "swing_thesis": "<1-2 sentence short-term trade rationale>",
  "sentiment": "bullish|neutral|bearish",
  "prices": [<array of 15 estimated recent daily closes as numbers>]
}`;
  return callGPT(prompt, 700);
};

export const deepDiveSymbol = async (sym) => {
  const prompt = `You are a senior portfolio manager. Deep analysis of ${sym.symbol}.
Price: ${sym.price} | Signal: ${sym.signal} | Score: ${sym.score} | Conviction: ${sym.conviction}
Asset class: ${sym.assetClass} | Sector: ${sym.sector} | Horizon: ${sym.horizon}

Return ONLY valid JSON, no markdown:
{
  "overview": "<3-4 sentence market overview>",
  "fundamental": "<3-4 sentence analysis of earnings, valuation, balance sheet>",
  "technical": "<3-4 sentence technical analysis>",
  "macro_context": "<3-4 sentence macro environment, rates, sector rotation>",
  "catalysts": ["<c1>","<c2>","<c3>"],
  "risks": ["<r1>","<r2>"],
  "investor_plan": "<3-5 sentence long-term position building strategy>",
  "swing_plan": "<2-3 sentence short-term trade plan with entry/target/stop rationale>",
  "portfolio_note": "<2 sentence note on how this fits in a diversified portfolio>",
  "confidence": <1-10>
}`;
  return callGPT(prompt, 900);
};
