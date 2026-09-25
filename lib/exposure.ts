/**
 * exposure.ts — per-strike and aggregate exposures.
 *
 * Dealer position per contract: q = sgn × weight, with sgn = +sign for calls, −sign for puts.
 * sign = +1 is the "naive" model most GEX vendors use (customers sell calls / buy puts, so dealers are
 * long calls and short puts). It is a MODEL ASSUMPTION, not observed positioning.
 *
 *   GEX    = q · Γ · 100 · S² · 1%        $ of dealer delta change per 1% move       (unchanged from v0.1)
 *   DEX    = Δ · weight · 100 · S          $ delta held by option owners (no dealer sign; curriculum formula)
 *   VEX    = q · vanna · 1% · 100 · S      $ of dealer delta change per +1 vol point
 *   Charm  = q · charm/365 · 100 · S       $ of dealer delta change per calendar day
 * Dealers hedge the opposite way: a dealer delta change of X means they trade −X in futures.
 */
import type { Lang } from './i18n.ts';
import {
  bsGamma,
  bsGreeks,
  listExpiries,
  nearestCrossing,
  weightOf,
  yearsTo,
  FUTURES,
  MULTIPLIER,
  type Chain,
  type Contract,
  type Weight,
} from './core.ts';

export interface ExposureOpts {
  weight: Weight;
  sign: 1 | -1;
  rangePct: number;
  bucket: number;
  gridPoints: number;
  nodeMin: number; // |net contracts| to count as a node (curriculum: 1,000)
}
export const DEFAULT_OPTS: ExposureOpts = { weight: 'oi', sign: 1, rangePct: 5, bucket: 0, gridPoints: 161, nodeMin: 1000 };

export interface StrikeRow {
  K: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callDex: number;
  putDex: number;
  dex: number;
  vanna: number;
  charm: number;
  netContracts: number;
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
  shortVol: number; // volume in the two nearest expiries (0DTE / 1DTE)
}

export interface ExpectedMove {
  exp: string;
  atmK: number;
  straddle: number | null;
  iv: number; // front ATM IV, decimal
  ivMove: number | null; // front ATM IV × √T × S
  iv1d: number; // IV used for the 1-day move, decimal
  source: 'IV30' | 'ATM';
  em1d: number; // Spot × IV × √(1/252)
  lo: number;
  hi: number;
}

export type ProfileQuality = 'clean' | 'messy' | 'thin';
/** Profile quality plus the facts behind it; `profileReason` turns it into text. */
export interface Profile {
  quality: ProfileQuality;
  nodeMin: number;
  nodes: number; // strikes near spot with |net contracts| ≥ nodeMin
  topK: number | null; // largest node near spot
}

export interface ExposureResult {
  spot: number;
  strikes: StrikeRow[]; // inside ±range
  allStrikes: StrikeRow[];
  strikeStep: number;
  totals: {
    gex: number;
    dex: number;
    dexGross: number;
    dexRatio: number; // dex / Σ|dex|, −1..1
    vanna: number;
    charm: number;
    hedgePerPoint: number | null; // futures contracts dealers trade per 1 index point (+ = sell into rallies)
    futCode: string | null;
  };
  curve: { S: number; gex: number }[];
  callWall: number | null;
  putWall: number | null;
  hvl: number | null;
  zeroGamma: number | null;
  cumFlip: number | null;
  regime: 'positive' | 'negative';
  nearFlip: boolean;
  speed: 'positive' | 'negative' | null;
  topStrikes: StrikeRow[];
  nodes: { pos: StrikeRow[]; neg: StrikeRow[] };
  profile: Profile;
  expectedMove: ExpectedMove | null;
  contractsUsed: number;
}

const emptyRow = (K: number): StrikeRow => ({
  K, callGex: 0, putGex: 0, netGex: 0, callDex: 0, putDex: 0, dex: 0, vanna: 0, charm: 0,
  netContracts: 0, callOi: 0, putOi: 0, callVol: 0, putVol: 0, shortVol: 0,
});

