/** Display formatting shared by the UI. */
import { nyDate } from './core.ts';

export function money(x: number | null | undefined, signed = true) {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  const s = signed ? (x < 0 ? '−' : '+') : x < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
export const px = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const strikeFmt = (x: number | null | undefined) =>
  x == null ? '—' : Number.isInteger(x) ? x.toLocaleString('en-US') : px(x, 2);
export const lvl = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : px(x, Math.abs(x) >= 1000 ? 0 : 2));
export const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const int = (x: number) => Math.round(x).toLocaleString('en-US');
export function compact(x: number) {
  const a = Math.abs(x);
  const s = x < 0 ? '−' : '';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
}
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s trước` : `${Math.floor(s / 60)}m ${s % 60}s trước`;
}
export function etTime(ms: number) {
  const t = nyDate(ms);
  return `${String(t.h).padStart(2, '0')}:${String(t.min).padStart(2, '0')}`;
}
