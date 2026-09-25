/**
 * core.ts — types, CBOE parsing, US-Eastern time helpers and Black-Scholes greeks.
 * Pure functions only: runs in the browser, in Next route handlers and under `node --test`.
 *
 * Model conventions (r = q = 0, fine for short-dated index options):
 *   delta   ∂V/∂S
 *   gamma   ∂²V/∂S²
 *   vanna   ∂Δ/∂σ           (per 1.00 of vol; ×0.01 for one vol point)
 *   charm   dΔ/dt            (per YEAR of calendar time moving forward; same for calls and puts)
 */

export type OptType = 'C' | 'P';

export interface Contract {
  root: string;
  exp: string; // YYYY-MM-DD
  expMs: number; // settlement time, UTC ms
  type: OptType;
  K: number;
  oi: number;
  vol: number;
  iv: number; // decimal, 0.18 = 18%
  gamma: number; // vendor gamma (CBOE rounds to 4 dp)
  delta: number; // vendor delta
  bid: number;
  ask: number;
}

export interface Chain {
  symbol: string;
  spot: number;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  iv30: number | null; // percent, as CBOE reports it (16.7 = 16.7%)
  iv30Change: number | null; // vol points
  cboeTimestamp: string | null;
  contracts: Contract[];
}

export type Weight = 'oi' | 'vol' | 'oivol';

export const YEAR_MS = 365 * 24 * 3600 * 1000;
export const DAY_MS = 24 * 3600 * 1000;
export const HOUR_MS = 3600 * 1000;
export const MIN_T = 15 / (365 * 24 * 60); // floor T at 15 minutes to keep 0DTE greeks finite
export const MULTIPLIER = 100;

const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
// AM-settled roots (monthly index options) settle at the open, not 16:00 ET.
const AM_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'DJX']);
export const INDEX_SYMBOLS = new Set(['NDX', 'SPX', 'RUT', 'VIX', 'XSP', 'DJX']);

/** Futures that hedge each index, with $ per index point. */
export const FUTURES: Record<string, { code: string; mult: number }> = {
  NDX: { code: 'NQ', mult: 20 },
  SPX: { code: 'ES', mult: 50 },
  RUT: { code: 'RTY', mult: 50 },
};

// ---------- normal distribution ----------
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);
export const npdf = (x: number) => INV_SQRT_2PI * Math.exp(-0.5 * x * x);
/** Φ(x) via erf (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
export function ncdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// ---------- Black-Scholes ----------
export interface Greeks {
  delta: number;
  gamma: number;
  vanna: number;
  charm: number;
}
const ZERO: Greeks = { delta: 0, gamma: 0, vanna: 0, charm: 0 };

export function bsGamma(S: number, K: number, T: number, iv: number): number {
  if (!(S > 0 && K > 0 && T > 0 && iv > 0)) return 0;
  const sT = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / sT;
  return npdf(d1) / (S * sT);
}

export function bsGreeks(S: number, K: number, T: number, iv: number, type: OptType): Greeks {
  if (!(S > 0 && K > 0 && T > 0 && iv > 0)) return ZERO;
  const sqT = Math.sqrt(T);
  const sT = iv * sqT;
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / sT;
  const d2 = d1 - sT;
  const pdf = npdf(d1);
  return {
    delta: type === 'C' ? ncdf(d1) : ncdf(d1) - 1,
    gamma: pdf / (S * sT),
    vanna: (-pdf * d2) / iv,
    // ∂Δ/∂τ = −φ(d1)·d2/(2τ); time moving forward shrinks τ, so dΔ/dt = +φ(d1)·d2/(2τ)
    charm: (pdf * d2) / (2 * T),
  };
}

// ---------- US Eastern time (DST rule hardcoded: 2nd Sun Mar → 1st Sun Nov) ----------
function nthSundayUTC(y: number, m: number, n: number) {
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}
export function nyUtcOffsetHours(y: number, m: number, d: number) {
  const t = Date.UTC(y, m, d);
  const dstStart = Date.UTC(y, 2, nthSundayUTC(y, 2, 2));
  const dstEnd = Date.UTC(y, 10, nthSundayUTC(y, 10, 1));
  return t >= dstStart && t < dstEnd ? 4 : 5;
}
export function nyTimeToUtcMs(y: number, m: number, d: number, hh: number, mm: number) {
  return Date.UTC(y, m, d, hh + nyUtcOffsetHours(y, m, d), mm);
}
/** Calendar date (y, m, d) in New York for a UTC instant. */
export function nyDate(ms: number) {
  const guess = new Date(ms - 5 * HOUR_MS);
  const y = guess.getUTCFullYear(), m = guess.getUTCMonth(), d = guess.getUTCDate();
  const local = new Date(ms - nyUtcOffsetHours(y, m, d) * HOUR_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate(), dow: local.getUTCDay(), h: local.getUTCHours(), min: local.getUTCMinutes() };
}

/**
 * The regular session (09:30–16:00 ET) that is live now, or the next one if the market is closed.
 * Weekends are skipped; exchange holidays are not modelled.
 */