export function compute(chain: Chain, contracts: Contract[], opts: Partial<ExposureOpts> = {}, nowMs = Date.now()): ExposureResult {
  const o = { ...DEFAULT_OPTS, ...opts };
  const S = chain.spot;
  const gexScale = MULTIPLIER * S * S * 0.01;
  const dollar = MULTIPLIER * S;
  const lo = S * (1 - o.rangePct / 100);
  const hi = S * (1 + o.rangePct / 100);
  const shortExps = new Set(listExpiries(contracts).slice(0, 2).map((e) => e.exp));

  const live = [];
  for (const c of contracts) {
    const w = weightOf(c, o.weight);
    if (w <= 0) continue;
    const sgn = c.type === 'C' ? o.sign : -o.sign;
    live.push({ c, w, q: sgn * w, T: yearsTo(c.expMs, nowMs) });
  }

  // 1) Per-strike rows at the current spot
  const byStrike = new Map<number, StrikeRow>();
  let sumDealerGamma = 0;
  let dexGross = 0;
  for (const { c, w, q, T } of live) {
    const bs = bsGreeks(S, c.K, T, c.iv, c.type);
    const g = c.gamma > 0 ? c.gamma : bsGamma(S, c.K, T, c.iv); // vendor gamma, BS fallback (as v0.1)
    const gex = q * g * gexScale;
    const dex = c.delta * w * dollar;
    const key = o.bucket > 0 ? Math.round(c.K / o.bucket) * o.bucket : c.K;
    let row = byStrike.get(key);
    if (!row) byStrike.set(key, (row = emptyRow(key)));
    if (c.type === 'C') {
      row.callGex += gex; row.callDex += dex; row.callOi += c.oi; row.callVol += c.vol;
    } else {
      row.putGex += gex; row.putDex += dex; row.putOi += c.oi; row.putVol += c.vol;
    }
    row.netGex += gex;
    row.dex += dex;
    row.vanna += q * bs.vanna * 0.01 * dollar;
    row.charm += ((q * bs.charm) / 365) * dollar;
    row.netContracts += q;
    if (shortExps.has(c.exp)) row.shortVol += c.vol;
    sumDealerGamma += q * g;
    dexGross += Math.abs(dex);
  }
  const allStrikes = [...byStrike.values()].sort((a, b) => a.K - b.K);
  const strikes = allStrikes.filter((r) => r.K >= lo && r.K <= hi);
  const sum = (f: (r: StrikeRow) => number) => allStrikes.reduce((s, r) => s + f(r), 0);
  const totalGex = sum((r) => r.netGex);
  const totalDex = sum((r) => r.dex);

  const gaps = strikes.slice(1).map((s, i) => s.K - strikes[i].K).sort((a, b) => a - b);
  const strikeStep = gaps.length ? gaps[Math.floor(gaps.length / 2)] : S * 0.001;

  // 2) Walls — by component magnitude, convention-independent. HVL = largest total |GEX| in range.
  const argmax = (rows: StrikeRow[], f: (r: StrikeRow) => number) => rows.reduce<StrikeRow | null>((best, r) => (!best || f(r) > f(best) ? r : best), null);
  const above = allStrikes.filter((r) => r.K >= S);
  const below = allStrikes.filter((r) => r.K <= S);
  const callWall = argmax(above.length ? above : allStrikes, (r) => Math.abs(r.callGex));
  const putWall = argmax(below.length ? below : allStrikes, (r) => Math.abs(r.putGex));
  const hvl = argmax(strikes, (r) => Math.abs(r.callGex) + Math.abs(r.putGex));

  // 3) Gamma curve: reprice every contract's BS gamma across a spot grid
  const n = Math.max(21, o.gridPoints | 0);
  const curve = new Array<{ S: number; gex: number }>(n);
  for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1);
    const sc = MULTIPLIER * x * x * 0.01;
    let tot = 0;
    for (const { c, q, T } of live) tot += q * bsGamma(x, c.K, T, c.iv) * sc;
    curve[i] = { S: x, gex: tot };
  }
  const zeroGamma = nearestCrossing(curve.map((p) => [p.S, p.gex] as [number, number]), S);

  // 4) Cumulative-by-strike flip (alternative definition, often differs)
  let cum = 0;
  const cumFlip = nearestCrossing(allStrikes.map((r) => [r.K, (cum += r.netGex)] as [number, number]), S);

  // 5) Speed: does dealer gamma grow or shrink as price rises? (sign of dΓ/dS around spot)
  const iSpot = curve.reduce((bi, p, i) => (Math.abs(p.S - S) < Math.abs(curve[bi].S - S) ? i : bi), 0);
  const k = Math.max(1, Math.round((n - 1) * (0.25 / (2 * o.rangePct)))); // ≈ ±0.25% of spot
  const gAt = (i: number) => curve[i].gex / (curve[i].S * curve[i].S);
  const iL = Math.max(0, iSpot - k), iR = Math.min(n - 1, iSpot + k);
  const dG = gAt(iR) - gAt(iL);
  const speed = iR > iL && dG !== 0 ? (dG > 0 ? 'positive' : 'negative') : null;

  const expectedMove = computeExpectedMove(chain, contracts, nowMs);
  const band = expectedMove ? expectedMove.em1d : (S * o.rangePct) / 200;
  const nearFlip = zeroGamma != null && Math.abs(S - zeroGamma) <= 0.25 * band;

  // 6) Nodes and profile quality (curriculum Module 5: ignore nodes < 1,000 net, skip messy days)
  const pos = strikes.filter((r) => r.netContracts >= o.nodeMin).sort((a, b) => b.netContracts - a.netContracts);
  const neg = strikes.filter((r) => r.netContracts <= -o.nodeMin).sort((a, b) => a.netContracts - b.netContracts);
  const profile = profileQuality(strikes, S, band, o.nodeMin);

  const fut = FUTURES[chain.symbol];
  const regime = zeroGamma == null ? (totalGex >= 0 ? 'positive' : 'negative') : S >= zeroGamma ? 'positive' : 'negative';

  return {
    spot: S,
    strikes,
    allStrikes,
    strikeStep,
    totals: {
      gex: totalGex,
      dex: totalDex,
      dexGross,
      dexRatio: dexGross > 0 ? totalDex / dexGross : 0,
      vanna: sum((r) => r.vanna),
      charm: sum((r) => r.charm),
      hedgePerPoint: fut ? (sumDealerGamma * MULTIPLIER) / fut.mult : null,
      futCode: fut ? fut.code : null,
    },
    curve,
    callWall: callWall ? callWall.K : null,
    putWall: putWall ? putWall.K : null,
    hvl: hvl ? hvl.K : null,
    zeroGamma,
    cumFlip,
    regime,
    nearFlip,
    speed,
    topStrikes: [...strikes].sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex)).slice(0, 5),
    nodes: { pos, neg },
    profile,
    expectedMove,
    contractsUsed: live.length,
  };
}

