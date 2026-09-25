'use client';
import { useState } from 'react';
import type { Chain } from '@/lib/core';
import type { ExposureResult } from '@/lib/exposure';
import { ROLE_LABEL, type LevelMap, type Zone } from '@/lib/levels';
import { DEX_LABEL, GEX_LABEL, fmtLevel, premarketText, scenarios, type Reading } from '@/lib/bias';
import { IV_TREND_LABEL, type TermShape } from '@/lib/vol';
import { Card, useLang } from './ui';

/** Curriculum Module 8 quick table. `fits` is a rough regime filter, not a trade signal. Use / avoid text is in the dictionary. */
const PLAYBOOKS: { n: number; name: string; fits: (rd: Reading, r: ExposureResult) => boolean }[] = [
  { n: 1, name: 'Positive GEX mean reversion', fits: (rd) => rd.gex === 'positive' && rd.iv !== 'expanding' },
  { n: 2, name: 'Negative GEX breakout', fits: (rd) => rd.gex === 'negative' },
  { n: 3, name: 'IV wall rejection', fits: (rd) => rd.iv !== 'expanding' },
  { n: 4, name: 'DEX trend day', fits: (rd) => rd.dex !== 'neutral' && rd.gex !== 'positive' },
  { n: 5, name: 'Options profile stall', fits: (_, r) => r.nodes.pos.length > 0 },
  { n: 6, name: 'Short-options continuation', fits: (_, r) => r.nodes.neg.length > 0 },
  { n: 7, name: 'Expected move fade', fits: (rd) => rd.gex === 'positive' && rd.iv !== 'expanding' },
  { n: 8, name: 'Gamma flip acceleration', fits: (rd, r) => r.zeroGamma != null && (rd.gex !== 'positive' || r.nearFlip) },
];

export function PlanTab({ chain, r, map, rd, term, futCode }: { chain: Chain; r: ExposureResult; map: LevelMap; rd: Reading; term: TermShape | null; futCode: string }) {
  const { lang, t } = useLang();
  const text = premarketText(chain, r, map, rd, futCode, lang);
  const [copied, setCopied] = useState<string | null>(null);
  const topOi = [...r.strikes].sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi))[0];
  const topShort = [...r.strikes].sort((a, b) => b.shortVol - a.shortVol)[0];
  const sc = scenarios(r, map, rd.gex, lang);
  const role = (z: Zone | undefined) => (z ? ROLE_LABEL[lang][z.role] : '—');
  const [r1, s1] = [map.resistances[0], map.supports[0]];

  const answers = [
    t.step1(fmtLevel(chain.spot), fmtLevel(r.callWall), fmtLevel(r.putWall), fmtLevel(topShort?.K)),
    `${GEX_LABEL[lang][rd.gex]} (flip ${fmtLevel(r.zeroGamma)}) → ${t.step2Mode[rd.gex]}`,
    `${DEX_LABEL[lang][rd.dex]} (${t.ratio(r.totals.dexRatio.toFixed(3))})`,
    t.step4(rd.iv ? IV_TREND_LABEL[lang][rd.iv] : t.unclear, term === 'front-rich'),
    t.step5(fmtLevel(topOi?.K), fmtLevel(topShort?.K)),
    `R1 ${fmtLevel(r1?.price)} (${role(r1)}) · S1 ${fmtLevel(s1?.price)} (${role(s1)})`,
    t.step7,
  ];

  return (
    <div className="grid2">
      <div className="main">
        <Card title={t.stepsTitle}>
          <ol className="checklist">
            {t.stepQ.map((q, i) => (
              <li key={i}><div><b>{q}</b><br /><span>{answers[i]}</span></div></li>
            ))}
          </ol>
        </Card>
        <Card title={t.scenariosTitle}>
          {sc.length ? (
            <ol className="checklist">{sc.map((s) => <li key={s}><div><span>{s}</span></div></li>)}</ol>
          ) : (
            <p className="sub">{t.noScenarios}</p>
          )}
          <p className="note">{t.scenariosNote}</p>
        </Card>
        <Card title={t.playbooksTitle}>
          <div className="scroll-x">
            <table className="tbl playbooks">
              <thead><tr><th>#</th><th>Playbook</th><th>{t.pbCols.use}</th><th>{t.pbCols.avoid}</th><th>{t.pbCols.today}</th></tr></thead>
              <tbody>
                {PLAYBOOKS.map((p, i) => {
                  const ok = p.fits(rd, r);
                  const [use, avoid] = t.playbooks[i];
                  return (
                    <tr key={p.n}>
                      <td>{p.n}</td>
                      <td className="txt" style={{ color: 'var(--text)' }}>{p.name}</td>
                      <td className="txt">{use}</td>
                      <td className="txt">{avoid}</td>
                      <td className={ok ? 'on' : 'sub'}>{ok ? t.possible : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">{t.noTradeNote}</p>
        </Card>
      </div>
      <div className="main">
        <Card
          title="Premarket → journal"
          right={
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(t.copiedJournal);
                } catch {
                  setCopied(t.selectManually);
                }
                setTimeout(() => setCopied(null), 1400);
              }}
            >
              {copied ?? t.copyJournal}
            </button>
          }
        >
          <pre className="plan-pre">{text}</pre>
          <p className="note">{t.journalNote}</p>
        </Card>
        <Card title={t.threeQTitle}>
          <ol className="checklist">
            {t.threeQ.map((q) => <li key={q}><div><span>{q}</span></div></li>)}
          </ol>
          <p className="note">{t.threeQNote}</p>
        </Card>
      </div>
    </div>
  );
}
