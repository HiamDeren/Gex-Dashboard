/**
 * levels.ts — the curriculum's Module 6 level map: collect candidates, merge nearby ones into zones,
 * score each zone on the 15-point rubric, keep up to 5 per side (S1…S5 / R1…R5, nearest first).
 *
 * Rubric (max)                                                   How it is scored from data here
 *   Proximity, inside the expected move        3                 |zone − spot| / EM1d: ≤0.5 → 3, ≤1 → 2, ≤1.5 → 1
 *   Exposure significance                      3                 |net GEX| vs the largest in band: ≥50% 3, ≥25% 2, ≥10% 1; flip = 3
 *   Activity today (0DTE/1DTE volume)          2                 short-dated volume vs max: ≥50% 2, ≥20% 1
 *   Durable OI                                 2                 OI vs max: ≥50% 2, ≥20% 1
 *   Confluence                                 3                 distinct sources in the zone − 1, capped at 3
 *   Observed reaction                          2                 NOT scored: needs price/orderflow the trader watches
 * So the automatic maximum is 13; the trader adds up to 2 for reaction.
 */
import type { ExposureResult, StrikeRow } from './exposure.ts';
import type { Lang } from './i18n.ts';

export type Source = 'flip' | 'callWall' | 'putWall' | 'hvl' | 'posNode' | 'negNode' | 'emHigh' | 'emLow' | 'short';

export const SOURCE_LABEL: Record<Lang, Record<Source, string>> = {
  vi: {
    flip: 'Gamma flip',
    callWall: 'Call wall',
    putWall: 'Put wall',
    hvl: 'HVL',
    posNode: 'Node dương',
    negNode: 'Node âm',
    emHigh: 'Biên trên EM',
    emLow: 'Biên dưới EM',
    short: '0DTE/1DTE sôi',
  },
  en: {
    flip: 'Gamma flip',
    callWall: 'Call wall',
    putWall: 'Put wall',
    hvl: 'HVL',
    posNode: 'Positive node',
    negNode: 'Negative node',
    emHigh: 'EM upper edge',
    emLow: 'EM lower edge',
    short: 'Hot 0DTE/1DTE',
  },
};
const FAMILY: Record<Source, string> = {
  flip: 'flip', callWall: 'wall', putWall: 'wall', hvl: 'hvl', posNode: 'node', negNode: 'node', emHigh: 'em', emLow: 'em', short: 'short',
};
export type Role = 'pivot' | 'edge' | 'magnet' | 'wall' | 'emEdge' | 'pivotMagnet' | 'level0dte';
// Role shown for the zone = role of its highest-priority source.
const ROLE: [Source, Role][] = [
  ['flip', 'pivot'],
  ['negNode', 'edge'],
  ['posNode', 'magnet'],
  ['callWall', 'wall'],
  ['putWall', 'wall'],
  ['emHigh', 'emEdge'],
  ['emLow', 'emEdge'],
  ['hvl', 'pivotMagnet'],
  ['short', 'level0dte'],
];
export const ROLE_LABEL: Record<Lang, Record<Role, string>> = {
  vi: { pivot: 'Pivot', edge: 'Biên / mức test', magnet: 'Nam châm', wall: 'Wall', emEdge: 'Biên EM', pivotMagnet: 'Pivot / nam châm', level0dte: 'Level 0DTE' },
  en: { pivot: 'Pivot', edge: 'Edge / test level', magnet: 'Magnet', wall: 'Wall', emEdge: 'EM edge', pivotMagnet: 'Pivot / magnet', level0dte: '0DTE level' },
};

export interface Score {
  proximity: number;
  exposure: number;
  activity: number;
  oi: number;
  confluence: number;
  total: number; // out of 13 automatic points
}
export interface Zone {
  lo: number;
  hi: number;
  price: number; // representative price (midpoint)
  sources: Source[];
  role: Role;
  score: Score;
  grade: 'main' | 'secondary' | 'reserve' | 'drop';
  label?: string; // S1…S5 / R1…R5
}

export const GRADE_LABEL: Record<Lang, Record<Zone['grade'], string>> = {
  vi: { main: 'Chính', secondary: 'Phụ', reserve: 'Dự phòng', drop: 'Bỏ' },
  en: { main: 'Main', secondary: 'Secondary', reserve: 'Reserve', drop: 'Drop' },
};