function profileQuality(strikes: StrikeRow[], S: number, band: number, nodeMin: number): Profile {
  const near = strikes.filter((r) => Math.abs(r.K - S) <= 1.5 * band);
  const big = near.filter((r) => Math.abs(r.netContracts) >= nodeMin);
  if (!big.length) return { quality: 'thin', nodeMin, nodes: 0, topK: null };
  const top = [...near].sort((a, b) => Math.abs(b.netContracts) - Math.abs(a.netContracts)).slice(0, 6);
  const byK = [...top].sort((a, b) => a.K - b.K);
  let flips = 0;
  for (let i = 1; i < byK.length; i++) if (byK[i].netContracts >= 0 !== byK[i - 1].netContracts >= 0) flips++;
  const dominance = top.length > 1 && top[1].netContracts !== 0 ? Math.abs(top[0].netContracts / top[1].netContracts) : Infinity;
  const quality = top.length >= 5 && flips >= 4 && dominance < 1.3 ? 'messy' : 'clean';
  return { quality, nodeMin, nodes: big.length, topK: top[0].K };
}

export function profileReason(p: Profile, lang: Lang = 'vi'): string {
  const n = p.nodeMin.toLocaleString('en-US');
  const k = p.topK?.toLocaleString('en-US') ?? '—';
  if (lang === 'en') {
    if (p.quality === 'thin') return `No node ≥ ${n} net contracts near spot`;
    if (p.quality === 'messy') return 'Positive and negative nodes alternate evenly, no dominant node';
    return `${p.nodes} node${p.nodes === 1 ? '' : 's'} ≥ ${n} near spot, largest at ${k}`;
  }
  if (p.quality === 'thin') return `Không có node nào ≥ ${n} net contracts quanh spot`;
  if (p.quality === 'messy') return 'Node dương/âm xen kẽ đều nhau, không có node nổi trội';
  return `${p.nodes} node ≥ ${n} quanh spot, node lớn nhất ${k}`;
}

/** Front-expiry ATM straddle, plus the curriculum's 1-day move: Spot × IV × √(1/252). */
export function computeExpectedMove(chain: Chain, contracts: Contract[], nowMs = Date.now()): ExpectedMove | null {
  const S = chain.spot;
  const exps = listExpiries(contracts);
  const front = exps[0];
  if (!front) return null;
  const atm = atmPair(contracts, front.exp, S);
  if (!atm) return null;
  const { c, p, K } = atm;
  const mid = (x: Contract) => (x.bid > 0 && x.ask > 0 ? (x.bid + x.ask) / 2 : null);
  const cm = mid(c);
  const pm = mid(p);
  const iv = (c.iv + p.iv) / 2;
  const T = yearsTo(front.expMs, nowMs);

  // 1-day IV: CBOE's 30-day IV if present, else ATM IV of the first expiry at least ~1 day out
  let iv1d = chain.iv30 && chain.iv30 > 0 ? chain.iv30 / 100 : 0;
  let source: 'IV30' | 'ATM' = 'IV30';
  if (!(iv1d > 0)) {
    source = 'ATM';
    const e = exps.find((x) => x.expMs - nowMs > 0.75 * 864e5) || front;
    const pair = atmPair(contracts, e.exp, S);
    iv1d = pair ? (pair.c.iv + pair.p.iv) / 2 : iv;
  }
  const em1d = S * iv1d * Math.sqrt(1 / 252);
  return {
    exp: front.exp,
    atmK: K,
    straddle: cm != null && pm != null ? cm + pm : null,
    iv,
    ivMove: iv > 0 ? iv * Math.sqrt(T) * S : null,
    iv1d,
    source,
    em1d,
    lo: S - em1d,
    hi: S + em1d,
  };
}

export function atmPair(contracts: Contract[], exp: string, S: number) {
  const calls = new Map<number, Contract>();
  const puts = new Map<number, Contract>();
  for (const c of contracts) {
    if (c.exp !== exp || !(c.iv > 0)) continue;
    (c.type === 'C' ? calls : puts).set(c.K, c);
  }
  let K: number | null = null;
  for (const k of calls.keys()) if (puts.has(k) && (K == null || Math.abs(k - S) < Math.abs(K - S))) K = k;
  return K == null ? null : { K, c: calls.get(K)!, p: puts.get(K)! };
}
