'use client';
/** Small shared UI pieces: element width, tooltip, segmented control, chart helpers. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DICT, LANGS, type Lang } from '@/lib/i18n';

const LangContext = createContext<Lang>('vi');
export const LangProvider = LangContext.Provider;
/** Current UI language and its dictionary. */
export function useLang() {
  const lang = useContext(LangContext);
  return { lang, t: DICT[lang] };
}

export const COLORS = {
  call: '#34d3b4',
  put: '#ff7a6b',
  flip: '#fbbf4a',
  spot: '#f1f5f9',
  accent: '#7c8cff',
  em: '#b58cff',
  grid: 'rgba(148,163,184,0.08)',
  line: 'rgba(148,163,184,0.28)',
  tagBg: 'rgba(11,15,22,0.88)',
};

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Fixed-position tooltip that follows the mouse. */
export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body }), []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div className="tip" style={{ left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280), top: tip.y + 14 }}>
      {tip.body}
    </div>
  ) : null;
  return { node, show, hide };
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function LangSwitch({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang" role="group" aria-label={DICT[value].langName}>
      {LANGS.map(([l, label]) => (
        <button key={l} type="button" lang={l} aria-pressed={l === value} onClick={() => onChange(l)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function niceTicks(lo: number, hi: number, count: number) {
  const raw = (hi - lo) / count;
  if (!(raw > 0)) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => st >= raw) || 10 * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(+t.toFixed(6));
  return out;
}

/** Rounded label chip in SVG, anchored at its left edge, vertically centred on y. */
export function Tag({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6.8 + 14;
  return (
    <g>
      <rect x={x} y={y - 10} width={w} height={20} rx={6} fill={COLORS.tagBg} stroke={color} strokeOpacity={0.55} />
      <text className="lbl" x={x + 7} y={y + 4} style={{ fill: color }}>
        {text}
      </text>
    </g>
  );
}

/** Push labels apart vertically so they do not overlap (min gap, top to bottom). */
export function spreadLabels<T extends { y: number }>(labels: T[], gap = 22) {
  const out = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) out[i].y = Math.max(out[i].y, out[i - 1].y + gap);
  return out;
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="chart-head">
          {title ? <h2>{title}</h2> : <span />}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
