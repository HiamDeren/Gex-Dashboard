'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterContracts, listExpiries, makeMapper, type Chain, type Weight } from '@/lib/core';
import { compute } from '@/lib/exposure';
import { buildHeatmap } from '@/lib/heatmap';
import { buildLevelMap } from '@/lib/levels';
import { read } from '@/lib/bias';
import { ivTrend, smile, termShape, termStructure } from '@/lib/vol';
import { lvl, px, secondsSince } from '@/lib/format';
import { DICT, LOCALE, PRESET_SYMBOLS, SYMBOL_GROUPS, isLang, type Lang } from '@/lib/i18n';
import { COLORS, Card, LangProvider, LangSwitch, Seg, useLang } from './ui';
import { GexCurve, Heatmap, METRIC_LABEL, SmileChart, StrikeProfile, TermChart, type Metric } from './charts';
import { BiasCard, ExpectedMoveCard, ExportCard, KeyLevels, KpiTiles, LevelMapTable, Nodes, RegimeCard, TermTable } from './panels';
import { PlanTab } from './plan';

type ChainPayload = Chain & { fetchedAt: number; mock: boolean };
type Tab = 'overview' | 'exposure' | 'heatmap' | 'vol' | 'levels' | 'plan';
const TABS: Tab[] = ['overview', 'exposure', 'heatmap', 'vol', 'levels', 'plan'];
const OTHER = '__other'; // symbol dropdown entry that reveals a free-text ticker input

interface Settings {
  symbol: string;
  expiry: string;
  weight: Weight;
  sign: 1 | -1;
  range: number;
  bucket: number;
  view: 'split' | 'net';
  fut: string;
  nodeMin: number;
  auto: boolean;
  metric: Metric;
  tab: Tab;
  lang: Lang;
}
const DEFAULTS: Settings = { symbol: 'NDX', expiry: 'all', weight: 'oi', sign: 1, range: 5, bucket: 0, view: 'split', fut: '', nodeMin: 1000, auto: true, metric: 'gex', tab: 'overview', lang: 'vi' };
const LS_KEY = 'gex-local-settings-v2';
const REFRESH_MS = 60_000;

