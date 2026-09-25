/**
 * mock.ts — synthetic chain in the exact CBOE delayed_quotes shape.
 * Used when MOCK=1, and by the tests, to work without hitting CBOE.
 */
import { bsGreeks, YEAR_MS } from './core.ts';

const SPOTS: Record<string, number> = { NDX: 21000, SPX: 5800, QQQ: 510, SPY: 580 };
const STEP: Record<string, number> = { NDX: 25, SPX: 5, QQQ: 1, SPY: 1 };

function rand(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function yymmdd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export function buildMock(symbol: string, nowMs = Date.now()) {
  const spot = SPOTS[symbol] || 100;
  const step = STEP[symbol] || 1;
  const isIndex = symbol === 'NDX' || symbol === 'SPX';
  const root = isIndex ? `${symbol}${symbol === 'SPX' ? 'W' : 'P'}` : symbol;
  const today = new Date(nowMs);
  const r = rand(symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + today.getUTCDate());

  // Expiries: next 5 weekdays + 3 more Friday weeklies. 20:00 UTC ≈ 16:00 ET settlement.
  const expiries: Date[] = [];
  const d = new Date(nowMs);
  d.setUTCHours(20, 0, 0, 0);
  if (d.getTime() <= nowMs) d.setUTCDate(d.getUTCDate() + 1);
  while (expiries.length < 8) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && (expiries.length < 5 || dow === 5)) expiries.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const options = [];
  for (const [ei, exp] of expiries.entries()) {
    const T = Math.max((exp.getTime() - nowMs) / YEAR_MS, 1 / 365 / 6);
    for (let K = Math.round((spot * 0.85) / step) * step; K <= spot * 1.15; K += step) {
      const m = Math.log(K / spot);
      const iv = 0.18 - 0.35 * m + 1.2 * m * m + (ei === 0 ? 0.03 : 0); // put skew + smile
      const round = K % (step * 20) === 0 ? 4 : K % (step * 4) === 0 ? 1.8 : 1;
      const dist = Math.exp(-((m / 0.05) ** 2));
      for (const cp of ['C', 'P'] as const) {
        // calls heavier above spot, puts heavier below
        const side = cp === 'C' ? (K > spot ? 1.4 : 0.5) : K < spot ? 1.6 : 0.5;
        const oi = Math.round((200 + 3000 * dist * side * round) * (0.6 + r()) * (ei === 0 ? 0.6 : 1));
        const vol = Math.round(oi * (ei === 0 ? 0.8 : 0.15) * r());
        const g = bsGreeks(spot, K, T, iv, cp);
        const intrinsic = Math.max(0, cp === 'C' ? spot - K : K - spot);
        const px = intrinsic + spot * iv * Math.sqrt(T) * 0.4 * Math.exp(-((m / (iv * Math.sqrt(T) + 1e-6)) ** 2) / 2);
        options.push({
          option: `${root}${yymmdd(exp)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`,
          bid: +(px * 0.98).toFixed(2),
          ask: +(px * 1.02 + 0.05).toFixed(2),
          iv: +iv.toFixed(4),
          open_interest: oi,
          volume: vol,
          delta: +g.delta.toFixed(4),
          gamma: +g.gamma.toFixed(8),
        });
      }
    }
  }

  return {
    timestamp: new Date(nowMs).toISOString().replace('T', ' ').slice(0, 19),
    symbol: isIndex ? `_${symbol}` : symbol,
    data: {
      symbol: isIndex ? `^${symbol}` : symbol,
      current_price: spot,
      prev_day_close: spot * 0.996,
      iv30: 18.2,
      iv30_change: -0.4,
      options,
    },
  };
}
