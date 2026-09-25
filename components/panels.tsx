'use client';
import { useState } from 'react';
import type { Chain } from '@/lib/core';
import type { ExposureResult } from '@/lib/exposure';
import type { LevelMap, Zone } from '@/lib/levels';
import { GRADE_LABEL, ROLE_LABEL, SOURCE_LABEL } from '@/lib/levels';
import { DEX_LEAN, DEX_SHORT, GEX_SHORT, MATRIX, type DexState, type GexState, type Reading } from '@/lib/bias';
import { profileReason } from '@/lib/exposure';
import { IV_TREND_LABEL, type TermPoint, type TermShape } from '@/lib/vol';
import { int, lvl, money, pct, px, strikeFmt } from '@/lib/format';
import { COLORS, Card, useLang } from './ui';

type Mapper = { mode: 'basis' | 'ratio'; value: number; map: (x: number) => number } | null;

// ---------------------------------------------------------------------------------------------
export function RegimeCard({ chain, r, mapper }: { chain: Chain; r: ExposureResult; mapper: Mapper }) {
  const { t } = useLang();
  const dist = r.zeroGamma != null ? chain.spot - r.zeroGamma : null;
  const hp = r.totals.hedgePerPoint;
  return (
    <section className={`card regime ${r.regime}`} aria-live="polite">
      <span className="eyebrow">{t.layer1}</span>
      <strong>{r.regime === 'positive' ? 'Positive gamma' : 'Negative gamma'}</strong>
      <p>
        {r.regime === 'positive' ? t.regimePos : t.regimeNeg}{' '}
        {t.gammaKind[0]}<em>{t.gammaKind[1]}</em>{t.gammaKind[2]}
      </p>
      {r.nearFlip && <p className="warn">{t.nearFlipWarn}</p>}
      <div className="stats">
        <span>Zero gamma (flip)</span>
        <span>{lvl(r.zeroGamma)}{mapper && r.zeroGamma != null ? ` → ${lvl(mapper.map(r.zeroGamma))}` : ''}</span>
        <span>{t.spotVsFlip}</span>
        <span>{dist == null ? '—' : `${dist >= 0 ? '+' : '−'}${px(Math.abs(dist))}`}</span>
        <span>{t.netGexAtSpot}</span>
        <span className={r.totals.gex >= 0 ? 'pos' : 'neg'}>{money(r.totals.gex)} / 1%</span>
        <span>Speed</span>
        <span>{r.speed === 'positive' ? t.speedPos : r.speed === 'negative' ? t.speedNeg : '—'}</span>
        {hp != null && (
          <>
            <span>{t.hedgePerPoint}</span>
            <span>{t.hedgeText(hp >= 0, Math.abs(hp).toFixed(0), r.totals.futCode ?? '')}</span>
          </>
        )}
      </div>
      <Ladder chain={chain} r={r} />
    </section>
  );
}

