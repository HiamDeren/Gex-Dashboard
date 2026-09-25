import { errorResponse, getChain, readSymbol } from '@/lib/server/cboe.ts';

export const dynamic = 'force-dynamic';

/** Untouched CBOE JSON (debug; large). */
export async function GET(req: Request) {
  try {
    const e = await getChain(readSymbol(new URL(req.url)));
    return Response.json(e.raw, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
