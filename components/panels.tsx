'use client';
import { useState } from 'react';
import type { Chain } from '@/lib/core';
import type { ExposureResult } from '@/lib/exposure';
import type { LevelMap, Zone } from '@/lib/levels';
import { GRADE_VI, SOURCE_LABEL } from '@/lib/levels';
import { DEX_LEAN, DEX_VI, GEX_VI, MATRIX, type DexState, type GexState, type Reading } from '@/lib/bias';
import { IV_TREND_VI, type TermPoint, type TermShape } from '@/lib/vol';
import { int, lvl, money, pct, px, strikeFmt } from '@/lib/format';
import { COLORS, Card } from './ui';

type Mapper = { mode: 'basis' | 'ratio'; value: number; map: (x: number) => number } | null;

// ---------------------------------------------------------------------------------------------
export function RegimeCard({ chain, r, mapper }: { chain: Chain; r: ExposureResult; mapper: Mapper }) {
  const dist = r.zeroGamma != null ? chain.spot - r.zeroGamma : null;
  const hp = r.totals.hedgePerPoint;
  return (
    <section className={`card regime ${r.regime}`} aria-live="polite">
      <span className="eyebrow">Tầng 1 · Regime</span>
      <strong>{r.regime === 'positive' ? 'Positive gamma' : 'Negative gamma'}</strong>
      <p>
        {r.regime === 'positive'
          ? 'Hedge của dealer làm dịu chuyển động: chop, pinning, mean reversion.'
          : 'Hedge của dealer khuếch đại chuyển động: trend, biên rộng, tránh fade sớm.'}{' '}
        Gamma cho biết <em>kiểu</em> chuyển động, không cho biết hướng.
      </p>
      {r.nearFlip && <p className="warn">Giá đang sát gamma flip — vùng chuyển tiếp.</p>}
      <div className="stats">
        <span>Zero gamma (flip)</span>
        <span>{lvl(r.zeroGamma)}{mapper && r.zeroGamma != null ? ` → ${lvl(mapper.map(r.zeroGamma))}` : ''}</span>
        <span>Spot so với flip</span>
        <span>{dist == null ? '—' : `${dist >= 0 ? '+' : '−'}${px(Math.abs(dist))}`}</span>
        <span>Net GEX tại spot</span>
        <span className={r.totals.gex >= 0 ? 'pos' : 'neg'}>{money(r.totals.gex)} / 1%</span>
        <span>Speed</span>
        <span>{r.speed === 'positive' ? 'Dương: khó lên, dễ xuống' : r.speed === 'negative' ? 'Âm: khó xuống, dễ lên' : '—'}</span>
        {hp != null && (
          <>
            <span>Hedge / 1 điểm</span>
            <span>
              {hp >= 0 ? 'Dealer bán' : 'Dealer mua'} ~{Math.abs(hp).toFixed(0)} {r.totals.futCode} khi giá +1
            </span>
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
  const rows: GexState[] = ['positive', 'neutral', 'negative'];
  const cols: DexState[] = ['bullish', 'neutral', 'bearish'];
  return (
    <Card title="Tầng 2 · Bias — GEX × DEX">
      <div className="matrix" role="table" aria-label="Ma trận bias GEX × DEX">
        <span />
        {cols.map((c) => <span key={c} className="h">{DEX_VI[c].replace('DEX ', '')}</span>)}
        {rows.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            <span className="h rh">{GEX_VI[g].replace('GEX ', '')}</span>
            {cols.map((d) => (
              <span key={d} className={`c${rd.gex === g && rd.dex === d ? ' on' : ''}`}>{MATRIX[g][d]}</span>
            ))}
          </div>
        ))}
      </div>
      <div className="stats">
        <span>DEX / Σ|DEX|</span>
        <span className={rd.dex === 'bullish' ? 'pos' : rd.dex === 'bearish' ? 'neg' : ''}>
          {r.totals.dexRatio >= 0 ? '+' : ''}{r.totals.dexRatio.toFixed(3)} <span className="sub">(ngưỡng ±{DEX_LEAN})</span>
        </span>
        <span>IV30 CBOE</span>
        <span>
          {chain.iv30 != null ? `${chain.iv30.toFixed(2)}%` : '—'}
          {chain.iv30Change != null ? ` (${chain.iv30Change >= 0 ? '+' : ''}${chain.iv30Change.toFixed(2)})` : ''}
          {rd.iv ? ` · ${IV_TREND_VI[rd.iv]}` : ''}
        </span>
        <span>Term structure</span>
        <span>{term === 'front-rich' ? 'Front-end đắt' : term === 'normal' ? 'Bình thường' : '—'}</span>
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
  const vannaFlow = -r.totals.vanna;
  const charmFlow = -r.totals.charm;
  const act = (x: number) => (x >= 0 ? 'mua' : 'bán');
  return (
    <div className="kpis">
      <section className="card kpi">
        <div className="k"><span>GEX</span><span className={`pill ${r.regime}`}>{r.regime === 'positive' ? '+γ' : '−γ'}</span></div>
        <div className={`v ${r.totals.gex >= 0 ? 'pos' : 'neg'}`}>{money(r.totals.gex)}</div>
        <div className="d">$ delta dealer đổi mỗi 1% giá. Dương = dealer hedge ngược chiều (giảm chấn).</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>DEX</span><span className={`pill ${rd.dex === 'bullish' ? 'positive' : rd.dex === 'bearish' ? 'negative' : 'neutral'}`}>{DEX_VI[rd.dex].replace('DEX ', '')}</span></div>
        <div className={`v ${r.totals.dex >= 0 ? 'pos' : 'neg'}`}>{money(r.totals.dex)}</div>
        <div className="d">Tỷ lệ {r.totals.dexRatio.toFixed(3)} trên tổng |DEX| {money(r.totals.dexGross, false)}. Đọc DEX sau GEX, không thay GEX.</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>Vanna</span><span className="sub">/ 1 vol</span></div>
        <div className={`v ${vannaFlow >= 0 ? 'pos' : 'neg'}`}>{money(vannaFlow)}</div>
        <div className="d">IV +1 điểm → dealer {act(vannaFlow)} ~{money(Math.abs(vannaFlow), false)}; IV −1 điểm → {act(-vannaFlow)}.</div>
      </section>
      <section className="card kpi">
        <div className="k"><span>Charm</span><span className="sub">/ ngày</span></div>
        <div className={`v ${charmFlow >= 0 ? 'pos' : 'warn'}`}>{money(charmFlow)}</div>
        <div className="d">
          Thời gian trôi → dealer {act(charmFlow)} thụ động ~{money(Math.abs(charmFlow / 24), false)}/giờ.
          {!rd.charmActive && ' Chỉ đáng dùng sau 11:30 ET.'}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function KeyLevels({ chain, r, mapper }: { chain: Chain; r: ExposureResult; mapper: Mapper }) {
  const em = r.expectedMove;
  const rows: [string, number | null | undefined, string, string][] = [
    ['Biên trên EM', em?.hi, COLORS.em, 'Spot + Spot × IV × √(1/252)'],
    ['Call wall', r.callWall, COLORS.call, 'Strike trên spot có |call GEX| lớn nhất'],
    ['HVL', r.hvl, COLORS.accent, 'Strike có tổng |GEX| lớn nhất trong khoảng — thường là pivot / nam châm'],
    ['Spot', chain.spot, COLORS.spot, 'Giá underlying CBOE (trễ ~15 phút)'],
    ['Zero gamma', r.zeroGamma, COLORS.flip, 'Giá mà tổng GEX đổi dấu, tính lại gamma Black-Scholes trên lưới giá'],
    ['Cumulative flip', r.cumFlip, COLORS.flip, 'Strike mà tổng cộng dồn net GEX (thấp → cao) đổi dấu. Định nghĩa thay thế'],
    ['Put wall', r.putWall, COLORS.put, 'Strike dưới spot có |put GEX| lớn nhất'],
    ['Biên dưới EM', em?.lo, COLORS.em, 'Spot − Spot × IV × √(1/252)'],
  ];
  return (
    <Card title="Level chính">
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
      <p className="sub">Không có node ≥ {int(nodeMin)}.</p>
    );
  };
  return (
    <Card title="Node theo strike (net contracts)">
      <h3 style={{ marginTop: 0 }}>Node dương — nam châm / điểm cân bằng</h3>
      {list(r.nodes.pos, 'pos')}
      <h3>Node âm — biên range / mức test</h3>
      {list(r.nodes.neg, 'neg')}
      <p className="note">
        Profile: <b className={r.profile.quality === 'clean' ? 'pos' : 'warn'}>{r.profile.quality === 'clean' ? 'rõ' : r.profile.quality === 'messy' ? 'lộn xộn' : 'mỏng'}</b> — {r.profile.reason}.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function ExpectedMoveCard({ r }: { r: ExposureResult }) {
  const em = r.expectedMove;
  return (
    <Card title="Expected move">
      {em ? (
        <div className="em-grid">
          <span>1 ngày = Spot × IV × √(1/252)</span><span>±{px(em.em1d)}</span>
          <span>IV dùng ({em.source === 'IV30' ? 'IV30 CBOE' : 'ATM ≥1 ngày'})</span><span>{pct(em.iv1d)}</span>
          <span>Biên</span><span>{lvl(em.lo)} – {lvl(em.hi)}</span>
          <span>Front expiry</span><span>{em.exp}</span>
          <span>ATM straddle ({strikeFmt(em.atmK)})</span><span>{em.straddle != null ? `±${px(em.straddle)}` : '—'}</span>
          <span>IV × √T × S (IV {pct(em.iv)})</span><span>{em.ivMove != null ? `±${px(em.ivMove)}` : '—'}</span>
        </div>
      ) : (
        <p className="sub">Không đủ dữ liệu.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function ExportCard({ pine, apiHref }: { pine: string; apiHref: string }) {
  const [copied, setCopied] = useState('Copy');
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
              setCopied('Copied ✓');
            } catch {
              setCopied('Chọn tay');
            }
            setTimeout(() => setCopied('Copy'), 1200);
          }}
        >
          {copied}
        </button>
      </div>
      <a className="api" href={apiHref} target="_blank" rel="noopener">Mở levels JSON cho ATAS ↗</a>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function LevelMapTable({ map, spot, mapper }: { map: LevelMap; spot: number; mapper: Mapper }) {
  const row = (z: Zone) => {
    const s = z.score;
    const breakdown = `Gần spot ${s.proximity}/3 · Exposure ${s.exposure}/3 · Hoạt động ${s.activity}/2 · OI ${s.oi}/2 · Hợp lưu ${s.confluence}/3 · Phản ứng —/2 (bạn tự chấm)`;
    const range = z.hi - z.lo > 1e-9 ? `${lvl(z.lo)}–${lvl(z.hi)}` : lvl(z.price);
    return (
      <tr key={z.label}>
        <td className={z.label?.startsWith('S') ? 'lbl-s' : 'lbl-r'}>{z.label}</td>
        <td>{range}</td>
        <td className={mapper ? '' : 'sub'}>{mapper ? (z.hi - z.lo > 1e-9 ? `${lvl(mapper.map(z.lo))}–${lvl(mapper.map(z.hi))}` : lvl(mapper.map(z.price))) : '—'}</td>
        <td className="txt">{z.role}</td>
        <td className="txt">{z.sources.map((x) => SOURCE_LABEL[x]).join(' · ')}</td>
        <td title={breakdown}>
          <span className="score">
            <span className="bar-t"><i className="acc" style={{ width: `${(s.total / 13) * 100}%` }} /></span>
            {s.total}/13
          </span>
        </td>
        <td><span className={`grade ${z.grade}`}>{GRADE_VI[z.grade]}</span></td>
      </tr>
    );
  };
  return (
    <Card title="Bản đồ level — S1…S5 / R1…R5">
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th><th>Vùng</th><th>Futures</th><th>Vai trò</th><th>Nguồn</th><th>Điểm</th><th>Hạng</th>
            </tr>
          </thead>
          <tbody>
            {[...map.resistances].reverse().map(row)}
            <tr className="spotrow">
              <td>Spot</td><td>{lvl(spot)}</td><td className={mapper ? '' : 'sub'}>{mapper ? lvl(mapper.map(spot)) : '—'}</td>
              <td className="txt" colSpan={4}>EM 1 ngày ±{px(map.em)}</td>
            </tr>
            {map.supports.map(row)}
          </tbody>
        </table>
      </div>
      <p className="note">
        Chấm theo thang 15 của Module 6. Dữ liệu chỉ chấm được 13 điểm; 2 điểm “phản ứng đã quan sát” bạn tự cộng khi thấy rejection / acceptance / absorption.
        Hạng: 12–15 chính · 9–11 phụ · 6–8 dự phòng · &lt;6 bỏ (trừ gamma flip). Rê chuột vào điểm để xem chi tiết.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
export function TermTable({ ts }: { ts: TermPoint[] }) {
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr><th>Expiry</th><th>Ngày</th><th>ATM IV</th><th>25Δ put</th><th>25Δ call</th><th>RR 25Δ</th></tr>
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
