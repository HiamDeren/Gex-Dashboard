/**
 * mock.js — synthetic chain in the exact CBOE delayed_quotes shape.
 * Used when MOCK=1, or to develop the UI without hitting CBOE.
 */
'use strict';
const { bsGamma } = require('./public/gex.js');

const SPOTS = { NDX: 21000, SPX: 5800, QQQ: 510, SPY: 580 };
const STEP = { NDX: 25, SPX: 5, QQQ: 1, SPY: 1 };

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function yymmdd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

function buildMock(symbol) {
  const spot = SPOTS[symbol] || 100;
  const step = STEP[symbol] || 1;
  const isIndex = symbol === 'NDX' || symbol === 'SPX';
  const root = isIndex ? `${symbol}${symbol === 'SPX' ? 'W' : 'P'}` : symbol;
  const r = rand(symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + new Date().getUTCDate());

  // Expiries: next 5 weekdays + 3 more weeklies
  const expiries = [];
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  while (expiries.length < 8) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && (expiries.length < 5 || dow === 5)) expiries.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const options = [];
  expiries.forEach((exp, ei) => {
    const T = Math.max((exp - Date.now()) / (365 * 864e5), 1 / 365 / 6);
    for (let K = Math.round((spot * 0.85) / step) * step; K <= spot * 1.15; K += step) {
      const m = Math.log(K / spot);
      const iv = 0.18 - 0.35 * m + 1.2 * m * m + (ei === 0 ? 0.03 : 0); // put skew + smile
      const round = K % (step * 20) === 0 ? 4 : K % (step * 4) === 0 ? 1.8 : 1;
      const dist = Math.exp(-((m / 0.05) ** 2));
      for (const cp of ['C', 'P']) {
        // calls heavier above spot, puts heavier below
        const side = cp === 'C' ? (K > spot ? 1.4 : 0.5) : K < spot ? 1.6 : 0.5;
        const oi = Math.round((200 + 3000 * dist * side * round) * (0.6 + r()) * (ei === 0 ? 0.6 : 1));
        const vol = Math.round(oi * (ei === 0 ? 0.8 : 0.15) * r());
        const g = bsGamma(spot, K, T, iv);
        const intrinsic = Math.max(0, cp === 'C' ? spot - K : K - spot);
        const px = intrinsic + spot * iv * Math.sqrt(T) * 0.4 * Math.exp(-((m / (iv * Math.sqrt(T) + 1e-6)) ** 2) / 2);
        options.push({
          option: `${root}${yymmdd(exp)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`,
          bid: +(px * 0.98).toFixed(2),
          ask: +(px * 1.02 + 0.05).toFixed(2),
          iv: +iv.toFixed(4),
          open_interest: oi,
          volume: vol,
          gamma: +g.toFixed(8),
        });
      }
    }
  });

  return {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    data: {
      symbol: isIndex ? `_${symbol}` : symbol,
      current_price: spot,
      prev_day_close: spot * 0.996,
      options,
    },
  };
}

module.exports = { buildMock };
