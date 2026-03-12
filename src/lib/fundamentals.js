/**
 * Fundamentals via Alpha Vantage (paid tier).
 * Combines overview, earnings calendar, EPS surprise history,
 * insider activity, and free cash flow trend.
 */
import {
  getOverview,
  getEarningsCalendar,
  getEarningsSurprise,
  getInsiderActivity,
  getCashFlow,
} from "./alphavantage.js";

export async function getFundamentals(symbol) {
  const [overview, earnings, earningsSurprise, insider, cashFlow] = await Promise.all([
    getOverview(symbol).catch(() => null),
    getEarningsCalendar(symbol).catch(() => null),
    getEarningsSurprise(symbol).catch(() => null),
    getInsiderActivity(symbol).catch(() => null),
    getCashFlow(symbol).catch(() => null),
  ]);

  if (!overview && !earnings) return null;

  return {
    ...(overview         || {}),
    ...(earnings         || {}),
    ...(earningsSurprise ? { earningsSurprise } : {}),
    ...(insider          ? { insider }          : {}),
    ...(cashFlow         ? { cashFlow }         : {}),
  };
}
