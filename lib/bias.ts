/**
 * bias.ts — turns exposures into the curriculum's reading: GEX × DEX matrix (Module 3 §8), the bias
 * sentence (Module 3 §9), no-trade warnings (Modules 5, 8, 9) and a pre-market plan (Module 11 §3).
 * Everything here is a starting point for the trader's own read, not a signal.
 * Text comes in both UI languages; `lang` defaults to 'vi' (the curriculum's language).
 */
import { nyDate, type Chain } from './core.ts';
import { profileReason, type ExposureResult } from './exposure.ts';
import type { Lang } from './i18n.ts';
import { ROLE_LABEL, type LevelMap, type Zone } from './levels.ts';
import { IV_TREND_LABEL, type IvTrend, type TermShape } from './vol.ts';

export type GexState = 'positive' | 'neutral' | 'negative';
export type DexState = 'bullish' | 'neutral' | 'bearish';

export const GEX_LABEL: Record<Lang, Record<GexState, string>> = {
  vi: { positive: 'GEX dương', neutral: 'GEX trung tính', negative: 'GEX âm' },
  en: { positive: 'Positive GEX', neutral: 'Neutral GEX', negative: 'Negative GEX' },
};
export const DEX_LABEL: Record<Lang, Record<DexState, string>> = {
  vi: { bullish: 'DEX Bullish', neutral: 'DEX Trung tính', bearish: 'DEX Bearish' },
  en: { bullish: 'DEX Bullish', neutral: 'DEX Neutral', bearish: 'DEX Bearish' },
};
/** Matrix headers and pills: the state without the "GEX" / "DEX" prefix. */
export const GEX_SHORT: Record<Lang, Record<GexState, string>> = {
  vi: { positive: 'dương', neutral: 'trung tính', negative: 'âm' },
  en: { positive: 'positive', neutral: 'neutral', negative: 'negative' },
};
export const DEX_SHORT: Record<Lang, Record<DexState, string>> = {
  vi: { bullish: 'Bullish', neutral: 'Trung tính', bearish: 'Bearish' },
  en: { bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish' },
};

/** Curriculum Module 3 §8, verbatim (vi) and translated (en). */
export const MATRIX: Record<Lang, Record<GexState, Record<DexState, string>>> = {
  vi: {
    positive: { bullish: 'Tăng nhưng chop', neutral: 'Cân bằng / chờ xác nhận', bearish: 'Xung đột / rủi ro squeeze' },
    neutral: { bullish: 'Hỗ trợ hướng đang hình thành', neutral: 'Không có lợi thế rõ', bearish: 'Áp lực bán có hướng' },
    negative: { bullish: 'Đuổi theo đà tăng có thể thất bại', neutral: 'Có thể văng mạnh cả hai chiều', bearish: 'Bearish và nhanh hơn' },
  },
  en: {
    positive: { bullish: 'Up but choppy', neutral: 'Balanced / wait for confirmation', bearish: 'Conflict / squeeze risk' },
    neutral: { bullish: 'Directional support forming', neutral: 'No clear edge', bearish: 'Directional selling pressure' },
    negative: { bullish: 'Chasing upside may fail', neutral: 'Can whip hard both ways', bearish: 'Bearish and faster' },
  },
};

/** DEX / Σ|DEX| beyond ±0.10 counts as a lean. Calibrate against your own journal. */
export const DEX_LEAN = 0.1;

export function gexState(r: ExposureResult): GexState {
  return r.nearFlip ? 'neutral' : r.regime;
}
export function dexState(r: ExposureResult): DexState {
  const x = r.totals.dexRatio;
  return x >= DEX_LEAN ? 'bullish' : x <= -DEX_LEAN ? 'bearish' : 'neutral';
}

export const fmtLevel = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) >= 1000 ? 0 : 2 });
export const zoneText = (z: Zone | undefined, lang: Lang = 'vi') =>
  !z ? '—' : `${z.label} ${z.hi - z.lo > 1e-9 ? `${fmtLevel(z.lo)}–${fmtLevel(z.hi)}` : fmtLevel(z.price)} (${ROLE_LABEL[lang][z.role].toLowerCase()})`;

