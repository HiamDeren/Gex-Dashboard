/**
 * gex.js — shared GEX math. Runs in the browser (window.GEX) and in Node (require).
 *
 * Conventions
 *  - GEX is expressed in $ per 1% move of the underlying:
 *        GEX = gamma × weight × multiplier(100) × S² × 0.01
 *  - sign = +1 (standard): calls +, puts −  → assumes dealers are long calls / short puts
 *    sign = −1 (inverted): calls −, puts +
 *    This is a MODEL ASSUMPTION, not observed positioning.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GEX = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
  const YEAR_MS = 365 * 24 * 3600 * 1000;
  const DAY_MS = 24 * 3600 * 1000;
  const MIN_T = 15 / (365 * 24 * 60); // floor T at 15 minutes to keep 0DTE gamma finite
  const MULTIPLIER = 100;
  // AM-settled roots (monthly index options) settle at the open, not 16:00 ET.
  const AM_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'DJX']);
  const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

  // ---------- time helpers (US Eastern, DST rule hardcoded: 2nd Sun Mar → 1st Sun Nov) ----------
  function nthSundayUTC(y, m, n) {
    const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
    return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  }
  function nyUtcOffsetHours(y, m, d) {
    const t = Date.UTC(y, m, d);
    const dstStart = Date.UTC(y, 2, nthSundayUTC(y, 2, 2));
    const dstEnd = Date.UTC(y, 10, nthSundayUTC(y, 10, 1));
    return t >= dstStart && t < dstEnd ? 4 : 5;
  }
  function nyTimeToUtcMs(y, m, d, hh, mm) {
    return Date.UTC(y, m, d, hh + nyUtcOffsetHours(y, m, d), mm);
  }

  // ---------- Black-Scholes gamma (r = q = 0; fine for short-dated index options) ----------
  function bsGamma(S, K, T, iv) {
    if (!(S > 0 && K > 0 && T > 0 && iv > 0)) return 0;
    const sT = iv * Math.sqrt(T);
    const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / sT;
    return (INV_SQRT_2PI * Math.exp(-0.5 * d1 * d1)) / (S * sT);
  }

  // ---------- CBOE payload → compact contracts ----------
  function parseCboe(raw, nowMs) {
    nowMs = nowMs || Date.now();
    const d = raw && raw.data;
    if (!d || !Array.isArray(d.options)) {
      throw new Error('Unexpected CBOE payload: data.options is missing');
    }
    const spot = Number(d.current_price) || Number(d.close) || Number(d.prev_day_close);
    if (!(spot > 0)) throw new Error('CBOE payload has no usable spot price');

    const contracts = [];
    for (const o of d.options) {
      const m = OCC_RE.exec(o.option || '');
      if (!m) continue;
      const rootSym = m[1];
      const y = 2000 + Number(m[2]);
      const mo = Number(m[3]) - 1;
      const day = Number(m[4]);
      const expMs = AM_ROOTS.has(rootSym)
        ? nyTimeToUtcMs(y, mo, day, 9, 30)
        : nyTimeToUtcMs(y, mo, day, 16, 0);
      if (expMs <= nowMs) continue; // already expired/settled
      contracts.push({
        root: rootSym,
        exp: `${y}-${m[3]}-${m[4]}`,
        expMs,
        type: m[5],
        K: Number(m[6]) / 1000,
        oi: Number(o.open_interest) || 0,
        vol: Number(o.volume) || 0,
        iv: Number(o.iv) || 0,
        gamma: Number(o.gamma) || 0,
        bid: Number(o.bid) || 0,
        ask: Number(o.ask) || 0,
      });
    }
    return {
      symbol: String(d.symbol || raw.symbol || '').replace(/^[_^]/, ''), // CBOE: "^NDX" (index), "QQQ" (ETF)
      spot,
      prevClose: Number(d.prev_day_close) || null,
      cboeTimestamp: raw.timestamp || null,
      contracts,
    };
  }

  // ---------- filtering ----------
  function listExpiries(contracts) {
    const map = new Map();
    for (const c of contracts) if (!map.has(c.exp)) map.set(c.exp, c.expMs);
    return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([exp, expMs]) => ({ exp, expMs }));
  }

  /** expiry: 'all' | 'front' | 'd7' | 'd30' | 'YYYY-MM-DD' */
  function filterContracts(contracts, expiry, nowMs) {
    nowMs = nowMs || Date.now();
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

  function weightOf(c, weight) {
    if (weight === 'vol') return c.vol;
    if (weight === 'oivol') return c.oi + c.vol;
    return c.oi;
  }

  function timeToExpiry(c, nowMs) {
    return Math.max((c.expMs - nowMs) / YEAR_MS, MIN_T);
  }

  // ---------- main computation ----------
  /**
   * opts: { weight: 'oi'|'vol'|'oivol', sign: 1|-1, rangePct: number, bucket: number, gridPoints: number }
   */
  function compute(chain, contracts, opts, nowMs) {
    nowMs = nowMs || Date.now();
    const o = Object.assign({ weight: 'oi', sign: 1, rangePct: 5, bucket: 0, gridPoints: 161 }, opts);
    const S = chain.spot;
    const scale = MULTIPLIER * S * S * 0.01;
    const lo = S * (1 - o.rangePct / 100);
    const hi = S * (1 + o.rangePct / 100);

    // Keep only contracts that carry weight; prep T once.
    const live = [];
    for (const c of contracts) {
      const w = weightOf(c, o.weight);
      if (w <= 0) continue;
      live.push({ c, w, T: timeToExpiry(c, nowMs), sgn: c.type === 'C' ? o.sign : -o.sign });
    }

    // 1) Per-strike profile at current spot (vendor gamma, BS fallback)
    const byStrike = new Map();
    for (const { c, w, T, sgn } of live) {
      const g = c.gamma > 0 ? c.gamma : bsGamma(S, c.K, T, c.iv);
      const gex = sgn * g * w * scale;
      const key = o.bucket > 0 ? Math.round(c.K / o.bucket) * o.bucket : c.K;
      let row = byStrike.get(key);
      if (!row) byStrike.set(key, (row = { K: key, call: 0, put: 0, net: 0, callOi: 0, putOi: 0, callVol: 0, putVol: 0 }));
      if (c.type === 'C') { row.call += gex; row.callOi += c.oi; row.callVol += c.vol; }
      else { row.put += gex; row.putOi += c.oi; row.putVol += c.vol; }
      row.net += gex;
    }
    const allStrikes = [...byStrike.values()].sort((a, b) => a.K - b.K);
    const strikes = allStrikes.filter((r) => r.K >= lo && r.K <= hi);
    const totalAtSpot = allStrikes.reduce((s, r) => s + r.net, 0);

    // 2) Walls — by component magnitude, convention-independent
    const above = allStrikes.filter((r) => r.K >= S);
    const below = allStrikes.filter((r) => r.K <= S);
    const argmax = (rows, f) => rows.reduce((best, r) => (!best || f(r) > f(best) ? r : best), null);
    const callWall = argmax(above.length ? above : allStrikes, (r) => Math.abs(r.call));
    const putWall = argmax(below.length ? below : allStrikes, (r) => Math.abs(r.put));

    // 3) Gamma curve: reprice every contract's BS gamma across a spot grid
    const n = Math.max(21, o.gridPoints | 0);
    const curve = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = lo + ((hi - lo) * i) / (n - 1);
      const sc = MULTIPLIER * x * x * 0.01;
      let tot = 0;
      for (const { c, w, T, sgn } of live) tot += sgn * bsGamma(x, c.K, T, c.iv) * w * sc;
      curve[i] = { S: x, gex: tot };
    }
    const zeroGamma = nearestCrossing(curve.map((p) => [p.S, p.gex]), S);

    // 4) Cumulative-by-strike flip (alternative definition, often differs)
    let cum = 0;
    const cumPts = allStrikes.map((r) => [r.K, (cum += r.net)]);
    const cumFlip = nearestCrossing(cumPts, S);

    // 5) Top |net| strikes in range
    const topStrikes = [...strikes].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 5);

    return {
      spot: S,
      totalAtSpot,
      strikes,
      curve,
      callWall: callWall ? callWall.K : null,
      putWall: putWall ? putWall.K : null,
      zeroGamma,
      cumFlip,
      regime: zeroGamma == null ? (totalAtSpot >= 0 ? 'positive' : 'negative') : S >= zeroGamma ? 'positive' : 'negative',
      topStrikes,
      contractsUsed: live.length,
      expectedMove: expectedMove(chain, contracts, nowMs),
    };
  }

  /** Linear-interpolated zero crossing closest to `ref`. pts: [[x, y], ...] sorted by x. */
  function nearestCrossing(pts, ref) {
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if (y0 === 0) { if (best == null || Math.abs(x0 - ref) < Math.abs(best - ref)) best = x0; continue; }
      if ((y0 < 0) !== (y1 < 0)) {
        const x = x0 + ((x1 - x0) * (0 - y0)) / (y1 - y0);
        if (best == null || Math.abs(x - ref) < Math.abs(best - ref)) best = x;
      }
    }
    return best;
  }

  /** Front-expiry expected move: ATM straddle mid vs IV·√T·S */
  function expectedMove(chain, contracts, nowMs) {
    const front = listExpiries(contracts)[0];
    if (!front) return null;
    const S = chain.spot;
    const calls = new Map();
    const puts = new Map();
    for (const c of contracts) {
      if (c.exp !== front.exp) continue;
      (c.type === 'C' ? calls : puts).set(c.K, c);
    }
    let atmK = null;
    for (const K of calls.keys()) {
      if (!puts.has(K)) continue;
      if (atmK == null || Math.abs(K - S) < Math.abs(atmK - S)) atmK = K;
    }
    if (atmK == null) return null;
    const c = calls.get(atmK);
    const p = puts.get(atmK);
    const mid = (x) => (x.bid > 0 && x.ask > 0 ? (x.bid + x.ask) / 2 : null);
    const cm = mid(c);
    const pm = mid(p);
    const straddle = cm != null && pm != null ? cm + pm : null;
    const iv = (c.iv + p.iv) / 2;
    const T = Math.max((front.expMs - nowMs) / YEAR_MS, MIN_T);
    return { exp: front.exp, atmK, straddle, ivMove: iv > 0 ? iv * Math.sqrt(T) * S : null, iv };
  }

  /** Map an underlying level to futures. Index → additive basis, ETF → ratio. */
  function makeMapper(symbol, spot, futPrice) {
    if (!(futPrice > 0)) return null;
    const isIndex = AM_ROOTS.has(symbol) || /^(XSP|NDXP|SPXW)$/.test(symbol);
    if (isIndex) {
      const basis = futPrice - spot;
      return { mode: 'basis', value: basis, map: (x) => x + basis };
    }
    const ratio = futPrice / spot;
    return { mode: 'ratio', value: ratio, map: (x) => x * ratio };
  }

  return { parseCboe, listExpiries, filterContracts, compute, bsGamma, makeMapper, nearestCrossing };
});
