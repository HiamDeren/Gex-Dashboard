'use client';
/** SVG charts. Each one measures its container and redraws on resize. */
import { useMemo, type ReactNode } from 'react';
import type { StrikeRow } from '@/lib/exposure';
import type { Heatmap as HeatmapData } from '@/lib/heatmap';
import type { SmilePoint, TermPoint } from '@/lib/vol';
import { compact, etTime, int, lvl, money, pct, px, strikeFmt } from '@/lib/format';
import { COLORS, niceTicks, spreadLabels, Tag, useTip, useWidth } from './ui';

type Mapper = { map: (x: number) => number } | null;
export interface LevelLine {
  v: number | null | undefined;
  color: string;
  name: string;
  dash?: string;
}

// ---------------------------------------------------------------------------------------------
// Strike profile: horizontal bars, price on Y
// ---------------------------------------------------------------------------------------------
export type Metric = 'gex' | 'dex' | 'vanna' | 'charm' | 'contracts';
export const METRIC_LABEL: Record<Metric, string> = {
  gex: 'GEX',
  dex: 'DEX',
  vanna: 'Vanna',
  charm: 'Charm',
  contracts: 'Net contracts',
};
export const METRIC_NOTE: Record<Metric, string> = {
  gex: '$ delta dealer đổi khi giá đi 1%',
  dex: '$ delta người giữ option nắm (call +, put −)',
  vanna: 'Dòng hedge dealer nếu IV +1 điểm (+ = mua)',
  charm: 'Dòng hedge dealer mỗi ngày do thời gian trôi (+ = mua)',
  contracts: 'Vị thế ròng dealer (mô hình naive): + = long option, − = short',
};

function metricValues(r: StrikeRow, metric: Metric, split: boolean): [number, number] | number {
  switch (metric) {
    case 'gex':
      return split ? [r.callGex, r.putGex] : r.netGex;
    case 'dex':
      return split ? [r.callDex, r.putDex] : r.dex;
    case 'vanna':
      return -r.vanna; // dealer hedge flow for +1 vol point
    case 'charm':
      return -r.charm; // dealer hedge flow per day
    case 'contracts':
      return r.netContracts;
  }
}

