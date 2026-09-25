import { errorResponse, getChain, readSymbol, MOCK } from '@/lib/server/cboe.ts';

export const dynamic = 'force-dynamic';

/** Parsed, compact chain — what the dashboard uses. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const e = await getChain(readSymbol(url), url.searchParams.get('force') === '1');
    return Response.json({ ...e.chain, fetchedAt: e.at, mock: MOCK }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