export default function Dashboard() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [symDraft, setSymDraft] = useState(DEFAULTS.symbol);
  const [customSym, setCustomSym] = useState(false); // "Other…" picked, free-text input shown
  const [chain, setChain] = useState<ChainPayload | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'live' | 'err'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [smileExp, setSmileExp] = useState<string>('');
  const [ready, setReady] = useState(false); // settings restored from localStorage
  const lastFetch = useRef(0);
  const busy = useRef(false);

  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v })), []);
  const t = DICT[s.lang];
  const langRef = useRef(s.lang);
  langRef.current = s.lang;

  // ---------- settings persistence ----------
  useEffect(() => {
    try {
      const next: Settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') };
      if (!isLang(next.lang)) next.lang = DEFAULTS.lang;
      setS(next);
      setSymDraft(next.symbol);
    } catch {
      /* corrupt or unavailable storage: keep defaults */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, [s, ready]);
  useEffect(() => {
    document.documentElement.lang = s.lang;
  }, [s.lang]);

  // ---------- data ----------
  const fetchChain = useCallback(async (sym: string, force = false) => {
    if (!/^[A-Z]{1,6}$/.test(sym)) {
      setError(DICT[langRef.current].symbolInvalid);
      return;
    }
    busy.current = true;
    setStatus('busy');
    try {
      const res = await fetch(`/api/chain?symbol=${sym}${force ? '&force=1' : ''}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      lastFetch.current = Date.now();
      setChain(body);
      setError(null);
      setStatus('live');
    } catch (err) {
      setStatus('err');
      setError(DICT[langRef.current].loadFailed(sym, err instanceof Error ? err.message : String(err)));
    } finally {
      busy.current = false;
    }
  }, []);

  // initial load and symbol changes, once settings are restored
  const symbolRef = useRef(s.symbol);
  symbolRef.current = s.symbol;
  useEffect(() => {
    if (ready) fetchChain(s.symbol);
  }, [ready, s.symbol, fetchChain]);

  // auto refresh
  useEffect(() => {
    const id = setInterval(() => {
      if (s.auto && !busy.current && lastFetch.current && Date.now() - lastFetch.current >= REFRESH_MS) fetchChain(symbolRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [s.auto, fetchChain]);

  /** Apply the typed ticker; an empty box falls back to the current symbol. Returns the symbol in effect. */
  const commitSymbol = () => {
    const sym = symDraft.trim().toUpperCase() || s.symbol;
    setSymDraft(sym);
    if (PRESET_SYMBOLS.has(sym)) setCustomSym(false);
    if (sym !== s.symbol) setS((p) => ({ ...p, symbol: sym, expiry: 'all' }));
    return sym;
  };
  const pickSymbol = (v: string) => {
    if (v === OTHER) {
      setCustomSym(true);
      setSymDraft('');
      return;
    }
    setCustomSym(false);
    setSymDraft(v);
    if (v !== s.symbol) setS((p) => ({ ...p, symbol: v, expiry: 'all' }));
  };
  const showCustom = customSym || !PRESET_SYMBOLS.has(s.symbol);

  // ---------- derived ----------
  const expiries = useMemo(() => (chain ? listExpiries(chain.contracts) : []), [chain]);
  const expiry = s.expiry === 'all' || ['front', 'd7', 'd30'].includes(s.expiry) || expiries.some((e) => e.exp === s.expiry) ? s.expiry : 'all';
  const contracts = useMemo(() => (chain ? filterContracts(chain.contracts, expiry) : []), [chain, expiry]);
  const opts = useMemo(
    () => ({ weight: s.weight, sign: s.sign, rangePct: Math.min(Math.max(s.range || 5, 1), 20), bucket: Math.max(s.bucket || 0, 0), gridPoints: 161, nodeMin: Math.max(s.nodeMin || 0, 0) }),
    [s.weight, s.sign, s.range, s.bucket, s.nodeMin],
  );
  const r = useMemo(() => (chain && contracts.length ? compute(chain, contracts, opts) : null), [chain, contracts, opts]);
  const map = useMemo(() => (r ? buildLevelMap(r) : null), [r]);
  const ts = useMemo(() => (chain ? termStructure(chain.contracts, chain.spot) : []), [chain]);
  const term = useMemo(() => termShape(ts), [ts]);
  const rd = useMemo(() => (chain && r && map ? read(chain, r, map, ivTrend(chain), term?.shape ?? null, Date.now(), s.lang) : null), [chain, r, map, term, s.lang]);
  const hm = useMemo(
    () => (s.tab === 'heatmap' && chain && contracts.length ? buildHeatmap(chain.spot, contracts, { weight: s.weight, sign: s.sign, rangePct: opts.rangePct }) : null),
    [s.tab, chain, contracts, s.weight, s.sign, opts.rangePct],
  );
  const smileExpiry = smileExp && ts.some((p) => p.exp === smileExp) ? smileExp : (ts.find((p) => p.days >= 0.75) ?? ts[0])?.exp;
  const smilePts = useMemo(() => (chain && smileExpiry ? smile(chain.contracts, smileExpiry, chain.spot, opts.rangePct * 2) : []), [chain, smileExpiry, opts.rangePct]);
  const mapper = chain ? makeMapper(chain.symbol, chain.spot, Number(s.fut)) : null;
  const futCode = r?.totals.futCode ?? (chain?.symbol === 'QQQ' ? 'NQ' : chain?.symbol === 'SPY' ? 'ES' : chain?.symbol ?? '');

  const lines = r
    ? [
        { v: r.callWall, color: COLORS.call, name: 'Call wall', dash: '6 4' },
        { v: r.putWall, color: COLORS.put, name: 'Put wall', dash: '6 4' },
        { v: r.zeroGamma, color: COLORS.flip, name: 'Zero γ' },
        { v: r.spot, color: COLORS.spot, name: 'Spot', dash: '2 3' },
        ...(r.expectedMove
          ? [
              { v: r.expectedMove.hi, color: COLORS.em, name: 'EM+', dash: '1 4' },
              { v: r.expectedMove.lo, color: COLORS.em, name: 'EM−', dash: '1 4' },
            ]
          : []),
      ]
    : [];

  const pine = useMemo(() => {
    if (!r) return '';
    const lv = (x: number | null) => (x == null ? null : +(mapper ? mapper.map(x) : x).toFixed(2));
    return [[lv(r.callWall), 'CW'], [lv(r.zeroGamma), 'ZG'], [lv(r.putWall), 'PW'], ...r.topStrikes.slice(0, 3).map((x) => [lv(x.K), 'HG'])]
      .filter(([v]) => v != null)
      .map(([v, t]) => `${v}:${t}`)
      .join(',');
  }, [r, mapper]);
  const apiHref = useMemo(() => {
    const q = new URLSearchParams({ symbol: chain?.symbol ?? s.symbol, expiry, weight: s.weight, sign: String(s.sign), range: String(s.range), nodeMin: String(s.nodeMin), lang: s.lang });
    if (Number(s.fut) > 0) q.set('fut', s.fut);
    return `/api/levels?${q}`;
  }, [chain, s, expiry]);

  const profileHeight = 560;

  // ---------- render ----------
  const chg = chain?.prevClose ? chain.spot - chain.prevClose : null;
  const dte = (ms: number) => Math.max(0, Math.floor((ms - Date.now()) / 864e5));

  return (
    <LangProvider value={s.lang}>
      <header className="bar">
        <div className="brand">
          <span className="logo" aria-hidden="true">γ</span>
          <div className="brand-text">
            <div className="brand-row">
              <span className="sym">{chain?.symbol ?? s.symbol}</span>
              {r && <span className={`pill ${r.nearFlip ? 'neutral' : r.regime}`}>{r.nearFlip ? t.nearFlip : r.regime === 'positive' ? '+γ regime' : '−γ regime'}</span>}
            </div>
            <span className="brand-sub">GEX · DEX · Vanna · Charm · IV — CBOE delayed</span>
          </div>
        </div>
        <div className="quote">
          <span className="spot">{chain ? px(chain.spot) : '—'}</span>
          {chg != null && chain?.prevClose && (
            <span className={`chg ${chg >= 0 ? 'up' : 'down'}`}>
              {chg >= 0 ? '+' : '−'}{px(Math.abs(chg))} ({((chg / chain.prevClose) * 100).toFixed(2)}%)
            </span>
          )}
        </div>
        <StatusClock status={status} fetchedAt={chain?.fetchedAt ?? null} auto={s.auto} mock={!!chain?.mock} lastFetch={lastFetch} />
        <LangSwitch value={s.lang} onChange={(l) => set('lang', l)} />
      </header>

      <form
        className="controls"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          fetchChain(commitSymbol(), true);
        }}
      >
        <label>
          Symbol
          <span className="sym-pick">
            <select className="w-symsel" value={showCustom ? OTHER : s.symbol} onChange={(e) => pickSymbol(e.target.value)}>
              {SYMBOL_GROUPS.map((g) => (
                <optgroup key={g.group} label={t.symbolGroups[g.group]}>
                  {g.items.map(([sym, name]) => <option key={sym} value={sym}>{sym} · {name}</option>)}
                </optgroup>
              ))}
              <option value={OTHER}>{t.symbolOther}</option>
            </select>
            {showCustom && (
              <input
                className="w-sym"
                aria-label={t.symbolPlaceholder}
                placeholder={t.symbolPlaceholder}
                value={symDraft}
                maxLength={6}
                spellCheck={false}
                autoFocus={customSym}
                onChange={(e) => setSymDraft(e.target.value.toUpperCase())}
                onBlur={commitSymbol}
              />
            )}
          </span>
        </label>
        <label>
          Expiry
          <select value={expiry} onChange={(e) => set('expiry', e.target.value)}>
            <option value="all">{t.expiryAll}</option>
            <option value="front">{t.expiryFront}</option>
            <option value="d7">{t.expiryD7}</option>
            <option value="d30">{t.expiryD30}</option>
            {expiries.map((e) => <option key={e.exp} value={e.exp}>{e.exp} ({dte(e.expMs)}d)</option>)}
          </select>
        </label>
        <label>
          Weight
          <select value={s.weight} onChange={(e) => set('weight', e.target.value as Weight)}>
            <option value="oi">Open interest</option>
            <option value="vol">{t.weightVol}</option>
            <option value="oivol">OI + volume</option>
          </select>
        </label>
        <label title={t.dealerTitle}>
          Dealer model
          <select value={s.sign} onChange={(e) => set('sign', Number(e.target.value) === -1 ? -1 : 1)}>
            <option value={1}>Long call, short put (naive)</option>
            <option value={-1}>Short call, long put</option>
          </select>
        </label>
        <label>
          Range ±%
          <input className="w-num" type="number" min={1} max={20} step={0.5} value={s.range} onChange={(e) => set('range', Number(e.target.value))} />
        </label>
        <label title={t.bucketTitle}>
          Bucket
          <input className="w-num" type="number" min={0} step={1} value={s.bucket} onChange={(e) => set('bucket', Number(e.target.value))} />
        </label>
        <label title={t.nodeTitle}>
          Node ≥
          <input className="w-num" type="number" min={0} step={100} value={s.nodeMin} onChange={(e) => set('nodeMin', Number(e.target.value))} />
        </label>
        <label title={t.futTitle}>
          Futures
          <input className="w-fut" type="number" step={0.25} placeholder={futCode || 'NQ'} value={s.fut} onChange={(e) => set('fut', e.target.value)} />
        </label>
        <div className="actions">
          <label className="switch">
            <input type="checkbox" checked={s.auto} onChange={(e) => set('auto', e.target.checked)} />
            <span className="track" />
            Auto 60s
          </label>
          <button type="submit" className="btn primary" disabled={status === 'busy'}>
            {status === 'busy' ? t.loading : 'Refresh'}
          </button>
        </div>
      </form>

      <nav className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button key={tab} type="button" role="tab" className="tab" aria-selected={s.tab === tab} onClick={() => set('tab', tab)}>
            {t.tabs[tab]}
          </button>
        ))}
      </nav>

      {error && <div className="layout single"><div className="error">{error}</div></div>}
      {!chain || !r || !map || !rd ? (
        <div className="layout single">
          <div className="card empty">{status === 'err' ? t.noData : t.loadingChain}</div>
        </div>
      ) : (
        <>
          {s.tab === 'overview' && (
            <main className="layout">
              <aside className="side">
                <RegimeCard chain={chain} r={r} mapper={mapper} />
                <BiasCard rd={rd} r={r} chain={chain} term={term?.shape ?? null} />
                <KeyLevels chain={chain} r={r} mapper={mapper} />
                <ExportCard pine={pine} apiHref={apiHref} />
                <Meta chain={chain} used={r.contractsUsed} />
              </aside>
              <section className="main">
                <KpiTiles r={r} rd={rd} />
                <ProfileCard
                  r={r} metric={s.metric} setMetric={(m) => set('metric', m)} view={s.view} setView={(v) => set('view', v)}
                  lines={lines} mapper={mapper} nodeMin={opts.nodeMin} rangePct={opts.rangePct} height={profileHeight}
                />
                <Card title={t.gexCurveTitle} right={<span className="legend">{t.gexCurveLegend}</span>}>
                  <GexCurve curve={r.curve} spot={r.spot} zeroGamma={r.zeroGamma} em={r.expectedMove} />
                </Card>
              </section>
            </main>
          )}

          {s.tab === 'exposure' && (
            <main className="layout">
              <aside className="side">
                <Nodes r={r} nodeMin={opts.nodeMin} mapper={mapper} />
                <ExpectedMoveCard r={r} />
                <div className="banner">
                  {t.naiveBanner[0]}<b>{t.naiveBanner[1]}</b>{t.naiveBanner[2]}
                </div>
              </aside>
              <section className="main">
                <KpiTiles r={r} rd={rd} />
                <ProfileCard
                  r={r} metric={s.metric} setMetric={(m) => set('metric', m)} view={s.view} setView={(v) => set('view', v)}
                  lines={lines} mapper={mapper} nodeMin={opts.nodeMin} rangePct={opts.rangePct} height={profileHeight + 120}
                />
              </section>
            </main>
          )}

          {s.tab === 'heatmap' && (
            <main className="layout single">
              {hm && (
                <div className="grid2">
                  <Card
                    title="Gamma heat map"
                    right={<span className="scale">−<i style={{ background: `linear-gradient(90deg, ${COLORS.put}, transparent, ${COLORS.call})` }} />+{t.hmFlipScale}</span>}
                  >
                    <Heatmap hm={hm} spot={chain.spot} kind="gamma" mapper={mapper} />
                    <p className="note">{t.hmGammaNote}</p>
                  </Card>
                  <Card
                    title="Charm heat map"
                    right={<span className="scale">{t.hmSell}<i style={{ background: `linear-gradient(90deg, ${COLORS.flip}, transparent, ${COLORS.call})` }} />{t.hmBuy}</span>}
                  >
                    <Heatmap hm={hm} spot={chain.spot} kind="charm" mapper={mapper} />
                    <p className="note">
                      {t.hmCharmNote}{rd.charmActive ? t.hmCharmActive : t.hmCharmEarly}
                    </p>
                  </Card>
                </div>
              )}
              <p className="note">
                {t.hmSession(hm ? `${new Date(hm.session.open).toLocaleString(LOCALE[s.lang])} → ${new Date(hm.session.close).toLocaleTimeString(LOCALE[s.lang])}` : '')}
              </p>
            </main>
          )}

          {s.tab === 'vol' && (
            <main className="layout">
              <aside className="side">
                <ExpectedMoveCard r={r} />
                <Card title={t.fourQ}>
                  <div className="em-grid">
                    <span>{t.qInEm}</span>
                    <span>{r.expectedMove && chain.prevClose ? (Math.abs(chain.spot - chain.prevClose) <= r.expectedMove.em1d ? t.inEmYes : t.inEmNo) : '—'}</span>
                    <span>{t.qIv}</span>
                    <span>{rd.iv === 'expanding' ? t.ivUp : rd.iv === 'compressing' ? t.ivDown : rd.iv === 'flat' ? t.ivFlat : '—'}</span>
                    <span>{t.qSkew}</span>
                    <span>{term?.front.rr25 != null ? `RR 25Δ ${(term.front.rr25 * 100).toFixed(1)} vol` : '—'}</span>
                    <span>{t.qTerm}</span>
                    <span>{term ? (term.shape === 'front-rich' ? t.termStressed : t.normal) : '—'}</span>
                  </div>
                  <p className="note">{t.rrNote}</p>
                </Card>
              </aside>
              <section className="main">
                <Card
                  title="IV smile"
                  right={
                    <select className="btn sm" value={smileExpiry ?? ''} onChange={(e) => setSmileExp(e.target.value)} aria-label={t.chooseExpiry}>
                      {ts.map((p) => <option key={p.exp} value={p.exp}>{p.exp} ({p.days < 1 ? '0d' : `${Math.round(p.days)}d`})</option>)}
                    </select>
                  }
                >
                  <SmileChart points={smilePts} spot={chain.spot} />
                  <p className="legend"><i style={{ background: COLORS.accent }} />{t.smileOtm}<i style={{ background: COLORS.call }} />Call IV<i style={{ background: COLORS.put }} />Put IV</p>
                </Card>
                <Card title={t.termTitle}>
                  <TermChart ts={ts} />
                  <TermTable ts={ts} />
                </Card>
              </section>
            </main>
          )}

          {s.tab === 'levels' && (
            <main className="layout">
              <aside className="side">
                <KeyLevels chain={chain} r={r} mapper={mapper} />
                <Card title={t.mapRulesTitle}>
                  <ul className="warnings" style={{ marginTop: 0 }}>
                    {t.mapRules.map((rule) => (
                      <li key={rule} style={{ color: 'var(--muted)', background: 'transparent', borderColor: 'var(--line)' }}>{rule}</li>
                    ))}
                  </ul>
                </Card>
              </aside>
              <section className="main">
                <LevelMapTable map={map} spot={chain.spot} mapper={mapper} />
                <ProfileCard
                  r={r} metric={s.metric} setMetric={(m) => set('metric', m)} view={s.view} setView={(v) => set('view', v)}
                  lines={[
                    ...map.resistances.map((z) => ({ v: z.price, color: COLORS.put, name: z.label!, dash: '4 3' })),
                    { v: r.spot, color: COLORS.spot, name: 'Spot', dash: '2 3' },
                    ...map.supports.map((z) => ({ v: z.price, color: COLORS.call, name: z.label!, dash: '4 3' })),
                  ]}
                  mapper={mapper} nodeMin={opts.nodeMin} rangePct={opts.rangePct} height={profileHeight}
                />
              </section>
            </main>
          )}

          {s.tab === 'plan' && (
            <main className="layout single">
              <PlanTab chain={chain} r={r} map={map} rd={rd} term={term?.shape ?? null} futCode={futCode} />
            </main>
          )}
        </>
      )}
    </LangProvider>
  );
}

function ProfileCard({
  r, metric, setMetric, view, setView, lines, mapper, nodeMin, rangePct, height,
}: {
  r: NonNullable<ReturnType<typeof compute>>;
  metric: Metric;
  setMetric: (m: Metric) => void;
  view: 'split' | 'net';
  setView: (v: 'split' | 'net') => void;
  lines: { v: number | null | undefined; color: string; name: string; dash?: string }[];
  mapper: { map: (x: number) => number } | null;
  nodeMin: number;
  rangePct: number;
  height: number;
}) {
  const { t } = useLang();
  const canSplit = metric === 'gex' || metric === 'dex';
  return (
    <Card
      title={t.byStrike(METRIC_LABEL[metric])}
      right={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Seg value={metric} onChange={setMetric} options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => [m, METRIC_LABEL[m]])} />
          {canSplit && <Seg value={view} onChange={setView} options={[['split', 'Call / Put'], ['net', 'Net']]} />}
        </div>
      }
    >
      <p className="legend" style={{ margin: '0 0 6px' }}>{t.metricNote[metric]}{metric === 'contracts' ? t.dashed(nodeMin.toLocaleString('en-US')) : ''}</p>
      <StrikeProfile rows={r.strikes} spot={r.spot} rangePct={rangePct} metric={metric} split={view === 'split'} lines={lines} mapper={mapper} nodeMin={nodeMin} height={height} />
    </Card>
  );
}

/** Re-renders every second on its own so the heavy charts do not. */
function StatusClock({ status, fetchedAt, auto, mock, lastFetch }: { status: string; fetchedAt: number | null; auto: boolean; mock: boolean; lastFetch: React.RefObject<number> }) {
  const { t } = useLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const next = auto && lastFetch.current ? Math.max(0, Math.ceil((lastFetch.current + REFRESH_MS - now) / 1000)) : null;
  return (
    <div className="status" title={t.statusTitle}>
      <span className={`dot ${status}`} />
      <span>
        {status === 'err'
          ? t.statusErr
          : !fetchedAt
            ? t.statusConnecting
            : `${mock ? 'Mock' : 'Delayed'} · ${t.statusUpdated(t.ago(secondsSince(fetchedAt, now)))}${next != null ? ` · ${t.statusNext(next)}` : ''}`}
      </span>
    </div>
  );
}

function Meta({ chain, used }: { chain: ChainPayload; used: number }) {
  const { t } = useLang();
  return (
    <footer className="meta">
      {chain.mock && <div className="mock">{t.mockData}</div>}
      <div>CBOE timestamp: {chain.cboeTimestamp || '—'}</div>
      <div>{used.toLocaleString('en-US')} contracts · spot {lvl(chain.spot)} · IV30 {chain.iv30 != null ? `${chain.iv30.toFixed(2)}%` : '—'}</div>
      <div>{t.disclaimer}</div>
    </footer>
  );
}
