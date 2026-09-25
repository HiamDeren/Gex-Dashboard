import { errorResponse, getChain, readSymbol } from '@/lib/server/cboe.ts';
import { filterContracts, makeMapper, type Weight } from '@/lib/core.ts';
import { compute } from '@/lib/exposure.ts';
import { buildLevelMap, ROLE_LABEL } from '@/lib/levels.ts';
import { isLang } from '@/lib/i18n.ts';
import { read } from '@/lib/bias.ts';
import { ivTrend, termShape, termStructure } from '@/lib/vol.ts';

export const dynamic = 'force-dynamic';

/**
 * Computed levels as JSON — for ATAS / scripts.
 * GET /api/levels?symbol=NDX&expiry=all&weight=oi&sign=1&range=5&fut=21500&nodeMin=1000&lang=vi
 * v0.1 fields are unchanged; exposures, expectedMove, bias and the S/R map are additions.
 * `lang` (vi | en, default vi) only changes the text fields: bias sentence / warnings / cell and zone roles.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sym = readSymbol(url);
    const e = await getChain(sym);
    const q = url.searchParams;
    const expiry = q.get('expiry') || 'all';
    const l = q.get('lang');
    const lang = isLang(l) ? l : 'vi';
    const w = q.get('weight');
    const opts = {
      weight: (['oi', 'vol', 'oivol'].includes(w ?? '') ? w : 'oi') as Weight,
      sign: (q.get('sign') === '-1' ? -1 : 1) as 1 | -1,
      rangePct: Math.min(Math.max(Number(q.get('range')) || 5, 1), 20),
      gridPoints: 121,
      nodeMin: Math.max(Number(q.get('nodeMin')) || 1000, 0),
    };
    const contracts = filterContracts(e.chain.contracts, expiry);
    const r = compute(e.chain, contracts, opts);
    const map = buildLevelMap(r);
    const ts = termStructure(e.chain.contracts, e.chain.spot);
    const rd = read(e.chain, r, map, ivTrend(e.chain), termShape(ts)?.shape ?? null, Date.now(), lang);
    const mapper = makeMapper(sym, e.chain.spot, Number(q.get('fut')));
    const m = (x: number | null) => (x == null ? null : +(mapper ? mapper.map(x) : x).toFixed(2));
    const zone = (z: (typeof map.supports)[number]) => ({
      label: z.label, lo: z.lo, hi: z.hi, price: +z.price.toFixed(2), mapped: m(z.price), role: ROLE_LABEL[lang][z.role], sources: z.sources, score: z.score.total, grade: z.grade,
    });

    return Response.json(
      {
        symbol: sym,
        spot: e.chain.spot,
        cboeTimestamp: e.chain.cboeTimestamp,
        fetchedAt: e.at,
        expiry,
        lang,
        ...opts,
        regime: r.regime,
        nearFlip: r.nearFlip,
        totalGexAtSpot: r.totals.gex,
        levels: { callWall: r.callWall, putWall: r.putWall, zeroGamma: r.zeroGamma, cumFlip: r.cumFlip, hvl: r.hvl },
        mapped: mapper
          ? { mode: mapper.mode, value: mapper.value, callWall: m(r.callWall), putWall: m(r.putWall), zeroGamma: m(r.zeroGamma), cumFlip: m(r.cumFlip), hvl: m(r.hvl) }
          : null,
        topStrikes: r.topStrikes.map((s) => ({ K: s.K, net: s.netGex, mapped: m(s.K) })),
        exposures: {
          gexPer1pct: r.totals.gex,
          dex: r.totals.dex,
          dexRatio: r.totals.dexRatio,
          vannaPerVolPt: r.totals.vanna,
          charmPerDay: r.totals.charm,
          hedgePerPoint: r.totals.hedgePerPoint,
          futCode: r.totals.futCode,
          speed: r.speed,
        },
        expectedMove: r.expectedMove,
        bias: { gex: rd.gex, dex: rd.dex, cell: rd.cell, iv: rd.iv, sentence: rd.sentence, warnings: rd.warnings },
        map: { resistances: map.resistances.map(zone), supports: map.supports.map(zone) },
        nodes: {
          pos: r.nodes.pos.slice(0, 5).map((x) => ({ K: x.K, net: x.netContracts, mapped: m(x.K) })),
          neg: r.nodes.neg.slice(0, 5).map((x) => ({ K: x.K, net: x.netContracts, mapped: m(x.K) })),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