export function StrikeProfile({
  rows, spot, rangePct, metric, split, lines, mapper, nodeMin, height,
}: {
  rows: StrikeRow[]; spot: number; rangePct: number; metric: Metric; split: boolean; lines: LevelLine[]; mapper: Mapper; nodeMin: number; height: number;
}) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(W0, 320);
  const H = height;
  const padL = 70, padR = 150, padT = 12, padB = 26;
  const lo = spot * (1 - rangePct / 100);
  const hi = spot * (1 + rangePct / 100);
  const canSplit = split && (metric === 'gex' || metric === 'dex');
  const fmt = metric === 'contracts' ? compact : (x: number) => money(x);

  const geo = useMemo(() => {
    const y = (K: number) => padT + ((hi - K) / (hi - lo)) * (H - padT - padB);
    const vals = rows.map((r) => metricValues(r, metric, canSplit));
    const maxAbs = Math.max(1e-9, ...vals.map((v) => (Array.isArray(v) ? Math.max(Math.abs(v[0]), Math.abs(v[1])) : Math.abs(v))), metric === 'contracts' ? nodeMin * 1.1 : 0);
    const x0 = padL + (W - padL - padR) / 2;
    const half = (W - padL - padR) / 2;
    const xs = (v: number) => x0 + (v / maxAbs) * half;
    const gaps = rows.slice(1).map((s, i) => s.K - rows[i].K).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : (hi - lo) / 40;
    const bh = Math.max(1, Math.min(16, (((H - padT - padB) * gap) / (hi - lo)) * 0.78));
    return { y, vals, maxAbs, x0, xs, bh };
  }, [rows, metric, canSplit, W, H, hi, lo, nodeMin]);

  if (!rows.length) return <div className="empty">Không có strike trong khoảng — nới Range hoặc đổi Expiry.</div>;
  const { y, vals, maxAbs, x0, xs, bh } = geo;
  const posFill = 'url(#pfPos)';
  const negFill = metric === 'contracts' ? 'url(#pfNegC)' : 'url(#pfNeg)';

  const bar = (key: string, a: number, b: number, yy: number, fill: string) => {
    const x = Math.min(a, b), w = Math.abs(b - a);
    return w < 0.3 ? null : <rect key={key} x={x} y={yy} width={w} height={bh} rx={Math.min(3, bh / 2, w / 2)} fill={fill} />;
  };

  const labels = spreadLabels(
    lines.filter((l) => l.v != null && l.v >= lo && l.v <= hi).map((l) => ({ ...l, v: l.v as number, y: y(l.v as number) })),
  );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const yv = ((e.clientY - b.top) / b.height) * H;
    const K = hi - ((yv - padT) / (H - padT - padB)) * (hi - lo);
    let best: StrikeRow | null = null;
    for (const r of rows) if (!best || Math.abs(r.K - K) < Math.abs(best.K - K)) best = r;
    if (!best) return tip.hide();
    tip.show(e, <StrikeTip r={best} mapper={mapper} />);
  };

  return (
    <div className="svg-host" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${METRIC_LABEL[metric]} theo strike`} onMouseMove={onMove} onMouseLeave={tip.hide}>
        <defs>
          <linearGradient id="pfPos" x1="0" x2="1"><stop offset="0" stopColor={COLORS.call} stopOpacity="0.55" /><stop offset="1" stopColor={COLORS.call} /></linearGradient>
          <linearGradient id="pfNeg" x1="1" x2="0"><stop offset="0" stopColor={COLORS.put} stopOpacity="0.55" /><stop offset="1" stopColor={COLORS.put} /></linearGradient>
          <linearGradient id="pfNegC" x1="1" x2="0"><stop offset="0" stopColor={COLORS.flip} stopOpacity="0.55" /><stop offset="1" stopColor={COLORS.flip} /></linearGradient>
        </defs>
        {niceTicks(lo, hi, 10).map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={COLORS.grid} />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end">{t.toLocaleString('en-US')}</text>
          </g>
        ))}
        <line x1={x0} x2={x0} y1={padT} y2={H - padB} stroke={COLORS.line} />
        {metric === 'contracts' &&
          [nodeMin, -nodeMin].map((v) => (
            <line key={v} x1={xs(v)} x2={xs(v)} y1={padT} y2={H - padB} stroke={COLORS.line} strokeDasharray="3 4" />
          ))}
        <text x={padL} y={H - 6}>{fmt(-maxAbs)}</text>
        <text x={x0} y={H - 6} textAnchor="middle">0</text>
        <text x={W - padR} y={H - 6} textAnchor="end">{fmt(maxAbs)}</text>
        {rows.map((r, i) => {
          const v = vals[i];
          const yy = y(r.K) - bh / 2;
          if (Array.isArray(v)) {
            return (
              <g key={r.K}>
                {bar('c', xs(0), xs(v[0]), yy, v[0] >= 0 ? posFill : negFill)}
                {bar('p', xs(0), xs(v[1]), yy, v[1] >= 0 ? posFill : negFill)}
              </g>
            );
          }
          return bar(String(r.K), xs(0), xs(v), yy, v >= 0 ? posFill : negFill);
        })}
        {labels.map((l) => (
          <line key={`l${l.name}`} x1={padL} x2={W - padR + 6} y1={y(l.v)} y2={y(l.v)} stroke={l.color} strokeWidth={1.25} strokeOpacity={0.9} strokeDasharray={l.dash} />
        ))}
        {labels.map((l) => (
          <Tag key={`t${l.name}`} x={W - padR + 10} y={l.y} text={`${l.name} ${lvl(l.v)}`} color={l.color} />
        ))}
      </svg>
      {tip.node}
    </div>
  );
}

function StrikeTip({ r, mapper }: { r: StrikeRow; mapper: Mapper }) {
  return (
    <>
      <b>{strikeFmt(r.K)}</b>
      {mapper ? ` → ${px(mapper.map(r.K))}` : ''}
      <br />
      GEX {money(r.netGex)} <span className="sub">(<span className="pos">C {money(r.callGex)}</span> · <span className="neg">P {money(r.putGex)}</span>)</span>
      <br />
      DEX {money(r.dex)} · Net {int(r.netContracts)} hđ
      <br />
      Vanna flow {money(-r.vanna)}/1 vol · Charm flow {money(-r.charm)}/ngày
      <br />
      <span className="sub">
        OI C {int(r.callOi)} / P {int(r.putOi)} · Vol C {int(r.callVol)} / P {int(r.putVol)} · 0-1DTE vol {int(r.shortVol)}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Total GEX if spot moved to … (Black-Scholes repriced)
// ---------------------------------------------------------------------------------------------
export function GexCurve({ curve, spot, zeroGamma, em }: { curve: { S: number; gex: number }[]; spot: number; zeroGamma: number | null; em: { lo: number; hi: number } | null }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(W0, 320);
  const H = 240;
  const padL = 70, padR = 150, padT = 12, padB = 26;
  if (!curve.length) return null;
  const minY = Math.min(0, ...curve.map((p) => p.gex));
  const maxY = Math.max(0, ...curve.map((p) => p.gex));
  const span = maxY - minY || 1;
  const lo = curve[0].S, hi = curve[curve.length - 1].S;
  const x = (S: number) => padL + ((S - lo) / (hi - lo)) * (W - padL - padR);
  const y = (v: number) => padT + ((maxY - v) / span) * (H - padT - padB);
  const y0 = y(0);
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.S).toFixed(1)},${y(p.gex).toFixed(1)}`).join('');
  const area = `${line}L${x(hi)},${y0}L${x(lo)},${y0}Z`;
  const marks: [number | null, string, string, string | undefined][] = [
    [spot, COLORS.spot, 'Spot', '2 3'],
    [zeroGamma, COLORS.flip, 'Zero γ', undefined],
  ];

  return (
    <div className="svg-host" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Tổng GEX theo giá spot"
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const xv = ((e.clientX - b.left) / b.width) * W;
          const S = lo + ((xv - padL) / (W - padL - padR)) * (hi - lo);
          if (S < lo || S > hi) return tip.hide();
          const best = curve.reduce((a, p) => (Math.abs(p.S - S) < Math.abs(a.S - S) ? p : a));
          tip.show(e, <>Nếu spot = <b>{px(best.S)}</b><br />Tổng GEX <span className={best.gex >= 0 ? 'pos' : 'neg'}>{money(best.gex)}</span> / 1%</>);
        }}
        onMouseLeave={tip.hide}
      >
        <defs>
          <clipPath id="gcAbove"><rect x="0" y="0" width={W} height={y0} /></clipPath>
          <clipPath id="gcBelow"><rect x="0" y={y0} width={W} height={H} /></clipPath>
          <linearGradient id="gcA" x1="0" x2="0" y1={padT} y2={y0} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor={COLORS.call} stopOpacity="0.45" /><stop offset="1" stopColor={COLORS.call} stopOpacity="0.03" /></linearGradient>
          <linearGradient id="gcB" x1="0" x2="0" y1={y0} y2={H - padB} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor={COLORS.put} stopOpacity="0.03" /><stop offset="1" stopColor={COLORS.put} stopOpacity="0.45" /></linearGradient>
        </defs>
        {em && em.hi > lo && em.lo < hi && (
          <rect x={x(Math.max(lo, em.lo))} y={padT} width={x(Math.min(hi, em.hi)) - x(Math.max(lo, em.lo))} height={H - padT - padB} fill={COLORS.em} opacity={0.07} />
        )}
        {niceTicks(lo, hi, 8).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={padT} y2={H - padB} stroke={COLORS.grid} />
            <text x={x(t)} y={H - 8} textAnchor="middle">{t.toLocaleString('en-US')}</text>
          </g>
        ))}
        <text x={padL - 10} y={y(maxY) + 10} textAnchor="end">{money(maxY)}</text>
        <text x={padL - 10} y={y(minY)} textAnchor="end">{money(minY)}</text>
        <path d={area} fill="url(#gcA)" clipPath="url(#gcAbove)" />
        <path d={area} fill="url(#gcB)" clipPath="url(#gcBelow)" />
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={COLORS.line} />
        <path d={line} fill="none" stroke={COLORS.call} strokeWidth={2} clipPath="url(#gcAbove)" strokeLinejoin="round" />
        <path d={line} fill="none" stroke={COLORS.put} strokeWidth={2} clipPath="url(#gcBelow)" strokeLinejoin="round" />
        {marks.map(([v, col, name, dash], i) =>
          v == null || v < lo || v > hi ? null : (
            <g key={name}>
              <line x1={x(v)} x2={x(v)} y1={padT} y2={H - padB} stroke={col} strokeWidth={1.25} strokeDasharray={dash} />
              <Tag x={W - padR + 10} y={padT + 12 + i * 26} text={`${name} ${lvl(v)}`} color={col} />
            </g>
          ),
        )}
        {em && <Tag x={W - padR + 10} y={padT + 12 + 2 * 26} text={`EM ${lvl(em.lo)}–${lvl(em.hi)}`} color={COLORS.em} />}
      </svg>
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Heat map: price (Y) × time of day (X)
// ---------------------------------------------------------------------------------------------
export function Heatmap({ hm, spot, kind, mapper }: { hm: HeatmapData; spot: number; kind: 'gamma' | 'charm'; mapper: Mapper }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(W0, 320);
  const H = 420;
  const padL = 70, padR = 12, padT = 10, padB = 28;
  const grid = kind === 'gamma' ? hm.gamma : hm.charm;
  const nT = hm.times.length, nP = hm.prices.length;
  const lo = hm.prices[0], hi = hm.prices[nP - 1];
  const cw = (W - padL - padR) / nT;
  const ch = (H - padT - padB) / nP;
  const max = Math.max(1e-9, ...grid.flat().map(Math.abs));
  const posCol = COLORS.call;
  const negCol = kind === 'gamma' ? COLORS.put : COLORS.flip;
  const yOf = (p: number) => padT + ((hi - p) / (hi - lo)) * (H - padT - padB);
  const labelEvery = Math.max(1, Math.ceil(nT / Math.max(2, Math.floor((W - padL) / 70))));
  const flipPts = hm.flip.map((f, i) => (f == null ? null : `${(padL + (i + 0.5) * cw).toFixed(1)},${yOf(f).toFixed(1)}`));

  const cells: ReactNode[] = [];
  for (let t = 0; t < nT; t++) {
    for (let p = 0; p < nP; p++) {
      const v = grid[t][p];
      const a = Math.sqrt(Math.abs(v) / max) * 0.92;
      if (a < 0.02) continue;
      cells.push(
        <rect key={`${t}-${p}`} x={padL + t * cw} y={padT + (nP - 1 - p) * ch} width={cw + 0.5} height={ch + 0.5} fill={v >= 0 ? posCol : negCol} fillOpacity={a} />,
      );
    }
  }

  return (
    <div className="svg-host" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={kind === 'gamma' ? 'Gamma heat map' : 'Charm heat map'}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const xv = ((e.clientX - b.left) / b.width) * W;
          const yv = ((e.clientY - b.top) / b.height) * H;
          const t = Math.floor((xv - padL) / cw);
          const p = nP - 1 - Math.floor((yv - padT) / ch);
          if (t < 0 || t >= nT || p < 0 || p >= nP) return tip.hide();
          const v = grid[t][p];
          tip.show(
            e,
            <>
              <b>{px(hm.prices[p])}</b>
              {mapper ? ` → ${px(mapper.map(hm.prices[p]))}` : ''} · {etTime(hm.times[t])} ET
              <br />
              {kind === 'gamma' ? (
                <>GEX <span className={v >= 0 ? 'pos' : 'neg'}>{money(v)}</span> / 1%</>
              ) : (
                <>Charm flow <span className={v >= 0 ? 'pos' : 'warn'}>{money(v)}</span> / giờ ({v >= 0 ? 'dealer mua thụ động' : 'dealer bán thụ động'})</>
              )}
              {kind === 'gamma' && hm.flip[t] != null && (<><br /><span className="sub">Flip lúc này: {lvl(hm.flip[t])}</span></>)}
            </>,
          );
        }}
        onMouseLeave={tip.hide}
      >
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="rgba(148,163,184,0.03)" />
        {cells}
        {niceTicks(lo, hi, 8).map((t) => (
          <g key={t}>
            <line x1={padL - 4} x2={padL} y1={yOf(t)} y2={yOf(t)} stroke={COLORS.line} />
            <text x={padL - 8} y={yOf(t) + 4} textAnchor="end">{t.toLocaleString('en-US')}</text>
          </g>
        ))}
        {hm.times.map((ms, i) =>
          i % labelEvery ? null : (
            <text key={ms} x={padL + (i + 0.5) * cw} y={H - 8} textAnchor="middle">{etTime(ms)}</text>
          ),
        )}
        {kind === 'gamma' && (
          <polyline points={flipPts.filter(Boolean).join(' ')} fill="none" stroke={COLORS.flip} strokeWidth={2} strokeLinejoin="round" />
        )}
        {spot >= lo && spot <= hi && (
          <>
            <line x1={padL} x2={W - padR} y1={yOf(spot)} y2={yOf(spot)} stroke={COLORS.spot} strokeWidth={1.25} strokeDasharray="4 4" />
            <text className="lbl" x={W - padR - 4} y={yOf(spot) - 6} textAnchor="end" style={{ fill: COLORS.spot }}>Spot {lvl(spot)}</text>
          </>
        )}
      </svg>
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// IV smile for one expiry
// ---------------------------------------------------------------------------------------------
export function SmileChart({ points, spot }: { points: SmilePoint[]; spot: number }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(W0, 320);
  const H = 280;
  const padL = 52, padR = 16, padT = 12, padB = 26;
  if (points.length < 2) return <div className="empty">Không đủ dữ liệu IV cho kỳ hạn này.</div>;
  const ivs = points.flatMap((p) => [p.callIv, p.putIv, p.otmIv]).filter((v): v is number => v != null);
  const minY = Math.min(...ivs) * 0.95, maxY = Math.max(...ivs) * 1.05;
  const lo = points[0].K, hi = points[points.length - 1].K;
  const x = (K: number) => padL + ((K - lo) / (hi - lo || 1)) * (W - padL - padR);
  const y = (v: number) => padT + ((maxY - v) / (maxY - minY || 1)) * (H - padT - padB);
  const path = (f: (p: SmilePoint) => number | null) =>
    points.reduce((s, p) => { const v = f(p); return v == null ? s : s + `${s ? 'L' : 'M'}${x(p.K).toFixed(1)},${y(v).toFixed(1)}`; }, '');

  return (
    <div className="svg-host" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="IV smile"
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const K = lo + (((e.clientX - b.left) / b.width) * W - padL) / (W - padL - padR) * (hi - lo);
          const p = points.reduce((a, q) => (Math.abs(q.K - K) < Math.abs(a.K - K) ? q : a));
          tip.show(e, <><b>{strikeFmt(p.K)}</b> ({pct(p.K / spot - 1, 2)} so với spot)<br />OTM IV {pct(p.otmIv)} · <span className="pos">Call {pct(p.callIv)}</span> · <span className="neg">Put {pct(p.putIv)}</span></>);
        }}
        onMouseLeave={tip.hide}
      >
        {niceTicks(minY, maxY, 5).map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={COLORS.grid} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end">{(t * 100).toFixed(0)}%</text>
          </g>
        ))}
        {niceTicks(lo, hi, 7).map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle">{t.toLocaleString('en-US')}</text>
        ))}
        <path d={path((p) => p.callIv)} fill="none" stroke={COLORS.call} strokeOpacity={0.35} strokeWidth={1.25} />
        <path d={path((p) => p.putIv)} fill="none" stroke={COLORS.put} strokeOpacity={0.35} strokeWidth={1.25} />
        <path d={path((p) => p.otmIv)} fill="none" stroke={COLORS.accent} strokeWidth={2.25} strokeLinejoin="round" />
        {spot >= lo && spot <= hi && <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke={COLORS.spot} strokeDasharray="2 3" />}
      </svg>
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ATM IV term structure
// ---------------------------------------------------------------------------------------------
export function TermChart({ ts }: { ts: TermPoint[] }) {
  const [ref, W0] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const W = Math.max(W0, 320);
  const H = 240;
  const padL = 52, padR = 16, padT = 12, padB = 40;
  if (ts.length < 2) return <div className="empty">Không đủ kỳ hạn.</div>;
  const ivs = ts.map((p) => p.atmIv);
  const minY = Math.min(...ivs) * 0.92, maxY = Math.max(...ivs) * 1.08;
  const x = (i: number) => padL + (i / (ts.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + ((maxY - v) / (maxY - minY || 1)) * (H - padT - padB);
  const every = Math.max(1, Math.ceil(ts.length / Math.max(2, Math.floor((W - padL) / 64))));
  return (
    <div className="svg-host" ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="ATM IV term structure"
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((((e.clientX - b.left) / b.width) * W - padL) / (W - padL - padR)) * (ts.length - 1));
          const p = ts[Math.min(ts.length - 1, Math.max(0, i))];
          tip.show(e, <><b>{p.exp}</b> ({p.days.toFixed(1)} ngày)<br />ATM IV {pct(p.atmIv)} @ {strikeFmt(p.atmK)}<br />25Δ RR {p.rr25 == null ? '—' : `${(p.rr25 * 100).toFixed(1)} vol`}</>);
        }}
        onMouseLeave={tip.hide}
      >
        {niceTicks(minY, maxY, 5).map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={COLORS.grid} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end">{(t * 100).toFixed(1)}%</text>
          </g>
        ))}
        <path d={ts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.atmIv).toFixed(1)}`).join('')} fill="none" stroke={COLORS.accent} strokeWidth={2.25} strokeLinejoin="round" />
        {ts.map((p, i) => (
          <g key={p.exp}>
            <circle cx={x(i)} cy={y(p.atmIv)} r={3} fill={p.days < 0.75 ? COLORS.flip : COLORS.accent} />
            {i % every === 0 && (
              <text x={x(i)} y={H - 22} textAnchor="middle">{p.exp.slice(5)}</text>
            )}
            {i % every === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle">{p.days < 1 ? '0d' : `${Math.round(p.days)}d`}</text>
            )}
          </g>
        ))}
      </svg>
      {tip.node}
    </div>
  );
}