function Ladder({ chain, r }: { chain: Chain; r: ExposureResult }) {
  const marks = (
    [
      ['PW', r.putWall, COLORS.put],
      ['ZG', r.zeroGamma, COLORS.flip],
      ['CW', r.callWall, COLORS.call],
    ] as [string, number | null, string][]
  ).filter(([, v]) => v != null) as [string, number, string][];
  const vals = [chain.spot, ...marks.map(([, v]) => v)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (!(hi > lo)) return null;
  const pad = (hi - lo) * 0.06;
  const pos = (v: number) => `${(((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(2)}%`;
  return (
    <div className="ladder">
      <div className="rail" />
      {marks.map(([t, v, col]) => (
        <div key={t} className="mk" style={{ left: pos(v) }} title={`${t} ${lvl(v)}`}>
          <span>{t}</span>
          <i style={{ background: col }} />
        </div>
      ))}
      <div className="mk spot" style={{ left: pos(chain.spot) }} title={`Spot ${lvl(chain.spot)}`}>
        <i />
        <span>SPOT</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function BiasCard({ rd, r, chain, term }: { rd: Reading; r: ExposureResult; chain: Chain; term: TermShape | null }) {
  const { lang, t } = useLang();
  const rows: GexState[] = ['positive', 'neutral', 'negative'];
  const cols: DexState[] = ['bullish', 'neutral', 'bearish'];
  return (
    <Card title={t.layer2}>
      <div className="matrix" role="table" aria-label={t.matrixAria}>
        <span />
        {cols.map((c) => <span key={c} className="h">{DEX_SHORT[lang][c]}</span>)}
        {rows.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            <span className="h rh">{GEX_SHORT[lang][g]}</span>
            {cols.map((d) => (
              <span key={d} className={`c${rd.gex === g && rd.dex === d ? ' on' : ''}`}>{MATRIX[lang][g][d]}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="stats">
        <span>DEX / Σ|DEX|</span>
        <span className={rd.dex === 'bullish' ? 'pos' : rd.dex === 'bearish' ? 'neg' : ''}>
          {r.totals.dexRatio >= 0 ? '+' : ''}{r.totals.dexRatio.toFixed(3)} <span className="sub">{t.threshold(DEX_LEAN)}</span>
        </span>
        <span>IV30 CBOE</span>
        <span>
          {chain.iv30 != null ? `${chain.iv30.toFixed(2)}%` : '—'}
          {chain.iv30Change != null ? ` (${chain.iv30Change >= 0 ? '+' : ''}${chain.iv30Change.toFixed(2)})` : ''}
          {rd.iv ? ` · ${IV_TREND_LABEL[lang][rd.iv]}` : ''}
        </span>
        <span>Term structure</span>
        <span>{term === 'front-rich' ? t.frontRich : term === 'normal' ? t.normal : '—'}</span>
      </div>
      <div className="sentence">{rd.sentence}</div>
      {rd.warnings.length > 0 && (
        <ul className="warnings">
          {rd.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <p className="note">{rd.management}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function KpiTiles({ r, rd }: { r: ExposureResult; rd: Reading }) {
  const { lang, t } = useLang();
  const vannaFlow = -r.totals.vanna;
  const charmFlow = -r.totals.charm;
  const act = (x: number) => (x >= 0 ? t.buy : t.sell);
  return (
    <div className="kpis">
      <section className="card kpi">
        <div className="k"><span>GEX</span><span className={`pill ${r.regime}`}>{r.regime === 'positive' ? '+γ' : '−γ'}</span></div>
        <div className={`v ${r.totals.gex >= 0 ? 'pos' : 'neg'}`}>{money(r.totals.gex)}</div>
        <div className="d">{t.kpiGex}</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>DEX</span><span className={`pill ${rd.dex === 'bullish' ? 'positive' : rd.dex === 'bearish' ? 'negative' : 'neutral'}`}>{DEX_SHORT[lang][rd.dex]}</span></div>
        <div className={`v ${r.totals.dex >= 0 ? 'pos' : 'neg'}`}>{money(r.totals.dex)}</div>
        <div className="d">{t.kpiDex(r.totals.dexRatio.toFixed(3), money(r.totals.dexGross, false))}</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>Vanna</span><span className="sub">/ 1 vol</span></div>
        <div className={`v ${vannaFlow >= 0 ? 'pos' : 'neg'}`}>{money(vannaFlow)}</div>
        <div className="d">{t.kpiVanna(act(vannaFlow), money(Math.abs(vannaFlow), false), act(-vannaFlow))}</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>Charm</span><span className="sub">{t.kpiCharmUnit}</span></div>
        <div className={`v ${charmFlow >= 0 ? 'pos' : 'warn'}`}>{money(charmFlow)}</div>
        <div className="d">
          {t.kpiCharm(act(charmFlow), money(Math.abs(charmFlow / 24), false))}
          {!rd.charmActive && t.kpiCharmEarly}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function KeyLevels({ chain, r, mapper }: { chain: Chain; r: ExposureResult; mapper: Mapper }) {
  const { t } = useLang();
  const em = r.expectedMove;
  const f = t.lvFormula;
  const rows: [string, number | null | undefined, string, string][] = [
    [t.lvName.emHi, em?.hi, COLORS.em, 'Spot + Spot × IV × √(1/252)'],
    ['Call wall', r.callWall, COLORS.call, f.callWall],
    ['HVL', r.hvl, COLORS.accent, f.hvl],
    ['Spot', chain.spot, COLORS.spot, f.spot],
    ['Zero gamma', r.zeroGamma, COLORS.flip, f.zeroGamma],
    ['Cumulative flip', r.cumFlip, COLORS.flip, f.cumFlip],
    ['Put wall', r.putWall, COLORS.put, f.putWall],
    [t.lvName.emLo, em?.lo, COLORS.em, 'Spot − Spot × IV × √(1/252)'],
  ];
  return (
    <Card title={t.keyLevels}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Level</th>
            <th>{chain.symbol}</th>
            <th>{mapper ? (mapper.mode === 'basis' ? `Fut (${mapper.value >= 0 ? '+' : ''}${px(mapper.value)})` : `Fut (×${mapper.value.toFixed(3)})`) : 'Futures'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, v, col, formula]) => (
            <tr key={name} className={name === 'Spot' ? 'spotrow' : ''}>
              <td className="name" title={formula}><span className="sw" style={{ background: col }} />{name}</td>
              <td>{lvl(v)}</td>
              <td className={mapper ? '' : 'sub'}>{mapper && v != null ? lvl(mapper.map(v)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function Nodes({ r, nodeMin, mapper }: { r: ExposureResult; nodeMin: number; mapper: Mapper }) {
  const { lang, t } = useLang();
  const list = (rows: ExposureResult['nodes']['pos'], cls: 'pos' | 'neg') => {
    const max = Math.max(1, ...rows.map((x) => Math.abs(x.netContracts)));
    return rows.length ? (
      <ol className="top">
        {rows.slice(0, 5).map((x) => (
          <li key={x.K}>
            <span>{strikeFmt(x.K)}{mapper ? <span className="sub"> → {px(mapper.map(x.K))}</span> : null}</span>
            <span className="bar-t"><i className={cls} style={{ width: `${((Math.abs(x.netContracts) / max) * 100).toFixed(1)}%` }} /></span>
            <span className={cls}>{int(x.netContracts)}</span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="sub">{t.noNodes(int(nodeMin))}</p>
    );
  };
  return (
    <Card title={t.nodesTitle}>
      <h3 style={{ marginTop: 0 }}>{t.posNodes}</h3>
      {list(r.nodes.pos, 'pos')}
      <h3>{t.negNodes}</h3>
      {list(r.nodes.neg, 'neg')}
      <p className="note">
        Profile: <b className={r.profile.quality === 'clean' ? 'pos' : 'warn'}>{t.quality[r.profile.quality]}</b> — {profileReason(r.profile, lang)}.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function ExpectedMoveCard({ r }: { r: ExposureResult }) {
  const { t } = useLang();
  const em = r.expectedMove;
  return (
    <Card title="Expected move">
      {em ? (
        <div className="em-grid">
          <span>{t.em1d}</span><span>±{px(em.em1d)}</span>
          <span>{t.ivUsed(em.source === 'IV30' ? 'IV30 CBOE' : t.atm1d)}</span><span>{pct(em.iv1d)}</span>
          <span>{t.range}</span><span>{lvl(em.lo)} – {lvl(em.hi)}</span>
          <span>Front expiry</span><span>{em.exp}</span>
          <span>ATM straddle ({strikeFmt(em.atmK)})</span><span>{em.straddle != null ? `±${px(em.straddle)}` : '—'}</span>
          <span>IV × √T × S (IV {pct(em.iv)})</span><span>{em.ivMove != null ? `±${px(em.ivMove)}` : '—'}</span>
        </div>
      ) : (
        <p className="sub">{t.notEnoughData}</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function ExportCard({ pine, apiHref }: { pine: string; apiHref: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Card title="Export">
      <div className="export">
        <code>{pine || '—'}</code>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(pine);
              setCopied(t.copied);
            } catch {
              setCopied(t.selectManually);
            }
            setTimeout(() => setCopied(null), 1200);
          }}
        >
          {copied ?? 'Copy'}
        </button>
      </div>
      <a className="api" href={apiHref} target="_blank" rel="noopener">{t.openApi}</a>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function LevelMapTable({ map, spot, mapper }: { map: LevelMap; spot: number; mapper: Mapper }) {
  const { lang, t } = useLang();
  const row = (z: Zone) => {
    const s = z.score;
    const breakdown = t.scoreBreakdown(s.proximity, s.exposure, s.activity, s.oi, s.confluence);
    const range = z.hi - z.lo > 1e-9 ? `${lvl(z.lo)}–${lvl(z.hi)}` : lvl(z.price);
    return (
      <tr key={z.label}>
        <td className={z.label?.startsWith('S') ? 'lbl-s' : 'lbl-r'}>{z.label}</td>
        <td>{range}</td>
        <td className={mapper ? '' : 'sub'}>{mapper ? (z.hi - z.lo > 1e-9 ? `${lvl(mapper.map(z.lo))}–${lvl(mapper.map(z.hi))}` : lvl(mapper.map(z.price))) : '—'}</td>
        <td className="txt">{ROLE_LABEL[lang][z.role]}</td>
        <td className="txt">{z.sources.map((x) => SOURCE_LABEL[lang][x]).join(' · ')}</td>
        <td title={breakdown}>
          <span className="score">
            <span className="bar-t"><i className="acc" style={{ width: `${(s.total / 13) * 100}%` }} /></span>
            {s.total}/13
          </span>
        </td>
        <td><span className={`grade ${z.grade}`}>{GRADE_LABEL[lang][z.grade]}</span></td>
      </tr>
    );
  };
  return (
    <Card title={t.mapTitle}>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th><th>{t.mapCols.zone}</th><th>Futures</th><th>{t.mapCols.role}</th><th>{t.mapCols.sources}</th><th>{t.mapCols.score}</th><th>{t.mapCols.grade}</th>
            </tr>
          </thead>
          <tbody>
            {[...map.resistances].reverse().map(row)}
            <tr className="spotrow">
              <td>Spot</td><td>{lvl(spot)}</td><td className={mapper ? '' : 'sub'}>{mapper ? lvl(mapper.map(spot)) : '—'}</td>
              <td className="txt" colSpan={4}>{t.em1dRow(px(map.em))}</td>
            </tr>
            {map.supports.map(row)}
          </tbody>
        </table>
      </div>
      <p className="note">{t.mapNote}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function TermTable({ ts }: { ts: TermPoint[] }) {
  const { t } = useLang();
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr><th>Expiry</th><th>{t.days}</th><th>ATM IV</th><th>25Δ put</th><th>25Δ call</th><th>RR 25Δ</th></tr>
        </thead>
        <tbody>
          {ts.slice(0, 12).map((p) => (
            <tr key={p.exp}>
              <td>{p.exp}</td>
              <td>{p.days < 1 ? p.days.toFixed(2) : p.days.toFixed(0)}</td>
              <td>{pct(p.atmIv)}</td>
              <td>{pct(p.put25Iv)}</td>
              <td>{pct(p.call25Iv)}</td>
              <td className={p.rr25 != null && p.rr25 > 0 ? 'neg' : ''}>{p.rr25 == null ? '—' : `${(p.rr25 * 100).toFixed(1)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
