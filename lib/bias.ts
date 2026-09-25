/**
 * bias.ts — turns exposures into the curriculum's reading: GEX × DEX matrix (Module 3 §8), the bias
 * sentence (Module 3 §9), no-trade warnings (Modules 5, 8, 9) and a pre-market plan (Module 11 §3).
 * Everything here is a starting point for the trader's own read, not a signal.
 */
import { nyDate, type Chain } from './core.ts';
import type { ExposureResult } from './exposure.ts';
import type { LevelMap, Zone } from './levels.ts';
import { IV_TREND_VI, type IvTrend, type TermShape } from './vol.ts';

export type GexState = 'positive' | 'neutral' | 'negative';
export type DexState = 'bullish' | 'neutral' | 'bearish';

export const GEX_VI: Record<GexState, string> = { positive: 'GEX dương', neutral: 'GEX trung tính', negative: 'GEX âm' };
export const DEX_VI: Record<DexState, string> = { bullish: 'DEX Bullish', neutral: 'DEX Trung tính', bearish: 'DEX Bearish' };

/** Curriculum Module 3 §8, verbatim. */
export const MATRIX: Record<GexState, Record<DexState, string>> = {
  positive: { bullish: 'Tăng nhưng chop', neutral: 'Cân bằng / chờ xác nhận', bearish: 'Xung đột / rủi ro squeeze' },
  neutral: { bullish: 'Hỗ trợ hướng đang hình thành', neutral: 'Không có lợi thế rõ', bearish: 'Áp lực bán có hướng' },
  negative: { bullish: 'Đuổi theo đà tăng có thể thất bại', neutral: 'Có thể văng mạnh cả hai chiều', bearish: 'Bearish và nhanh hơn' },
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
const zoneText = (z: Zone | undefined) =>
  !z ? '—' : `${z.label} ${z.hi - z.lo > 1e-9 ? `${fmtLevel(z.lo)}–${fmtLevel(z.hi)}` : fmtLevel(z.price)} (${z.role.toLowerCase()})`;

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

export function read(chain: Chain, r: ExposureResult, map: LevelMap, iv: IvTrend | null, term: TermShape | null, nowMs = Date.now()): Reading {
  const g = gexState(r);
  const d = dexState(r);
  const cell = MATRIX[g][d];
  const regimeVi = g === 'positive' ? 'giảm chấn' : g === 'negative' ? 'khuếch đại' : 'chuyển tiếp (sát gamma flip)';
  const dirVi = d === 'bullish' ? 'tăng' : d === 'bearish' ? 'giảm' : 'trung tính';
  const sentence =
    `Chế độ đang ${regimeVi}. Áp lực hướng đang ${dirVi}. Biến động đang ${iv ? IV_TREND_VI[iv] : 'chưa rõ (thiếu IV30)'}. ` +
    `Level chính là ${zoneText(map.resistances[0])} phía trên và ${zoneText(map.supports[0])} phía dưới. ` +
    `Do đó bias là: ${cell.toLowerCase()}.`;

  const warnings: string[] = [];
  if (r.profile.quality === 'messy') warnings.push(`Profile lộn xộn — ${r.profile.reason}. Giáo trình: bỏ qua options data hôm nay.`);
  if (r.profile.quality === 'thin') warnings.push(`${r.profile.reason}. Ảnh hưởng hedge có thể không đáng kể.`);
  if (r.nearFlip) warnings.push('Giá sát gamma flip: vùng chuyển tiếp, khó đoán nhất. Giảm size hoặc đứng ngoài.');
  if (g === 'positive' && d === 'bearish') warnings.push('GEX dương nhưng DEX bearish: hai tầng nói ngược nhau, cần thêm xác nhận.');
  if (iv === 'expanding' && g !== 'negative') warnings.push('IV đang bụng ra: fade hai biên nguy hiểm hơn bình thường.');
  if (term === 'front-rich') warnings.push('Front-end IV đắt hơn kỳ 30 ngày: rủi ro sự kiện ngắn hạn, giảm tin tưởng level ngắn hạn.');
  const em = r.expectedMove;
  if (em && chain.prevClose && Math.abs(chain.spot - chain.prevClose) > em.em1d) {
    warnings.push('Giá đã đi xa hơn expected move 1 ngày so với close hôm trước: đang mở rộng, cẩn thận với lệnh fade.');
  }

  const management =
    g === 'positive'
      ? 'Positive gamma: target nhỏ, chốt sớm, fade hai biên sau khi có rejection.'
      : g === 'negative'
        ? 'Negative gamma: target rộng hơn, có thể giữ runner, nhưng stop phải thực tế — đừng tăng size vì target rộng.'
        : 'Sát flip: vùng chuyển tiếp — giảm size hoặc đứng ngoài cho tới khi có acceptance rõ.';

  const t = nyDate(nowMs);
  const charmActive = t.h * 60 + t.min >= 11 * 60 + 30 && t.h < 16;

  return { gex: g, dex: d, cell, iv, sentence, warnings, management, charmActive };
}

/** IF–THEN scenarios (Module 9 §A5): at most 3, built only from levels on the map. */
export function scenarios(r: ExposureResult, map: LevelMap, g: GexState): string[] {
  const [r1, r2] = map.resistances;
  const [s1, s2] = map.supports;
  const out: string[] = [];
  if (g === 'positive') {
    if (r1) out.push(`Nếu giá lên ${zoneText(r1)} và thấy rejection/absorption → short, T1 = ${s1 ? fmtLevel(s1.price) : fmtLevel(r.hvl)}, T2 = ${s2 ? fmtLevel(s2.price) : '—'}, sai nếu chấp nhận trên ${fmtLevel(r1.hi)}.`);
    if (s1) out.push(`Nếu giá xuống ${zoneText(s1)} và bid hấp thụ → long, T1 = ${r1 ? fmtLevel(r1.price) : fmtLevel(r.hvl)}, T2 = ${r2 ? fmtLevel(r2.price) : '—'}, sai nếu chấp nhận dưới ${fmtLevel(s1.lo)}.`);
  }
  if (r.zeroGamma != null) {
    const zg = fmtLevel(r.zeroGamma);
    const below = map.supports.filter((z) => z.price < r.zeroGamma!);
    const above = map.resistances.filter((z) => z.price > r.zeroGamma!);
    if (r.spot >= r.zeroGamma) {
      out.push(`Nếu giá chấp nhận dưới flip ${zg}, IV bụng và DEX bearish → Setup 8 short, T1 = ${below[0] ? fmtLevel(below[0].price) : '—'}, T2 = ${below[1] ? fmtLevel(below[1].price) : fmtLevel(r.putWall)}, sai nếu giành lại và giữ trên ${zg}.`);
    } else {
      out.push(`Nếu giá chấp nhận trên flip ${zg} với DEX/IV ủng hộ → Setup 8 long, T1 = ${above[0] ? fmtLevel(above[0].price) : '—'}, T2 = ${above[1] ? fmtLevel(above[1].price) : fmtLevel(r.callWall)}, sai nếu mất lại ${zg}.`);
    }
  }
  return out.slice(0, 3);
}

/** Module 11 §5 journal header, pre-filled from data. Blank fields are the trader's own. */
export function premarketText(chain: Chain, r: ExposureResult, map: LevelMap, rd: Reading, futCode: string): string {
  const em = r.expectedMove;
  const nodes = (rows: { K: number; netContracts: number }[]) =>
    rows.slice(0, 4).map((x) => `${fmtLevel(x.K)} (${Math.round(x.netContracts).toLocaleString('en-US')})`).join(', ') || '—';
  const sc = scenarios(r, map, rd.gex);
  const t = nyDate(Date.now());
  const date = `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  return [
    `NGÀY: ${date}      SẢN PHẨM: ${futCode} (${chain.symbol})      PHIÊN:`,
    '',
    '--- PREMARKET ---',
    `Chế độ:           ${r.regime === 'positive' ? 'xanh (positive gamma)' : 'đỏ (negative gamma)'}, flip ${fmtLevel(r.zeroGamma)}${r.nearFlip ? ' — giá sát flip' : ''}, speed ${r.speed === 'positive' ? 'dương (khó lên, dễ xuống)' : r.speed === 'negative' ? 'âm (khó xuống, dễ lên)' : '—'}`,
    `EM ngày:          ${em ? `±${fmtLevel(em.em1d)} → ${fmtLevel(em.lo)} – ${fmtLevel(em.hi)} (IV ${(em.iv1d * 100).toFixed(1)}%, ${em.source})` : '—'} | IV: ${rd.iv ? IV_TREND_VI[rd.iv] : '—'}`,
    `Node âm:          ${nodes(r.nodes.neg)}`,
    `Node dương:       ${nodes(r.nodes.pos)}`,
    `Bias:             ${rd.cell} (${GEX_VI[rd.gex]} × ${DEX_VI[rd.dex]})`,
    `Kháng cự:         ${map.resistances.map((z) => `${z.label} ${fmtLevel(z.price)}`).join(' · ') || '—'}`,
    `Hỗ trợ:           ${map.supports.map((z) => `${z.label} ${fmtLevel(z.price)}`).join(' · ') || '—'}`,
    'Level riêng:      (VAH/VAL/POC, composite)',
    'Hợp lưu:          (có/không, ở đâu)',
    ...sc.map((s, i) => `Kịch bản ${i + 1}:       ${s}`),
    `Không trade nếu:  ${rd.warnings.length ? rd.warnings.join(' ') : '(điền điều kiện của bạn)'}`,
    '',
    '--- TRONG PHIÊN ---',
    'Thay đổi:         (IV / DEX / level bị chấp nhận / flow mới)',
    '',
    '--- LỆNH ---',
    'Setup số:         (1-8)',
    'Level + nguồn:',
    'Confirmation:',
    'Entry / Stop / T1 / T2 / Size:',
    'Exit thực tế:     MFE:        MAE:',
    '',
    '--- REVIEW ---',
    'Bài đọc:          đúng / sai - vì:',
    'Thực thi:         đúng / sai - vì:',
    'Tầng bị bỏ:       (regime / bias / level / confirmation / plan / không)',
    'Một bài học:',
  ].join('\n');
}