export function buildLevelMap(r: ExposureResult) {
  const S = r.spot;
  const em = r.expectedMove?.em1d ?? (S * 0.01);
  const bandLo = S - 2 * em;
  const bandHi = S + 2 * em;
  const inBand = (x: number | null): x is number => x != null && x >= bandLo && x <= bandHi;
  const rows = r.allStrikes.filter((row) => row.K >= bandLo && row.K <= bandHi);

  const cands: { price: number; source: Source }[] = [];
  const add = (price: number | null, source: Source) => inBand(price) && cands.push({ price, source });
  add(r.zeroGamma, 'flip');
  add(r.callWall, 'callWall');
  add(r.putWall, 'putWall');
  add(r.hvl, 'hvl');
  r.nodes.pos.filter((n) => inBand(n.K)).slice(0, 4).forEach((n) => add(n.K, 'posNode'));
  r.nodes.neg.filter((n) => inBand(n.K)).slice(0, 4).forEach((n) => add(n.K, 'negNode'));
  if (r.expectedMove) {
    add(r.expectedMove.hi, 'emHigh');
    add(r.expectedMove.lo, 'emLow');
  }
  [...rows].filter((x) => x.shortVol > 0).sort((a, b) => b.shortVol - a.shortVol).slice(0, 2).forEach((x) => add(x.K, 'short'));

  // Merge candidates closer than one strike step into a zone
  const tol = Math.max(r.strikeStep, S * 0.0005);
  cands.sort((a, b) => a.price - b.price);
  const groups: { lo: number; hi: number; sources: Set<Source> }[] = [];
  for (const c of cands) {
    const g = groups[groups.length - 1];
    if (g && c.price - g.hi <= tol) {
      g.hi = Math.max(g.hi, c.price);
      g.sources.add(c.source);
    } else groups.push({ lo: c.price, hi: c.price, sources: new Set([c.source]) });
  }

  const maxGex = Math.max(...rows.map((x) => Math.abs(x.netGex)), 1e-9);
  const maxShort = Math.max(...rows.map((x) => x.shortVol), 1e-9);
  const maxOi = Math.max(...rows.map((x) => x.callOi + x.putOi), 1e-9);
  const tier = (ratio: number, cuts: number[]) => cuts.filter((c) => ratio >= c).length;

  const zones: Zone[] = groups.map((g) => {
    const price = (g.lo + g.hi) / 2;
    // strikes inside the zone, or the nearest strike when the zone sits between strikes (EM edge, flip)
    let zr: StrikeRow[] = rows.filter((x) => x.K >= g.lo - 1e-9 && x.K <= g.hi + 1e-9);
    if (!zr.length && rows.length) zr = [rows.reduce((b, x) => (Math.abs(x.K - price) < Math.abs(b.K - price) ? x : b))];
    const d = Math.abs(price - S) / em;
    const sources = [...g.sources];
    const families = new Set(sources.map((s) => FAMILY[s]));
    const score: Score = {
      proximity: d <= 0.5 ? 3 : d <= 1 ? 2 : d <= 1.5 ? 1 : 0,
      exposure: g.sources.has('flip') ? 3 : tier(Math.max(0, ...zr.map((x) => Math.abs(x.netGex))) / maxGex, [0.1, 0.25, 0.5]),
      activity: tier(Math.max(0, ...zr.map((x) => x.shortVol)) / maxShort, [0.2, 0.5]),
      oi: tier(Math.max(0, ...zr.map((x) => x.callOi + x.putOi)) / maxOi, [0.2, 0.5]),
      confluence: Math.min(3, families.size - 1),
      total: 0,
    };
    score.total = score.proximity + score.exposure + score.activity + score.oi + score.confluence;
    const role = ROLE.find(([s]) => g.sources.has(s))![1]; // every source has a role
    const grade: Zone['grade'] = score.total >= 12 ? 'main' : score.total >= 9 ? 'secondary' : score.total >= 6 ? 'reserve' : 'drop';
    return { lo: g.lo, hi: g.hi, price, sources, role, score, grade };
  });

  const pick = (side: Zone[], prefix: 'S' | 'R') =>
    side
      .filter((z) => z.grade !== 'drop' || z.sources.includes('flip'))
      .sort((a, b) => b.score.total - a.score.total || Math.abs(a.price - S) - Math.abs(b.price - S))
      .slice(0, 5)
      .sort((a, b) => Math.abs(a.price - S) - Math.abs(b.price - S))
      .map((z, i) => ({ ...z, label: `${prefix}${i + 1}` }));

  return {
    supports: pick(zones.filter((z) => z.price < S), 'S'),
    resistances: pick(zones.filter((z) => z.price > S), 'R'),
    zones,
    em,
  };
}
export type LevelMap = ReturnType<typeof buildLevelMap>;
