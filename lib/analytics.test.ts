import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bsGamma, bsGreeks, ncdf, parseCboe, sessionWindow, yearsTo, MULTIPLIER } from './core.ts';
import { compute } from './exposure.ts';
import { buildHeatmap } from './heatmap.ts';
import { buildLevelMap } from './levels.ts';
import { read, scenarios, premarketText, MATRIX } from './bias.ts';
import { termStructure, smile, ivTrend } from './vol.ts';
import { buildMock } from './mock.ts';

// Friday 2026-09-18 10:00 ET (14:00 UTC, EDT)
const NOW = Date.UTC(2026, 8, 18, 14, 0);
const close = (a: number, b: number, rel = 1e-4, abs = 1e-9) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

test('normal cdf matches reference values', () => {
  assert.ok(close(ncdf(0), 0.5, 1e-7));
  assert.ok(close(ncdf(1.96), 0.9750021, 1e-6));
  assert.ok(close(ncdf(-1), 0.1586553, 1e-6));
});

test('BS greeks agree with finite differences', () => {
  const [S, K, T, iv] = [21000, 21300, 20 / 365, 0.19];
  for (const type of ['C', 'P'] as const) {
    const g = bsGreeks(S, K, T, iv, type);
    const h = 0.5, e = 1e-4, dt = 1e-6;
    const gammaFd = (bsGreeks(S + h, K, T, iv, type).delta - bsGreeks(S - h, K, T, iv, type).delta) / (2 * h);
    const vannaFd = (bsGreeks(S, K, T, iv + e, type).delta - bsGreeks(S, K, T, iv - e, type).delta) / (2 * e);
    const charmFd = (bsGreeks(S, K, T - dt, iv, type).delta - bsGreeks(S, K, T + dt, iv, type).delta) / (2 * dt); // time forward = T shrinks
    assert.ok(close(g.gamma, gammaFd, 1e-4), `${type} gamma ${g.gamma} vs ${gammaFd}`);
    assert.ok(close(g.vanna, vannaFd, 1e-3), `${type} vanna ${g.vanna} vs ${vannaFd}`);
    assert.ok(close(g.charm, charmFd, 1e-3), `${type} charm ${g.charm} vs ${charmFd}`);
    assert.ok(close(g.gamma, bsGamma(S, K, T, iv), 1e-12));
  }
  // put-call parity on delta (r = q = 0)
  assert.ok(close(bsGreeks(S, K, T, iv, 'C').delta - bsGreeks(S, K, T, iv, 'P').delta, 1, 1e-9));
  // OTM call loses delta as time passes; ITM call gains it
  assert.ok(bsGreeks(S, 22000, T, iv, 'C').charm < 0);
  assert.ok(bsGreeks(S, 20000, T, iv, 'C').charm > 0);
});

test('session window: live Friday session, weekend rolls to Monday', () => {
  const fri = sessionWindow(NOW);
  assert.equal(fri.open, Date.UTC(2026, 8, 18, 13, 30));
  assert.equal(fri.close, Date.UTC(2026, 8, 18, 20, 0));
  assert.equal(fri.live, true);
  const sat = sessionWindow(Date.UTC(2026, 8, 19, 15, 0));
  assert.equal(sat.open, Date.UTC(2026, 8, 21, 13, 30));
  assert.equal(sat.live, false);
  // winter (EST): 09:30 ET = 14:30 UTC
  assert.equal(sessionWindow(Date.UTC(2026, 11, 1, 12, 0)).open, Date.UTC(2026, 11, 1, 14, 30));
});

const chain = parseCboe(buildMock('NDX', NOW), NOW);
const r = compute(chain, chain.contracts, { rangePct: 5 }, NOW);

test('parser keeps symbol, IV30 and vendor delta', () => {
  assert.equal(chain.symbol, 'NDX');
  assert.equal(chain.iv30, 18.2);
  assert.ok(chain.contracts.length > 1000);
  assert.ok(chain.contracts.some((c) => c.delta !== 0));
});

test('exposure totals are the sum of strike rows and levels are sane', () => {
  const sum = (f: (x: (typeof r.allStrikes)[number]) => number) => r.allStrikes.reduce((s, x) => s + f(x), 0);
  assert.ok(close(r.totals.gex, sum((x) => x.netGex), 1e-9));
  assert.ok(close(r.totals.dex, sum((x) => x.dex), 1e-9));
  assert.ok(close(r.totals.vanna, sum((x) => x.vanna), 1e-9));
  assert.ok(close(r.totals.charm, sum((x) => x.charm), 1e-9));
  assert.ok(r.totals.dexRatio >= -1 && r.totals.dexRatio <= 1);
  assert.ok(r.callWall! >= r.spot && r.putWall! <= r.spot);
  assert.ok(r.zeroGamma != null && Math.abs(r.zeroGamma / r.spot - 1) < 0.05);
  assert.ok(r.expectedMove && close(r.expectedMove.em1d, r.spot * 0.182 * Math.sqrt(1 / 252), 1e-9));
  assert.equal(r.totals.futCode, 'NQ');
  // NQ contracts per point = Σ q·Γ·100 / $20
  const T = (c: (typeof chain.contracts)[number]) => yearsTo(c.expMs, NOW);
  const sumQG = chain.contracts.reduce((s, c) => s + (c.type === 'C' ? 1 : -1) * c.oi * (c.gamma > 0 ? c.gamma : bsGamma(r.spot, c.K, T(c), c.iv)), 0);
  assert.ok(close(r.totals.hedgePerPoint!, (sumQG * MULTIPLIER) / 20, 1e-9));
});

