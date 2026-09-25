/**
 * vol.ts — volatility views from the curriculum's Module 4: smile/skew per expiry, ATM term structure,
 * 25-delta risk reversal, and a coarse "IV compressing / expanding / flat" state from CBOE's IV30 change.
 */
import { listExpiries, DAY_MS, type Chain, type Contract } from './core.ts';
import { atmPair } from './exposure.ts';

export interface SmilePoint {
  K: number;
  callIv: number | null;
  putIv: number | null;
  otmIv: number | null; // put below spot, call at/above: the side that actually trades
}

export function smile(contracts: Contract[], exp: string, S: number, rangePct: number): SmilePoint[] {
  const lo = S * (1 - rangePct / 100);
  const hi = S * (1 + rangePct / 100);
  const rows = new Map<number, SmilePoint>();
  for (const c of contracts) {
    if (c.exp !== exp || c.K < lo || c.K > hi || !(c.iv > 0)) continue;
    let r = rows.get(c.K);
    if (!r) rows.set(c.K, (r = { K: c.K, callIv: null, putIv: null, otmIv: null }));
    if (c.type === 'C') r.callIv = c.iv;
    else r.putIv = c.iv;
  }
  const out = [...rows.values()].sort((a, b) => a.K - b.K);
  for (const r of out) r.otmIv = r.K < S ? r.putIv ?? r.callIv : r.callIv ?? r.putIv;
  return out;
}

export interface TermPoint {
  exp: string;
  expMs: number;
  days: number; // calendar days to settlement
  atmIv: number;
  atmK: number;
  rr25: number | null; // IV(25Δ put) − IV(25Δ call), decimal. + = downside skew
  put25Iv: number | null;
  call25Iv: number | null;
}

export function termStructure(contracts: Contract[], S: number, nowMs = Date.now(), maxDays = 180): TermPoint[] {
  const out: TermPoint[] = [];
  for (const { exp, expMs } of listExpiries(contracts)) {
    const days = (expMs - nowMs) / DAY_MS;
    if (days > maxDays) break;
    const pair = atmPair(contracts, exp, S);
    if (!pair) continue;
    const put25 = nearestDelta(contracts, exp, 'P', -0.25);
    const call25 = nearestDelta(contracts, exp, 'C', 0.25);
    out.push({
      exp,
      expMs,
      days,
      atmIv: (pair.c.iv + pair.p.iv) / 2,
      atmK: pair.K,
      put25Iv: put25?.iv ?? null,
      call25Iv: call25?.iv ?? null,
      rr25: put25 && call25 ? put25.iv - call25.iv : null,
    });
  }
  return out;
}

function nearestDelta(contracts: Contract[], exp: string, type: 'C' | 'P', target: number) {
  let best: Contract | null = null;
  for (const c of contracts) {
    if (c.exp !== exp || c.type !== type || !(c.iv > 0) || c.delta === 0) continue;
    if (!best || Math.abs(c.delta - target) < Math.abs(best.delta - target)) best = c;
  }
  return best && Math.abs(best.delta - target) <= 0.08 ? best : null;
}

export type IvTrend = 'expanding' | 'compressing' | 'flat';
export const IV_TREND_VI: Record<IvTrend, string> = { expanding: 'bụng ra', compressing: 'nén', flat: 'phẳng' };

/** From CBOE's IV30 change (vol points). ±0.3 pt is a starting threshold, not a law. */
export function ivTrend(chain: Chain, threshold = 0.3): IvTrend | null {
  if (chain.iv30Change == null || chain.iv30 == null) return null;
  if (chain.iv30Change >= threshold) return 'expanding';
  if (chain.iv30Change <= -threshold) return 'compressing';
  return 'flat';
}

export type TermShape = 'normal' | 'front-rich';
/** Front (≥ ~1 day, 0DTE IV is too noisy) vs the expiry nearest 30 days. Front ≥ 1 vol pt richer = stressed. */
export function termShape(ts: TermPoint[]): { shape: TermShape; front: TermPoint; back: TermPoint } | null {
  const front = ts.find((p) => p.days >= 0.75);
  if (!front) return null;
  const back = ts.reduce((b, p) => (Math.abs(p.days - 30) < Math.abs(b.days - 30) ? p : b), ts[ts.length - 1]);
  if (back === front) return null;
  return { shape: front.atmIv - back.atmIv >= 0.01 ? 'front-rich' : 'normal', front, back };
}
