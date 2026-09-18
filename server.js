/**
 * server.js — local GEX dashboard. Zero dependencies, Node >= 18.
 *
 *   node server.js            → live CBOE delayed data
 *   MOCK=1 node server.js     → synthetic chain (offline dev)
 *
 * Routes
 *   GET /                      dashboard
 *   GET /api/chain?symbol=NDX  parsed, compact chain (what the UI uses)
 *   GET /api/raw?symbol=NDX    untouched CBOE JSON (debug; large)
 *   GET /api/levels?symbol=NDX&expiry=all&weight=oi&sign=1&fut=21500
 *                              computed levels as JSON — for ATAS / scripts
 */
'use strict';
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const GEX = require('./public/gex.js');

const PORT = Number(process.env.PORT) || 5173;
const MOCK = process.env.MOCK === '1';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60_000; // CBOE data is ~15 min delayed anyway
const FETCH_TIMEOUT_MS = 20_000;
const SYMBOL_RE = /^[A-Z]{1,6}$/;
const INDEX_SYMBOLS = new Set(['NDX', 'SPX', 'RUT', 'VIX', 'XSP', 'DJX']);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/gex.js': ['gex.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

const cboeUrl = (sym) =>
  `https://cdn.cboe.com/api/global/delayed_quotes/options/${INDEX_SYMBOLS.has(sym) ? '_' + sym : sym}.json`;

// ---------- cache with in-flight dedupe ----------
const cache = new Map(); // sym -> { at, raw, parsed }
const inflight = new Map(); // sym -> Promise

async function fetchRaw(sym) {
  if (MOCK) return require('./mock.js').buildMock(sym);
  const res = await fetch(cboeUrl(sym), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (local-gex-dashboard)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(
      res.status === 403 || res.status === 404
        ? `CBOE returned ${res.status} for ${sym}. Check the symbol (indexes use _NDX/_SPX, ETFs use QQQ/SPY).`
        : `CBOE returned HTTP ${res.status}`
    );
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function getChain(sym, force = false) {
  const hit = cache.get(sym);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  if (inflight.has(sym)) return inflight.get(sym);
  const p = (async () => {
    const t0 = Date.now();
    const raw = await fetchRaw(sym);
    const parsed = GEX.parseCboe(raw);
    const entry = { at: Date.now(), raw, parsed, fetchMs: Date.now() - t0 };
    cache.set(sym, entry);
    console.log(`[fetch] ${sym} ${parsed.contracts.length} contracts, spot ${parsed.spot}, ${entry.fetchMs}ms`);
    return entry;
  })().finally(() => inflight.delete(sym));
  inflight.set(sym, p);
  return p;
}

// ---------- helpers ----------
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readSymbol(url) {
  const sym = String(url.searchParams.get('symbol') || 'NDX').toUpperCase();
  if (!SYMBOL_RE.test(sym)) {
    const e = new Error('symbol must be 1–6 letters, e.g. NDX, SPX, QQQ');
    e.status = 400;
    throw e;
  }
  return sym;
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname in STATIC) {
    const [file, type] = STATIC[url.pathname];
    return send(res, 200, await fs.readFile(path.join(__dirname, 'public', file)), type);
  }

  if (url.pathname === '/api/chain') {
    const sym = readSymbol(url);
    const e = await getChain(sym, url.searchParams.get('force') === '1');
    return send(res, 200, { ...e.parsed, fetchedAt: e.at, mock: MOCK });
  }

  if (url.pathname === '/api/raw') {
    const sym = readSymbol(url);
    const e = await getChain(sym);
    return send(res, 200, e.raw);
  }

  if (url.pathname === '/api/levels') {
    const sym = readSymbol(url);
    const e = await getChain(sym);
    const q = url.searchParams;
    const expiry = q.get('expiry') || 'all';
    const opts = {
      weight: ['oi', 'vol', 'oivol'].includes(q.get('weight')) ? q.get('weight') : 'oi',
      sign: q.get('sign') === '-1' ? -1 : 1,
      rangePct: Math.min(Math.max(Number(q.get('range')) || 5, 1), 20),
      gridPoints: 121,
    };
    const contracts = GEX.filterContracts(e.parsed.contracts, expiry);
    const r = GEX.compute(e.parsed, contracts, opts);
    const mapper = GEX.makeMapper(sym, e.parsed.spot, Number(q.get('fut')));
    const m = (x) => (x == null ? null : +(mapper ? mapper.map(x) : x).toFixed(2));
    return send(res, 200, {
      symbol: sym,
      spot: e.parsed.spot,
      cboeTimestamp: e.parsed.cboeTimestamp,
      fetchedAt: e.at,
      expiry,
      ...opts,
      regime: r.regime,
      totalGexAtSpot: r.totalAtSpot,
      levels: { callWall: r.callWall, putWall: r.putWall, zeroGamma: r.zeroGamma, cumFlip: r.cumFlip },
      mapped: mapper
        ? { mode: mapper.mode, value: mapper.value, callWall: m(r.callWall), putWall: m(r.putWall), zeroGamma: m(r.zeroGamma), cumFlip: m(r.cumFlip) }
        : null,
      topStrikes: r.topStrikes.map((s) => ({ K: s.K, net: s.net, mapped: m(s.K) })),
    });
  }

  send(res, 404, { error: 'Not found' });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[error]', err.message);
      send(res, err.status || 500, { error: err.message });
    });
  })
  .listen(PORT, () => {
    console.log(`GEX dashboard → http://localhost:${PORT}  ${MOCK ? '(MOCK data)' : '(CBOE delayed)'}`);
  });
