# gex-local

Options-exposure dashboard (GEX, DEX, vanna, charm, IV) on CBOE delayed option quotes
(`cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json`, ~15 min delayed).
Next.js 16 + React 19, no chart library. Node >= 20.9.

Live demo: https://gex-local.vercel.app (Vercel, redeploys on every push to `main`).

Features follow the "Options Flow → Giao dịch Futures" curriculum (5 layers: regime → bias → level → confirmation → plan).

UI in English and Vietnamese (EN / VI switch, top right; saved with the other settings). Symbol is a dropdown of
indexes, ETFs and large-cap stocks; "Other…" accepts any CBOE ticker. UI strings live in `lib/i18n.ts`; text built
from data (bias sentence, warnings, scenarios, journal, level roles) sits next to its logic in `lib/` and takes a `lang` argument.

```bash
npm install
npm run dev      # http://localhost:5173
npm run mock     # synthetic chain, no network
npm test         # math tests (node --test, no extra deps)
npm run build && npm start
```

## Tabs
| Tab (VI / EN) | What it shows |
|---|---|
| Tổng quan / Overview | Regime (flip, speed, futures hedged per point), GEX × DEX bias matrix + bias sentence, key levels, exposure tiles, profile by strike, GEX-vs-spot curve |
| Exposure | Profile switchable GEX / DEX / Vanna / Charm / Net contracts, nodes ≥ threshold, profile quality |
| Heat map | Gamma and charm, price × time of the current session, repriced with Black-Scholes; flip line over time |
| Volatility | Expected move, IV smile per expiry, ATM term structure, 25Δ risk reversal |
| Bản đồ level / Level map | S1–S5 / R1–R5 zones scored on the curriculum's 15-point rubric (13 automatic + 2 for observed reaction) |
| Kế hoạch / Plan | 7-step pre-market checklist, IF–THEN scenarios, 8 playbooks, journal template to copy |

## Endpoints
| Route | Purpose |
|---|---|
| `/api/chain?symbol=NDX` | Parsed chain used by the UI |
| `/api/raw?symbol=NDX` | Untouched CBOE JSON (large) |
| `/api/levels?symbol=NDX&expiry=all&weight=oi&sign=1&range=5&fut=21500&nodeMin=1000&lang=vi` | Levels, exposures, bias and S/R map as JSON (ATAS / scripts). v0.1 fields unchanged |

`expiry`: `all` · `front` · `d7` · `d30` · `YYYY-MM-DD` — `weight`: `oi` · `vol` · `oivol` —
`sign`: `1` (dealers long calls / short puts, the "naive" model) · `-1` (inverted) — `fut`: futures price, mapped by basis (index) or ratio (ETF) —
`lang`: `vi` (default) · `en`, language of the text fields (bias, warnings, zone roles).
Responses are cached 60 s server-side (`CACHE_TTL_MS`).

## Math (`lib/`)
Dealer position per contract `q = ±weight` (+ calls, − puts under `sign=1`). r = q = 0 Black-Scholes.
- GEX = q · Γ · 100 · S² · 1% ($ per 1% move). Vendor gamma, BS fallback — identical to v0.1
- DEX = Δ · weight · 100 · S (curriculum formula, no dealer sign); bias lean at |DEX / Σ|DEX|| ≥ 0.10
- Vanna exposure = q · ∂Δ/∂σ · 1% · 100 · S; shown as dealer hedge flow (−exposure) for IV +1 point
- Charm exposure = q · dΔ/dt / 365 · 100 · S; shown as dealer hedge flow per day / hour
- Zero gamma: total BS gamma repriced over a spot grid, interpolated sign change. Speed: sign of dΓ/dS at spot
- Expected move 1 day = Spot × IV30 × √(1/252) (ATM IV fallback)

Model output, not observed dealer positioning. Not investment advice.