const TXT = {
  vi: {
    regime: { positive: 'giảm chấn', negative: 'khuếch đại', neutral: 'chuyển tiếp (sát gamma flip)' } as Record<GexState, string>,
    dir: { bullish: 'tăng', bearish: 'giảm', neutral: 'trung tính' } as Record<DexState, string>,
    ivUnknown: 'chưa rõ (thiếu IV30)',
    sentence: (regime: string, dir: string, iv: string, r1: string, s1: string, cell: string) =>
      `Chế độ đang ${regime}. Áp lực hướng đang ${dir}. Biến động đang ${iv}. ` +
      `Level chính là ${r1} phía trên và ${s1} phía dưới. ` +
      `Do đó bias là: ${cell}.`,
    messy: (why: string) => `Profile lộn xộn — ${why}. Giáo trình: bỏ qua options data hôm nay.`,
    thin: (why: string) => `${why}. Ảnh hưởng hedge có thể không đáng kể.`,
    nearFlip: 'Giá sát gamma flip: vùng chuyển tiếp, khó đoán nhất. Giảm size hoặc đứng ngoài.',
    conflict: 'GEX dương nhưng DEX bearish: hai tầng nói ngược nhau, cần thêm xác nhận.',
    ivExpanding: 'IV đang bụng ra: fade hai biên nguy hiểm hơn bình thường.',
    frontRich: 'Front-end IV đắt hơn kỳ 30 ngày: rủi ro sự kiện ngắn hạn, giảm tin tưởng level ngắn hạn.',
    emExceeded: 'Giá đã đi xa hơn expected move 1 ngày so với close hôm trước: đang mở rộng, cẩn thận với lệnh fade.',
    manage: {
      positive: 'Positive gamma: target nhỏ, chốt sớm, fade hai biên sau khi có rejection.',
      negative: 'Negative gamma: target rộng hơn, có thể giữ runner, nhưng stop phải thực tế — đừng tăng size vì target rộng.',
      neutral: 'Sát flip: vùng chuyển tiếp — giảm size hoặc đứng ngoài cho tới khi có acceptance rõ.',
    } as Record<GexState, string>,
    scShort: (zone: string, t1: string, t2: string, stop: string) =>
      `Nếu giá lên ${zone} và thấy rejection/absorption → short, T1 = ${t1}, T2 = ${t2}, sai nếu chấp nhận trên ${stop}.`,
    scLong: (zone: string, t1: string, t2: string, stop: string) =>
      `Nếu giá xuống ${zone} và bid hấp thụ → long, T1 = ${t1}, T2 = ${t2}, sai nếu chấp nhận dưới ${stop}.`,
    scFlipShort: (zg: string, t1: string, t2: string) =>
      `Nếu giá chấp nhận dưới flip ${zg}, IV bụng và DEX bearish → Setup 8 short, T1 = ${t1}, T2 = ${t2}, sai nếu giành lại và giữ trên ${zg}.`,
    scFlipLong: (zg: string, t1: string, t2: string) =>
      `Nếu giá chấp nhận trên flip ${zg} với DEX/IV ủng hộ → Setup 8 long, T1 = ${t1}, T2 = ${t2}, sai nếu mất lại ${zg}.`,
    j: {
      head: (date: string, fut: string, sym: string) => `NGÀY: ${date}      SẢN PHẨM: ${fut} (${sym})      PHIÊN:`,
      regime: 'Chế độ',
      green: 'xanh (positive gamma)',
      red: 'đỏ (negative gamma)',
      nearFlip: ' — giá sát flip',
      speedPos: 'dương (khó lên, dễ xuống)',
      speedNeg: 'âm (khó xuống, dễ lên)',
      em: 'EM ngày',
      negNodes: 'Node âm',
      posNodes: 'Node dương',
      bias: 'Bias',
      res: 'Kháng cự',
      sup: 'Hỗ trợ',
      own: ['Level riêng', '(VAH/VAL/POC, composite)'],
      confluence: ['Hợp lưu', '(có/không, ở đâu)'],
      scenario: (i: number) => `Kịch bản ${i}`,
      noTrade: 'Không trade nếu',
      fillIn: '(điền điều kiện của bạn)',
      inSession: '--- TRONG PHIÊN ---',
      changes: ['Thay đổi', '(IV / DEX / level bị chấp nhận / flow mới)'],
      trade: '--- LỆNH ---',
      setup: ['Setup số', '(1-8)'],
      levelSrc: 'Level + nguồn:',
      exit: ['Exit thực tế', 'MFE:        MAE:'],
      readRow: ['Bài đọc', 'đúng / sai - vì:'],
      execRow: ['Thực thi', 'đúng / sai - vì:'],
      skipped: ['Tầng bị bỏ', '(regime / bias / level / confirmation / plan / không)'],
      lesson: 'Một bài học:',
    },
  },
  en: {
    regime: { positive: 'dampening', negative: 'amplifying', neutral: 'transitional (near the gamma flip)' } as Record<GexState, string>,
    dir: { bullish: 'up', bearish: 'down', neutral: 'neutral' } as Record<DexState, string>,
    ivUnknown: 'unclear (no IV30)',
    sentence: (regime: string, dir: string, iv: string, r1: string, s1: string, cell: string) =>
      `The regime is ${regime}. Directional pressure is ${dir}. Volatility is ${iv}. ` +
      `Key levels are ${r1} above and ${s1} below. ` +
      `So the bias is: ${cell}.`,
    messy: (why: string) => `Messy profile — ${why}. Curriculum: skip options data today.`,
    thin: (why: string) => `${why}. Hedging impact may be negligible.`,
    nearFlip: 'Price is near the gamma flip: transition zone, the hardest to read. Reduce size or stand aside.',
    conflict: 'Positive GEX but bearish DEX: the two layers disagree, wait for extra confirmation.',
    ivExpanding: 'IV is expanding: fading both edges is more dangerous than usual.',
    frontRich: 'Front-end IV is richer than the 30-day expiry: short-term event risk, trust short-term levels less.',
    emExceeded: 'Price has moved more than the 1-day expected move from the previous close: the range is expanding, be careful with fades.',
    manage: {
      positive: 'Positive gamma: small targets, take profit early, fade both edges after a rejection.',
      negative: 'Negative gamma: wider targets, a runner can be held, but stops must be realistic — do not size up because targets are wider.',
      neutral: 'Near the flip: transition zone — reduce size or stand aside until there is clear acceptance.',
    } as Record<GexState, string>,
    scShort: (zone: string, t1: string, t2: string, stop: string) =>
      `If price rallies into ${zone} and shows rejection/absorption → short, T1 = ${t1}, T2 = ${t2}, wrong on acceptance above ${stop}.`,
    scLong: (zone: string, t1: string, t2: string, stop: string) =>
      `If price drops into ${zone} and bids absorb → long, T1 = ${t1}, T2 = ${t2}, wrong on acceptance below ${stop}.`,
    scFlipShort: (zg: string, t1: string, t2: string) =>
      `If price accepts below the flip ${zg} with IV expanding and DEX bearish → Setup 8 short, T1 = ${t1}, T2 = ${t2}, wrong if it reclaims and holds above ${zg}.`,
    scFlipLong: (zg: string, t1: string, t2: string) =>
      `If price accepts above the flip ${zg} with DEX/IV support → Setup 8 long, T1 = ${t1}, T2 = ${t2}, wrong if it loses ${zg} again.`,
    j: {
      head: (date: string, fut: string, sym: string) => `DATE: ${date}      PRODUCT: ${fut} (${sym})      SESSION:`,
      regime: 'Regime',
      green: 'green (positive gamma)',
      red: 'red (negative gamma)',
      nearFlip: ' — price near flip',
      speedPos: 'positive (hard up, easy down)',
      speedNeg: 'negative (hard down, easy up)',
      em: 'Day EM',
      negNodes: 'Negative nodes',
      posNodes: 'Positive nodes',
      bias: 'Bias',
      res: 'Resistance',
      sup: 'Support',
      own: ['Own levels', '(VAH/VAL/POC, composite)'],
      confluence: ['Confluence', '(yes/no, where)'],
      scenario: (i: number) => `Scenario ${i}`,
      noTrade: 'No trade if',
      fillIn: '(fill in your conditions)',
      inSession: '--- IN SESSION ---',
      changes: ['Changes', '(IV / DEX / level accepted / new flow)'],
      trade: '--- TRADE ---',
      setup: ['Setup #', '(1-8)'],
      levelSrc: 'Level + source:',
      exit: ['Actual exit', 'MFE:        MAE:'],
      readRow: ['Read', 'right / wrong - because:'],
      execRow: ['Execution', 'right / wrong - because:'],
      skipped: ['Layer skipped', '(regime / bias / level / confirmation / plan / none)'],
      lesson: 'One lesson:',
    },
  },
};

