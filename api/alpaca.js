// Vercel serverless proxy — forwards requests to Alpaca REST API
// Avoids CORS issues and keeps credentials out of browser network logs

export default async function handler(req, res) {
  const { path, mode } = req.query;
  if (!path) return res.status(400).json({ message: "Missing path" });

  const key = req.headers["apca-api-key-id"];
  const secret = req.headers["apca-api-secret-key"];
  if (!key || !secret) return res.status(400).json({ message: "Missing Alpaca credentials" });

  const base =
    mode === "live"
      ? "https://api.alpaca.markets"
      : "https://paper-api.alpaca.markets";

  const hasBody = req.method !== "GET" && req.method !== "DELETE" && req.body;

  const upstream = await fetch(`${base}${path}`, {
    method: req.method,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    },
    body: hasBody ? JSON.stringify(req.body) : undefined,
  });

  const data = await upstream.json().catch(() => ({}));
  res.status(upstream.status).json(data);
}
