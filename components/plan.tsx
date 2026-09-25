'use client';
import { useState } from 'react';
import type { Chain } from '@/lib/core';
import type { ExposureResult } from '@/lib/exposure';
import type { LevelMap } from '@/lib/levels';
import { DEX_VI, GEX_VI, fmtLevel, premarketText, scenarios, type Reading } from '@/lib/bias';
import { IV_TREND_VI, type TermShape } from '@/lib/vol';
import { Card } from './ui';

/** Curriculum Module 8 quick table. `fits` is a rough regime filter, not a trade signal. */
const PLAYBOOKS: { n: number; name: string; use: string; avoid: string; fits: (rd: Reading, r: ExposureResult) => boolean }[] = [
  { n: 1, name: 'Positive GEX mean reversion', use: 'GEX giảm chấn và biên bị từ chối', avoid: 'Giá chấp nhận ngoài level', fits: (rd) => rd.gex === 'positive' && rd.iv !== 'expanding' },
  { n: 2, name: 'Negative GEX breakout', use: 'Cú phá được chấp nhận, IV/DEX ủng hộ', avoid: 'Cú phá chỉ là râu nến', fits: (rd) => rd.gex === 'negative' },
  { n: 3, name: 'IV wall rejection', use: 'IV wall chồng với một thất bại thực tế', avoid: 'IV bụng xuyên qua wall', fits: (rd) => rd.iv !== 'expanding' },
  { n: 4, name: 'DEX trend day', use: 'Hướng, giá và flow đồng thuận', avoid: 'GEX giảm chấn mạnh và giá chop', fits: (rd) => rd.dex !== 'neutral' && rd.gex !== 'positive' },
  { n: 5, name: 'Options profile stall', use: 'Cụm node dương làm chậm giá', avoid: 'Giá xuyên qua sạch sẽ', fits: (_, r) => r.nodes.pos.length > 0 },
  { n: 6, name: 'Short-options continuation', use: 'Acceptance qua vùng continuation', avoid: 'Có tường đối lập ngay phía trước', fits: (_, r) => r.nodes.neg.length > 0 },
  { n: 7, name: 'Expected move fade', use: 'Biên bị từ chối trong chế độ bình yên', avoid: 'Chấp nhận ngoài biên kèm IV mở rộng', fits: (rd) => rd.gex === 'positive' && rd.iv !== 'expanding' },
  { n: 8, name: 'Gamma flip acceleration', use: 'Giá chấp nhận qua flip', avoid: 'Giá giành lại flip', fits: (rd, r) => r.zeroGamma != null && (rd.gex !== 'positive' || r.nearFlip) },
];

export function PlanTab({ chain, r, map, rd, term, futCode }: { chain: Chain; r: ExposureResult; map: LevelMap; rd: Reading; term: TermShape | null; futCode: string }) {
  const text = premarketText(chain, r, map, rd, futCode);
  const [copied, setCopied] = useState('Copy vào journal');
  const topOi = [...r.strikes].sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi))[0];
  const topShort = [...r.strikes].sort((a, b) => b.shortVol - a.shortVol)[0];
  const sc = scenarios(r, map, rd.gex);

  const steps: [string, string][] = [
    ['Spot đang ở đâu so với các strike lớn?', `Spot ${fmtLevel(chain.spot)} · call wall ${fmtLevel(r.callWall)} · put wall ${fmtLevel(r.putWall)} · strike 0-1DTE sôi nhất ${fmtLevel(topShort?.K)}`],
    ['GEX dương, âm hay gần flip?', `${GEX_VI[rd.gex]} (flip ${fmtLevel(r.zeroGamma)}) → ${rd.gex === 'positive' ? 'mean reversion' : rd.gex === 'negative' ? 'breakout / trend' : 'chuyển tiếp'}`],
    ['DEX nói gì?', `${DEX_VI[rd.dex]} (tỷ lệ ${r.totals.dexRatio.toFixed(3)})`],
    ['IV đang làm gì?', `${rd.iv ? IV_TREND_VI[rd.iv] : 'chưa rõ'}${term === 'front-rich' ? ' · front-end đắt (rủi ro sự kiện)' : ''}. Kiểm tra lịch CPI / FOMC / NFP / PCE.`],
    ['Volume và OI tập trung ở đâu?', `OI lớn nhất ${fmtLevel(topOi?.K)} (cấu trúc) · volume 0-1DTE lớn nhất ${fmtLevel(topShort?.K)} (đang sống)`],
    ['Level chính là gì?', `R1 ${fmtLevel(map.resistances[0]?.price)} (${map.resistances[0]?.role ?? '—'}) · S1 ${fmtLevel(map.supports[0]?.price)} (${map.supports[0]?.role ?? '—'})`],
    ['Cái gì sẽ xác nhận kế hoạch?', 'Phản ứng orderflow và acceptance tại level — xem trên chart futures. Dashboard này không có dữ liệu orderflow.'],
  ];

  return (
    <div className="grid2">
      <div className="main">
        <Card title="Quy trình tiền phiên 7 bước">
          <ol className="checklist">
            {steps.map(([q, a]) => (
              <li key={q}><div><b>{q}</b><br /><span>{a}</span></div></li>
            ))}
          </ol>
        </Card>
        <Card title="Kịch bản IF–THEN (gợi ý tự động)">
          {sc.length ? (
            <ol className="checklist">{sc.map((s) => <li key={s}><div><span>{s}</span></div></li>)}</ol>
          ) : (
            <p className="sub">Chưa đủ level để dựng kịch bản.</p>
          )}
          <p className="note">Chỉ là khung từ level trên bản đồ. Level không phải lệnh — lệnh chỉ có sau rejection / acceptance thật và có điểm sai viết trước.</p>
        </Card>
        <Card title="8 playbook — hợp chế độ hôm nay?">
          <div className="scroll-x">
            <table className="tbl playbooks">
              <thead><tr><th>#</th><th>Playbook</th><th>Dùng khi</th><th>Không dùng khi</th><th>Hôm nay</th></tr></thead>
              <tbody>
                {PLAYBOOKS.map((p) => {
                  const ok = p.fits(rd, r);
                  return (
                    <tr key={p.n}>
                      <td>{p.n}</td>
                      <td className="txt" style={{ color: 'var(--text)' }}>{p.name}</td>
                      <td className="txt">{p.use}</td>
                      <td className="txt">{p.avoid}</td>
                      <td className={ok ? 'on' : 'sub'}>{ok ? 'Có thể' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">Khi GEX, DEX, IV và giá mâu thuẫn nhau, playbook đúng là “không trade”.</p>
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
                  setCopied('Đã copy ✓');
                } catch {
                  setCopied('Chọn tay');
                }
                setTimeout(() => setCopied('Copy vào journal'), 1400);
              }}
            >
              {copied}
            </button>
          }
        >
          <pre className="plan-pre">{text}</pre>
          <p className="note">Mẫu của Module 11. Viết premarket trước phiên — viết sau khi phiên đóng là tự bịa lại trí nhớ.</p>
        </Card>
        <Card title="Ba câu hỏi trước mọi lệnh">
          <ol className="checklist">
            <li><div><span>Level này đã có trong kịch bản viết sẵn của tôi chưa?</span></div></li>
            <li><div><span>Hành vi xác nhận tôi yêu cầu đã xảy ra chưa?</span></div></li>
            <li><div><span>Điểm sai của tôi ở đâu, và khoảng cách tới đó có hợp lý không?</span></div></li>
          </ol>
          <p className="note">Bất kỳ câu nào trả lời “không” → không đặt lệnh.</p>
        </Card>
      </div>
    </div>
  );
}