test('sign = -1 mirrors every dealer-signed exposure but not DEX', () => {
  const inv = compute(chain, chain.contracts, { rangePct: 5, sign: -1 }, NOW);
  assert.ok(close(inv.totals.gex, -r.totals.gex, 1e-9));
  assert.ok(close(inv.totals.vanna, -r.totals.vanna, 1e-9));
  assert.ok(close(inv.totals.charm, -r.totals.charm, 1e-9));
  assert.ok(close(inv.totals.dex, r.totals.dex, 1e-9));
});

test('heat map first column matches a direct gamma sum at the same price', () => {
  const hm = buildHeatmap(chain.spot, chain.contracts, { weight: 'oi', sign: 1, rangePct: 5, priceSteps: 21 }, NOW);
  assert.equal(hm.times[0], NOW);
  assert.equal(hm.times.at(-1), hm.session.close - 60_000);
  const i = 10;
  const x = hm.prices[i];
  let direct = 0;
  for (const c of chain.contracts) {
    if (!(c.oi > 0) || !(c.iv > 0)) continue;
    direct += (c.type === 'C' ? 1 : -1) * c.oi * bsGamma(x, c.K, yearsTo(c.expMs, NOW), c.iv) * MULTIPLIER * x * x * 0.01;
  }
  assert.ok(close(hm.gamma[0][i], direct, 1e-3), `${hm.gamma[0][i]} vs ${direct}`);
  // the 0DTE expiry settles at 16:00: the last column must differ from the first
  assert.notEqual(hm.gamma.at(-1)![i], hm.gamma[0][i]);
});

test('level map: supports below spot, resistances above, nearest first, ≤5 per side', () => {
  const map = buildLevelMap(r);
  assert.ok(map.supports.length <= 5 && map.resistances.length <= 5);
  assert.ok(map.supports.every((z) => z.price < r.spot) && map.resistances.every((z) => z.price > r.spot));
  const dist = (z: { price: number }) => Math.abs(z.price - r.spot);
  for (const side of [map.supports, map.resistances]) {
    for (let i = 1; i < side.length; i++) assert.ok(dist(side[i]) >= dist(side[i - 1]));
    side.forEach((z) => assert.ok(z.score.total >= 0 && z.score.total <= 13));
  }
  assert.equal(map.supports[0]?.label, 'S1');
});

test('reading uses the curriculum matrix cell', () => {
  const map = buildLevelMap(r);
  const rd = read(chain, r, map, ivTrend(chain), null, NOW);
  assert.equal(rd.cell, MATRIX.vi[rd.gex][rd.dex]);
  assert.equal(rd.iv, 'compressing'); // mock iv30_change = -0.4
  assert.match(rd.sentence, /^Chế độ đang /);
});

test('reading, scenarios and journal follow the requested language', () => {
  const map = buildLevelMap(r);
  const en = read(chain, r, map, ivTrend(chain), 'front-rich', NOW, 'en');
  const vi = read(chain, r, map, ivTrend(chain), 'front-rich', NOW, 'vi');
  assert.equal(en.cell, MATRIX.en[en.gex][en.dex]);
  assert.match(en.sentence, /^The regime is /);
  assert.equal(en.warnings.length, vi.warnings.length);
  assert.ok(en.warnings.every((w) => !/[ạảãầấậẩẫằắặẳẵẹẻẽềếệểễịỉĩọỏõồốộổỗờớợởỡụủũừứựửữỳỵỷỹđ]/i.test(w)), 'no Vietnamese left in en warnings');
  const text = premarketText(chain, r, map, en, 'NQ', 'en');
  assert.match(text, /^DATE: /);
  assert.ok(text.split('\n').some((l) => l.startsWith('Regime:           ')), 'labels padded to 18 columns');
  assert.deepEqual(scenarios(r, map, en.gex, 'en').length, scenarios(r, map, vi.gex, 'vi').length);
});

test('vol: term structure has ATM IV and downside skew on the mock', () => {
  const ts = termStructure(chain.contracts, chain.spot, NOW);
  assert.ok(ts.length >= 5);
  assert.ok(ts.every((p) => p.atmIv > 0.1 && p.atmIv < 0.4));
  assert.ok(ts.some((p) => p.rr25 != null && p.rr25 > 0), 'mock has put skew');
  const sm = smile(chain.contracts, ts[1].exp, chain.spot, 5);
  assert.ok(sm.length > 10 && sm.every((p) => p.otmIv != null));
});