export function sessionWindow(nowMs: number) {
  let { y, m, d } = nyDate(nowMs);
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.UTC(y, m, d + i));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const Y = day.getUTCFullYear(), M = day.getUTCMonth(), D = day.getUTCDate();
    const open = nyTimeToUtcMs(Y, M, D, 9, 30);
    const close = nyTimeToUtcMs(Y, M, D, 16, 0);
    if (close > nowMs) return { open, close, live: nowMs >= open };
  }
  const fallback = nowMs + DAY_MS;
  return { open: fallback, close: fallback + 6.5 * HOUR_MS, live: false };
}

export const yearsTo = (expMs: number, atMs: number) => Math.max((expMs - atMs) / YEAR_MS, MIN_T);

// ---------- CBOE payload → compact chain ----------
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCboe(raw: any, nowMs = Date.now()): Chain {
  const d = raw && raw.data;
  if (!d || !Array.isArray(d.options)) throw new Error('Unexpected CBOE payload: data.options is missing');
  const spot = Number(d.current_price) || Number(d.close) || Number(d.prev_day_close);
  if (!(spot > 0)) throw new Error('CBOE payload has no usable spot price');

  const contracts: Contract[] = [];
  for (const o of d.options) {
    const m = OCC_RE.exec(o.option || '');
    if (!m) continue;
    const rootSym = m[1];
    const y = 2000 + Number(m[2]);
    const mo = Number(m[3]) - 1;
    const day = Number(m[4]);
    const expMs = AM_ROOTS.has(rootSym) ? nyTimeToUtcMs(y, mo, day, 9, 30) : nyTimeToUtcMs(y, mo, day, 16, 0);
    if (expMs <= nowMs) continue; // already expired/settled
    contracts.push({
      root: rootSym,
      exp: `${y}-${m[3]}-${m[4]}`,
      expMs,
      type: m[5] as OptType,
      K: Number(m[6]) / 1000,
      oi: Number(o.open_interest) || 0,
      vol: Number(o.volume) || 0,
      iv: Number(o.iv) || 0,
      gamma: Number(o.gamma) || 0,
      delta: Number(o.delta) || 0,
      bid: Number(o.bid) || 0,
      ask: Number(o.ask) || 0,
    });
  }
  return {
    // CBOE: data.symbol "^NDX" for indexes, "QQQ" for ETFs; top-level symbol "_NDX"
    symbol: String(d.symbol || raw.symbol || '').replace(/^[_^]/, ''),
    spot,
    prevClose: num(d.prev_day_close),
    open: num(d.open) || null,
    high: num(d.high) || null,
    low: num(d.low) || null,
    iv30: num(d.iv30) || null,
    iv30Change: num(d.iv30_change),
    cboeTimestamp: raw.timestamp || null,
    contracts,
  };
}

// ---------- filtering ----------
export function listExpiries(contracts: Contract[]) {
  const map = new Map<string, number>();
  for (const c of contracts) if (!map.has(c.exp)) map.set(c.exp, c.expMs);
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([exp, expMs]) => ({ exp, expMs }));
}

/** expiry: 'all' | 'front' | 'd7' | 'd30' | 'YYYY-MM-DD' */
export function filterContracts(contracts: Contract[], expiry: string, nowMs = Date.now()) {
  if (!expiry || expiry === 'all') return contracts;
  if (expiry === 'front') {
    const first = listExpiries(contracts)[0];
    return first ? contracts.filter((c) => c.exp === first.exp) : [];
  }
  if (expiry === 'd7' || expiry === 'd30') {
    const lim = nowMs + (expiry === 'd7' ? 7 : 30) * DAY_MS;
    return contracts.filter((c) => c.expMs <= lim);
  }
  return contracts.filter((c) => c.exp === expiry);
}

export function weightOf(c: Contract, weight: Weight) {
  if (weight === 'vol') return c.vol;
  if (weight === 'oivol') return c.oi + c.vol;
  return c.oi;
}

/** Map an underlying level to futures. Index → additive basis, ETF → ratio. */
export function makeMapper(symbol: string, spot: number, futPrice: number) {
  if (!(futPrice > 0)) return null;
  if (INDEX_SYMBOLS.has(symbol) || /^(NDXP|SPXW)$/.test(symbol)) {
    const basis = futPrice - spot;
    return { mode: 'basis' as const, value: basis, map: (x: number) => x + basis };
  }
  const ratio = futPrice / spot;
  return { mode: 'ratio' as const, value: ratio, map: (x: number) => x * ratio };
}

/** Linear-interpolated zero crossing closest to `ref`. pts: [[x, y], ...] sorted by x. */
export function nearestCrossing(pts: [number, number][], ref: number): number | null {
  let best: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (y0 === 0) {
      if (best == null || Math.abs(x0 - ref) < Math.abs(best - ref)) best = x0;
      continue;
    }
    if (y0 < 0 !== y1 < 0) {
      const x = x0 + ((x1 - x0) * (0 - y0)) / (y1 - y0);
      if (best == null || Math.abs(x - ref) < Math.abs(best - ref)) best = x;
    }
  }
  return best;
}