export interface Reading {
  gex: GexState;
  dex: DexState;
  cell: string;
  iv: IvTrend | null;
  sentence: string;
  warnings: string[];
  management: string;
  charmActive: boolean;
}

export function read(chain: Chain, r: ExposureResult, map: LevelMap, iv: IvTrend | null, term: TermShape | null, nowMs = Date.now(), lang: Lang = 'vi'): Reading {
  const T = TXT[lang];
  const g = gexState(r);
  const d = dexState(r);
  const cell = MATRIX[lang][g][d];
  const sentence = T.sentence(
    T.regime[g],
    T.dir[d],
    iv ? IV_TREND_LABEL[lang][iv] : T.ivUnknown,
    zoneText(map.resistances[0], lang),
    zoneText(map.supports[0], lang),
    cell.toLowerCase(),
  );

  const warnings: string[] = [];
  if (r.profile.quality === 'messy') warnings.push(T.messy(profileReason(r.profile, lang)));
  if (r.profile.quality === 'thin') warnings.push(T.thin(profileReason(r.profile, lang)));
  if (r.nearFlip) warnings.push(T.nearFlip);
  if (g === 'positive' && d === 'bearish') warnings.push(T.conflict);
  if (iv === 'expanding' && g !== 'negative') warnings.push(T.ivExpanding);
  if (term === 'front-rich') warnings.push(T.frontRich);
  const em = r.expectedMove;
  if (em && chain.prevClose && Math.abs(chain.spot - chain.prevClose) > em.em1d) warnings.push(T.emExceeded);

  const t = nyDate(nowMs);
  const charmActive = t.h * 60 + t.min >= 11 * 60 + 30 && t.h < 16;

  return { gex: g, dex: d, cell, iv, sentence, warnings, management: T.manage[g], charmActive };
}

