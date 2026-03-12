/**
 * Opens a symbol's chart in a dedicated popup window.
 * The popup reads Alpaca settings from localStorage (same origin).
 */
export function openChartWindow(symbol, { assetClass = "Equity", entry, stop, target, price } = {}) {
  if (!symbol) return;
  const params = new URLSearchParams({ chart: symbol, assetClass });
  if (entry  != null) params.set("entry",  entry);
  if (stop   != null) params.set("stop",   stop);
  if (target != null) params.set("target", target);
  if (price  != null) params.set("price",  price);

  const url = `${window.location.origin}${window.location.pathname}?${params}`;
  const features = "width=1280,height=760,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no";
  const win = window.open(url, `chart_${symbol}`, features);
  if (win) win.focus();
}
