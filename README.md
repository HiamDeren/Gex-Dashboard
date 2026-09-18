# gex-local

Local GEX dashboard on top of `cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json`.
Zero dependencies, Node >= 18.

```bash
npm start        # live CBOE data (~15 min delayed) → http://localhost:5173
npm run mock     # synthetic chain, no network
PORT=8080 npm start
```

## Endpoints
| Route | Purpose |
|---|---|
| `/` | Dashboard |
| `/api/chain?symbol=NDX` | Parsed chain used by the UI |
| `/api/raw?symbol=NDX` | Untouched CBOE JSON (large) |
| `/api/levels?symbol=NDX&expiry=all&weight=oi&sign=1&range=5&fut=21500` | Computed levels for ATAS / scripts |

`expiry`: `all` · `front` · `d7` · `d30` · `YYYY-MM-DD`
`weight`: `oi` · `vol` · `oivol`
`sign`: `1` (dealers long calls / short puts) · `-1` (inverted)
`fut`: futures price → levels mapped by basis (index) or ratio (ETF)

Indexes are requested as `_NDX`, `_SPX`; ETFs as `QQQ`, `SPY`.
Responses are cached 60s server-side (`CACHE_TTL_MS` to change).

## Math
- GEX per strike = gamma × weight × 100 × S² × 1%  ($ per 1% move)
- Call wall / put wall: largest |call GEX| above spot / |put GEX| below spot
- Zero gamma: total BS gamma repriced over a spot grid, interpolated sign change
- Cumulative flip: running net GEX by strike crosses zero (alternative definition)

Model output, not observed dealer positioning.