/** IF–THEN scenarios (Module 9 §A5): at most 3, built only from levels on the map. */
export function scenarios(r: ExposureResult, map: LevelMap, g: GexState, lang: Lang = 'vi'): string[] {
  const T = TXT[lang];
  const [r1, r2] = map.resistances;
  const [s1, s2] = map.supports;
  const out: string[] = [];
  if (g === 'positive') {
    if (r1) out.push(T.scShort(zoneText(r1, lang), s1 ? fmtLevel(s1.price) : fmtLevel(r.hvl), s2 ? fmtLevel(s2.price) : '—', fmtLevel(r1.hi)));
    if (s1) out.push(T.scLong(zoneText(s1, lang), r1 ? fmtLevel(r1.price) : fmtLevel(r.hvl), r2 ? fmtLevel(r2.price) : '—', fmtLevel(s1.lo)));
  }
  if (r.zeroGamma != null) {
    const zg = fmtLevel(r.zeroGamma);
    const below = map.supports.filter((z) => z.price < r.zeroGamma!);
    const above = map.resistances.filter((z) => z.price > r.zeroGamma!);
    if (r.spot >= r.zeroGamma) {
      out.push(T.scFlipShort(zg, below[0] ? fmtLevel(below[0].price) : '—', below[1] ? fmtLevel(below[1].price) : fmtLevel(r.putWall)));
    } else {
      out.push(T.scFlipLong(zg, above[0] ? fmtLevel(above[0].price) : '—', above[1] ? fmtLevel(above[1].price) : fmtLevel(r.callWall)));
    }
  }
  return out.slice(0, 3);
}

/** Module 11 §5 journal header, pre-filled from data. Blank fields are the trader's own. */
export function premarketText(chain: Chain, r: ExposureResult, map: LevelMap, rd: Reading, futCode: string, lang: Lang = 'vi'): string {
  const J = TXT[lang].j;
  const row = (k: string, v = '') => `${k}:`.padEnd(18) + v;
  const pair = ([k, v]: string[]) => row(k, v);
  const em = r.expectedMove;
  const nodes = (rows: { K: number; netContracts: number }[]) =>
    rows.slice(0, 4).map((x) => `${fmtLevel(x.K)} (${Math.round(x.netContracts).toLocaleString('en-US')})`).join(', ') || '—';
  const sc = scenarios(r, map, rd.gex, lang);
  const t = nyDate(Date.now());
  const date = `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const speed = r.speed === 'positive' ? J.speedPos : r.speed === 'negative' ? J.speedNeg : '—';
  return [
    J.head(date, futCode, chain.symbol),
    '',
    '--- PREMARKET ---',
    row(J.regime, `${r.regime === 'positive' ? J.green : J.red}, flip ${fmtLevel(r.zeroGamma)}${r.nearFlip ? J.nearFlip : ''}, speed ${speed}`),
    row(J.em, `${em ? `±${fmtLevel(em.em1d)} → ${fmtLevel(em.lo)} – ${fmtLevel(em.hi)} (IV ${(em.iv1d * 100).toFixed(1)}%, ${em.source})` : '—'} | IV: ${rd.iv ? IV_TREND_LABEL[lang][rd.iv] : '—'}`),
    row(J.negNodes, nodes(r.nodes.neg)),
    row(J.posNodes, nodes(r.nodes.pos)),
    row(J.bias, `${rd.cell} (${GEX_LABEL[lang][rd.gex]} × ${DEX_LABEL[lang][rd.dex]})`),
    row(J.res, map.resistances.map((z) => `${z.label} ${fmtLevel(z.price)}`).join(' · ') || '—'),
    row(J.sup, map.supports.map((z) => `${z.label} ${fmtLevel(z.price)}`).join(' · ') || '—'),
    pair(J.own),
    pair(J.confluence),
    ...sc.map((s, i) => row(J.scenario(i + 1), s)),
    row(J.noTrade, rd.warnings.length ? rd.warnings.join(' ') : J.fillIn),
    '',
    J.inSession,
    pair(J.changes),
    '',
    J.trade,
    pair(J.setup),
    J.levelSrc,
    'Confirmation:',
    'Entry / Stop / T1 / T2 / Size:',
    pair(J.exit),
    '',
    '--- REVIEW ---',
    pair(J.readRow),
    pair(J.execRow),
    pair(J.skipped),
    J.lesson,
  ].join('\n');
}
