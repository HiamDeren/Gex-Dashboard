/**
 * heatmap.ts — price × time grids for the gamma and charm heat maps (curriculum Module 5).
 *
 * Every contract is repriced with Black-Scholes at each (price, time) node, holding IV constant.
 * Contracts that settle before a time column drop out of that column, which is what makes the
 * 0DTE map change through the day.
 *
 *   gamma cell  = Σ q · Γ · 100 · x² · 1%              $ dealer delta change per 1% move
 *   charm cell  = −Σ q · charm/(365·24) · 100 · x      $ dealers must BUY per hour from time decay alone
 *                                                     (+ = supportive / passive buying, − = passive selling)
 */
import { bsGreeks, nearestCrossing, sessionWindow, weightOf, yearsTo, MULTIPLIER, type Contract, type Weight } from './core.ts';

export interface HeatmapOpts {
  weight: Weight;
  sign: 1 | -1;
  rangePct: number;
  priceSteps?: number;
  stepMinutes?: number;
}

export interface Heatmap {
  prices: number[]; // ascending
  times: number[]; // UTC ms
  gamma: number[][]; // [timeIdx][priceIdx]
  charm: number[][];
  flip: (number | null)[]; // gamma zero crossing per time column, nearest to spot
  session: { open: number; close: number; live: boolean };
}

export function buildHeatmap(spot: number, contracts: Contract[], o: HeatmapOpts, nowMs = Date.now()): Heatmap {
  const nP = o.priceSteps ?? 49;
  const step = (o.stepMinutes ?? 30) * 60_000;
  const lo = spot * (1 - o.rangePct / 100);
  const hi = spot * (1 + o.rangePct / 100);
  const prices = Array.from({ length: nP }, (_, i) => lo + ((hi - lo) * i) / (nP - 1));

  const session = sessionWindow(nowMs);
  const start = Math.max(nowMs, session.open);
  const times: number[] = [];
  for (let t = start; t < session.close; t += step) times.push(t);
  times.push(session.close - 60_000); // last column: one minute before the bell
  if (times.length < 2) times.unshift(start);

  // Far strikes contribute ~0 inside the window; skip them to keep this fast.
  const kLo = spot * (1 - (o.rangePct + 10) / 100);
  const kHi = spot * (1 + (o.rangePct + 10) / 100);
  const live = [];
  for (const c of contracts) {
    const w = weightOf(c, o.weight);
    if (w <= 0 || !(c.iv > 0) || c.K < kLo || c.K > kHi) continue;
    live.push({ c, q: (c.type === 'C' ? o.sign : -o.sign) * w });
  }

  const gamma: number[][] = [];
  const charm: number[][] = [];
  const flip: (number | null)[] = [];
  for (const t of times) {
    const gRow = new Array<number>(nP).fill(0);
    const cRow = new Array<number>(nP).fill(0);
    for (const { c, q } of live) {
      if (c.expMs <= t) continue; // settled before this column
      const T = yearsTo(c.expMs, t);
      for (let i = 0; i < nP; i++) {
        const x = prices[i];
        if (Math.abs(Math.log(x / c.K)) > 8 * c.iv * Math.sqrt(T) + 1e-9) continue; // > 8σ away: greeks ≈ 0
        const g = bsGreeks(x, c.K, T, c.iv, c.type);
        gRow[i] += q * g.gamma * MULTIPLIER * x * x * 0.01;
        cRow[i] -= ((q * g.charm) / (365 * 24)) * MULTIPLIER * x;
      }
    }
    gamma.push(gRow);
    charm.push(cRow);
    flip.push(nearestCrossing(prices.map((x, i) => [x, gRow[i]] as [number, number]), spot));
  }
  return { prices, times, gamma, charm, flip, session };
}
