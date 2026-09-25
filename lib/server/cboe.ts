/**
 * cboe.ts — server-only CBOE fetch with a 60 s cache and in-flight de-duplication.
 * The cache lives on globalThis so it survives Next dev hot reloads.
 */
import 'server-only';
import { parseCboe, INDEX_SYMBOLS, type Chain } from '../core.ts';
import { buildMock } from '../mock.ts';

export const MOCK = process.env.MOCK === '1';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60_000; // CBOE data is ~15 min delayed anyway
const FETCH_TIMEOUT_MS = 20_000;
const SYMBOL_RE = /^[A-Z]{1,6}$/;

export interface Entry {
  at: number;
  raw: unknown;
  chain: Chain;
  fetchMs: number;
}

const g = globalThis as unknown as { __gexCache?: Map<string, Entry>; __gexInflight?: Map<string, Promise<Entry>> };
const cache = (g.__gexCache ??= new Map());
const inflight = (g.__gexInflight ??= new Map());

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function readSymbol(url: URL) {
  const sym = String(url.searchParams.get('symbol') || 'NDX').toUpperCase();
  if (!SYMBOL_RE.test(sym)) throw new HttpError(400, 'symbol must be 1–6 letters, e.g. NDX, SPX, QQQ');
  return sym;
}

const cboeUrl = (sym: string) =>
  `https://cdn.cboe.com/api/global/delayed_quotes/options/${INDEX_SYMBOLS.has(sym) ? '_' + sym : sym}.json`;

async function fetchRaw(sym: string): Promise<unknown> {
  if (MOCK) return buildMock(sym);
  const res = await fetch(cboeUrl(sym), {
    headers: { 'User-Agent': 'Mozilla/5.0 (local-gex-dashboard)', Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new HttpError(
      502,
      res.status === 403 || res.status === 404
        ? `CBOE returned ${res.status} for ${sym}. Check the symbol (indexes use _NDX/_SPX, ETFs use QQQ/SPY).`
        : `CBOE returned HTTP ${res.status}`,
    );
  }
  return res.json();
}

export async function getChain(sym: string, force = false): Promise<Entry> {
  const hit = cache.get(sym);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const pending = inflight.get(sym);
  if (pending) return pending;
  const p = (async () => {
    const t0 = Date.now();
    const raw = await fetchRaw(sym);
    const chain = parseCboe(raw);
    const entry: Entry = { at: Date.now(), raw, chain, fetchMs: Date.now() - t0 };
    cache.set(sym, entry);
    console.log(`[fetch] ${sym} ${chain.contracts.length} contracts, spot ${chain.spot}, ${entry.fetchMs}ms`);
    return entry;
  })().finally(() => inflight.delete(sym));
  inflight.set(sym, p);
  return p;
}

export function errorResponse(err: unknown) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error('[error]', message);
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
