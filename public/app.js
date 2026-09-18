/* app.js — UI for the local GEX dashboard. Depends on window.GEX (gex.js). */
(() => {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const REFRESH_MS = 60_000;
    const LS_KEY = 'gex-local-settings-v1';
    const COLORS = {
        call: '#34d3b4',
        put: '#ff7a6b',
        flip: '#fbbf4a',
        spot: '#f1f5f9',
        grid: 'rgba(148,163,184,0.08)',
        line: 'rgba(148,163,184,0.28)',
        tagBg: 'rgba(11,15,22,0.88)',
    };

    const state = { chain: null, result: null, loading: false, lastFetch: 0, timer: null, profileScale: null, curveScale: null };

    // ---------- settings ----------
    const FIELDS = ['symbol', 'expiry', 'weight', 'sign', 'range', 'bucket', 'view', 'fut'];
    function loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
            for (const f of FIELDS) if (s[f] != null && f !== 'expiry') $(f).value = s[f];
            state.savedExpiry = s.expiry || 'all';
            if (typeof s.auto === 'boolean') $('auto').checked = s.auto;
        } catch {
            /* ignore corrupt storage */
        }
    }
    function saveSettings() {
        try {
            const s = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
            s.auto = $('auto').checked;
            localStorage.setItem(LS_KEY, JSON.stringify(s));
        } catch {
            /* storage unavailable */
        }
    }
    const opts = () => ({
        weight: $('weight').value,
        sign: Number($('sign').value),
        rangePct: Math.min(Math.max(Number($('range').value) || 5, 1), 20),
        bucket: Math.max(Number($('bucket').value) || 0, 0),
        gridPoints: 161,
    });

    // ---------- formatting ----------
    function money(x) {
        if (x == null || !isFinite(x)) return '—';
        const a = Math.abs(x);
        const s = x < 0 ? '−' : '+';
        if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
        if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
        if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
        return `${s}$${a.toFixed(0)}`;
    }
    const px = (x, d = 2) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    const strikeFmt = (x) => (x == null ? '—' : Number.isInteger(x) ? x.toLocaleString('en-US') : px(x, 2));
    const lvl = (x) => (x == null || !isFinite(x) ? '—' : px(x, Math.abs(x) >= 1000 ? 0 : 2));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    function ago(ms) {
        const s = Math.round((Date.now() - ms) / 1000);
        return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
    }
    const setDot = (cls) => ($('liveDot').className = 'dot ' + cls);

    // ---------- data ----------
    async function fetchChain(force = false) {
        const sym = $('symbol').value.trim().toUpperCase();
        if (!/^[A-Z]{1,6}$/.test(sym)) return showError('Symbol must be 1–6 letters, for example NDX, SPX or QQQ.');
        state.loading = true;
        $('refresh').disabled = true;
        $('refresh').textContent = 'Loading…';
        setDot('busy');
        try {
            const res = await fetch(`/api/chain?symbol=${sym}${force ? '&force=1' : ''}`);
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            const symChanged = !state.chain || state.chain.symbol !== body.symbol;
            state.chain = body;
            state.lastFetch = Date.now();
            populateExpiries(symChanged);
            showError(null);
            setDot('live');
            recompute();
        } catch (err) {
            setDot('err');
            $('hdrTime').textContent = 'Fetch failed';
            showError(`Could not load ${sym}: ${err.message}`);
        } finally {
            state.loading = false;
            $('refresh').disabled = false;
            $('refresh').textContent = 'Refresh';
        }
    }

    function populateExpiries(symChanged) {
        const sel = $('expiry');
        const prev = symChanged ? state.savedExpiry || 'all' : sel.value;
        const exps = GEX.listExpiries(state.chain.contracts);
        const now = Date.now();
        const dte = (ms) => Math.max(0, Math.floor((ms - now) / 864e5));
        sel.innerHTML =
            '<option value="all">All expiries</option>' +
            '<option value="front">Front expiry only</option>' +
            '<option value="d7">Within 7 days</option>' +
            '<option value="d30">Within 30 days</option>' +
            exps.map((e) => `<option value="${e.exp}">${e.exp} (${dte(e.expMs)}d)</option>`).join('');
        sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'all';
        state.savedExpiry = sel.value;
    }

    function recompute() {
        if (!state.chain) return;
        const t0 = performance.now();
        const contracts = GEX.filterContracts(state.chain.contracts, $('expiry').value);
        state.result = GEX.compute(state.chain, contracts, opts());
        state.computeMs = performance.now() - t0;
        saveSettings();
        render();
    }

    // ---------- render: side panel ----------
    function render() {
        const c = state.chain;
        const r = state.result;
        const mapper = GEX.makeMapper(c.symbol, c.spot, Number($('fut').value));
        const m = (x) => (x == null || !mapper ? null : mapper.map(x));

        $('hdrSym').textContent = c.symbol;
        $('hdrSpot').textContent = px(c.spot);
        if (c.prevClose) {
            const d = c.spot - c.prevClose;
            $('hdrChg').textContent = `${d >= 0 ? '+' : '−'}${px(Math.abs(d))} (${((d / c.prevClose) * 100).toFixed(2)}%)`;
            $('hdrChg').className = 'chg ' + (d >= 0 ? 'up' : 'down');
        }

        // Regime
        const reg = $('regime');
        reg.className = 'card regime ' + r.regime;
        $('regimeTitle').textContent = r.regime === 'positive' ? 'Positive gamma' : 'Negative gamma';
        const pill = $('hdrRegime');
        pill.hidden = false;
        pill.className = 'pill ' + r.regime;
        pill.textContent = r.regime === 'positive' ? '+γ regime' : '−γ regime';
        const dist = r.zeroGamma != null ? c.spot - r.zeroGamma : null;
        $('regimeText').textContent =
            (r.regime === 'positive'
                ? 'Dealer hedging tends to dampen moves: mean-reversion bias.'
                : 'Dealer hedging tends to amplify moves: trend and expansion risk.') +
            (dist != null ? ` Spot is ${px(Math.abs(dist))} pts ${dist >= 0 ? 'above' : 'below'} zero gamma.` : ' No zero-gamma crossing in range.') +
            ` Net GEX at spot ${money(r.totalAtSpot)} per 1%.`;
        renderLadder(c, r);

        // Levels table
        $('thUnd').textContent = c.symbol;
        $('thFut').textContent = mapper
            ? mapper.mode === 'basis'
                ? `Fut (${mapper.value >= 0 ? '+' : ''}${px(mapper.value)})`
                : `Fut (×${mapper.value.toFixed(3)})`
            : 'Futures';
        const rows = [
            ['Call wall', r.callWall, COLORS.call, 'Strike above spot with the largest |call GEX|. GEX = γ × weight × 100 × S² × 1%'],
            ['Spot', c.spot, COLORS.spot, 'CBOE delayed underlying price (~15 min)'],
            [
                'Zero gamma',
                r.zeroGamma,
                COLORS.flip,
                'Spot where total GEX changes sign, found by repricing every contract’s Black-Scholes gamma across a price grid, then interpolating linearly',
            ],
            [
                'Cumulative flip',
                r.cumFlip,
                COLORS.flip,
                'Strike where the running sum of net GEX (low → high strikes) crosses zero, interpolated. Alternative definition; often differs from zero gamma',
            ],
            ['Put wall', r.putWall, COLORS.put, 'Strike below spot with the largest |put GEX|'],
        ];
        $('levelsBody').innerHTML = rows
            .map(
                ([name, v, col, formula]) => `<tr><td title="${esc(formula)}"><span class="sw" style="background:${col}"></span>${name}</td>
        <td>${lvl(v)}</td><td class="${mapper ? '' : 'sub'}">${mapper ? lvl(m(v)) : '—'}</td></tr>`,
            )
            .join('');

        // Top strikes, with a magnitude bar relative to the largest
        const topMax = Math.max(...r.topStrikes.map((s) => Math.abs(s.net)), 1);
        $('topList').innerHTML =
            r.topStrikes
                .map((s) => {
                    const cls = s.net >= 0 ? 'pos' : 'neg';
                    const w = ((Math.abs(s.net) / topMax) * 100).toFixed(1);
                    return `<li><span>${strikeFmt(s.K)}${mapper ? ` <span class="sub">→ ${px(m(s.K))}</span>` : ''}</span>
                        <span class="bar-t"><i class="${cls}" style="width:${w}%"></i></span><span class="${cls}">${money(s.net)}</span></li>`;
                })
                .join('') || '<li>No strikes in range.</li>';

        // Expected move
        const em = r.expectedMove;
        $('emBox').innerHTML = em
            ? `<span>Expiry</span><span>${em.exp}</span>
         <span>ATM straddle (${strikeFmt(em.atmK)})</span><span>${em.straddle != null ? '±' + px(em.straddle) : '—'}</span>
         <span>IV × √T × S (IV ${(em.iv * 100).toFixed(1)}%)</span><span>${em.ivMove != null ? '±' + px(em.ivMove) : '—'}</span>`
            : '<span>Not available</span><span></span>';

        // Export
        const lv = (x) => (x == null ? null : +(mapper ? mapper.map(x) : x).toFixed(2));
        const parts = [
            [lv(r.callWall), 'CW'],
            [lv(r.zeroGamma), 'ZG'],
            [lv(r.putWall), 'PW'],
            ...r.topStrikes.slice(0, 3).map((s) => [lv(s.K), 'HG']),
        ].filter(([v]) => v != null);
        $('pineStr').textContent = parts.map(([v, t]) => `${v}:${t}`).join(',');
        const q = new URLSearchParams({
            symbol: c.symbol,
            expiry: $('expiry').value,
            weight: $('weight').value,
            sign: $('sign').value,
            range: $('range').value,
        });
        if (Number($('fut').value) > 0) q.set('fut', $('fut').value);
        $('apiLink').href = `/api/levels?${q}`;

        renderProfile();
        renderCurve();
        renderMeta();
    }

    /** Put wall → zero γ → spot → call wall on one horizontal track. */
    function renderLadder(c, r) {
        const box = $('ladder');
        const marks = [
            ['PW', r.putWall, COLORS.put],
            ['ZG', r.zeroGamma, COLORS.flip],
            ['CW', r.callWall, COLORS.call],
        ].filter(([, v]) => v != null);
        const vals = [c.spot, ...marks.map(([, v]) => v)];
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        if (!(hi > lo)) return (box.hidden = true);
        const pad = (hi - lo) * 0.06;
        const pos = (v) => (((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100).toFixed(2);
        box.hidden = false;
        box.innerHTML =
            '<div class="rail"></div>' +
            marks.map(([t, v, col]) => `<div class="mk" style="left:${pos(v)}%" title="${t} ${lvl(v)}"><span>${t}</span><i style="background:${col}"></i></div>`).join('') +
            `<div class="mk spot" style="left:${pos(c.spot)}%" title="Spot ${lvl(c.spot)}"><i></i><span>SPOT</span></div>`;
    }

    function renderMeta() {
        if (!state.chain) return;
        const c = state.chain;
        const next = $('auto').checked ? Math.max(0, Math.ceil((state.lastFetch + REFRESH_MS - Date.now()) / 1000)) : null;
        $('hdrTime').textContent = `${c.mock ? 'Mock · ' : 'Delayed · '}updated ${ago(c.fetchedAt)}${next != null ? ` · next ${next}s` : ''}`;
        $('meta').innerHTML =
            (c.mock ? '<div class="mock">Mock data (MOCK=1)</div>' : '') +
            `<div>CBOE timestamp: ${esc(c.cboeTimestamp || '—')}</div>` +
            `<div>Fetched ${ago(c.fetchedAt)}${next != null ? `, next in ${next}s` : ''}</div>` +
            `<div>${state.result.contractsUsed.toLocaleString()} contracts, computed in ${state.computeMs.toFixed(0)} ms</div>` +
            '<div>Model output, not observed dealer positioning. Not investment advice.</div>';
    }

    // ---------- svg helpers ----------
    /** Rounded label chip, anchored at its left edge, vertically centred on y. */
    function tag(x, y, text, col) {
        const w = text.length * 6.8 + 14;
        return (
            `<rect x="${x}" y="${(y - 10).toFixed(1)}" width="${w.toFixed(1)}" height="20" rx="6" fill="${COLORS.tagBg}" stroke="${col}" stroke-opacity="0.55"/>` +
            `<text class="lbl" x="${x + 7}" y="${(y + 4).toFixed(1)}" style="fill:${col}">${text}</text>`
        );
    }

    // ---------- render: profile (horizontal bars, price on Y) ----------
    function renderProfile() {
        const host = $('profile');
        const r = state.result;
        const rows = r.strikes;
        const W = Math.max(host.clientWidth, 320);
        const H = Math.max(420, Math.min(760, window.innerHeight - 380));
        const padL = 70,
            padR = 150,
            padT = 12,
            padB = 26;
        if (!rows.length) {
            host.innerHTML = `<svg viewBox="0 0 ${W} 120"><text x="12" y="60">No strikes in range — widen Range or change Expiry.</text></svg>`;
            return;
        }

        const split = $('view').value === 'split';
        const lo = r.spot * (1 - opts().rangePct / 100);
        const hi = r.spot * (1 + opts().rangePct / 100);
        const y = (K) => padT + ((hi - K) / (hi - lo)) * (H - padT - padB);
        const maxAbs = Math.max(...rows.map((s) => (split ? Math.max(Math.abs(s.call), Math.abs(s.put)) : Math.abs(s.net))), 1);
        const x0 = padL + (W - padL - padR) / 2;
        const half = (W - padL - padR) / 2;
        const xs = (v) => x0 + (v / maxAbs) * half;

        // bar thickness from median strike spacing
        const gaps = rows
            .slice(1)
            .map((s, i) => s.K - rows[i].K)
            .sort((a, b) => a - b);
        const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : (hi - lo) / 40;
        const bh = Math.max(1, Math.min(16, (((H - padT - padB) * gap) / (hi - lo)) * 0.78));

        let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="GEX by strike">`;
        s +=
            '<defs>' +
            `<linearGradient id="gC" x1="0" x2="1"><stop offset="0" stop-color="${COLORS.call}" stop-opacity="0.55"/><stop offset="1" stop-color="${COLORS.call}"/></linearGradient>` +
            `<linearGradient id="gP" x1="1" x2="0"><stop offset="0" stop-color="${COLORS.put}" stop-opacity="0.55"/><stop offset="1" stop-color="${COLORS.put}"/></linearGradient>` +
            '</defs>';
        // grid + price axis
        const ticks = niceTicks(lo, hi, 10);
        for (const t of ticks)
            s += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${COLORS.grid}"/><text x="${padL - 10}" y="${y(t) + 4}" text-anchor="end">${t.toLocaleString('en-US')}</text>`;
        s += `<line x1="${x0}" x2="${x0}" y1="${padT}" y2="${H - padB}" stroke="${COLORS.line}"/>`;
        // x labels
        s += `<text x="${padL}" y="${H - 6}">${money(-maxAbs)}</text><text x="${x0}" y="${H - 6}" text-anchor="middle">0</text><text x="${W - padR}" y="${H - 6}" text-anchor="end">${money(maxAbs)}</text>`;

        for (const row of rows) {
            const yy = y(row.K) - bh / 2;
            if (split) {
                s += barRect(xs(0), xs(row.call), yy, bh, row.call >= 0 ? 'url(#gC)' : 'url(#gP)');
                s += barRect(xs(0), xs(row.put), yy, bh, row.put >= 0 ? 'url(#gC)' : 'url(#gP)');
            } else {
                s += barRect(xs(0), xs(row.net), yy, bh, row.net >= 0 ? 'url(#gC)' : 'url(#gP)');
            }
        }

        // level lines
        const lines = [
            [r.callWall, COLORS.call, 'Call wall', '6 4'],
            [r.putWall, COLORS.put, 'Put wall', '6 4'],
            [r.zeroGamma, COLORS.flip, 'Zero γ', ''],
            [r.spot, COLORS.spot, 'Spot', '2 3'],
        ];
        const labels = [];
        for (const [v, col, name, dash] of lines) {
            if (v == null || v < lo || v > hi) continue;
            s += `<line x1="${padL}" x2="${W - padR + 6}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-width="1.25" stroke-opacity="0.9" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
            labels.push({ y: y(v), col, text: `${name} ${lvl(v)}` });
        }
        // push overlapping labels apart (min 22px), top to bottom
        labels.sort((a, b) => a.y - b.y);
        for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 22);
        for (const l of labels) s += tag(W - padR + 10, l.y, l.text, l.col);
        s += `<rect class="hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="transparent"/></svg>`;
        host.innerHTML = s;
        state.profileScale = { rows, y, lo, hi, padT, H, padB };

        const svg = host.querySelector('svg');
        svg.addEventListener('mousemove', (e) => profileHover(e, svg));
        svg.addEventListener('mouseleave', hideTip);
    }

    function barRect(xa, xb, y, h, fill) {
        const x = Math.min(xa, xb);
        const w = Math.abs(xb - xa);
        const rx = Math.min(3, h / 2, w / 2);
        return w < 0.3
            ? ''
            : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx.toFixed(1)}" fill="${fill}"/>`;
    }

    function profileHover(e, svg) {
        const sc = state.profileScale;
        const pt = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const yv = ((e.clientY - pt.top) / pt.height) * vb.height;
        const K = sc.hi - ((yv - sc.padT) / (sc.H - sc.padT - sc.padB)) * (sc.hi - sc.lo);
        let best = null;
        for (const r of sc.rows) if (!best || Math.abs(r.K - K) < Math.abs(best.K - K)) best = r;
        if (!best) return hideTip();
        const mapper = GEX.makeMapper(state.chain.symbol, state.chain.spot, Number($('fut').value));
        showTip(
            e,
            `<b>${strikeFmt(best.K)}</b>${mapper ? ` → ${px(mapper.map(best.K))}` : ''}<br>
      Net ${money(best.net)}<br>
      <span class="c">Calls ${money(best.call)}</span> · OI ${best.callOi.toLocaleString()} · vol ${best.callVol.toLocaleString()}<br>
      <span class="p">Puts ${money(best.put)}</span> · OI ${best.putOi.toLocaleString()} · vol ${best.putVol.toLocaleString()}`,
        );
    }

    // ---------- render: gamma curve ----------
    function renderCurve() {
        const host = $('curve');
        const r = state.result;
        const pts = r.curve;
        const W = Math.max(host.clientWidth, 320);
        const H = 240;
        const padL = 70,
            padR = 150,
            padT = 12,
            padB = 26;
        const minY = Math.min(0, ...pts.map((p) => p.gex));
        const maxY = Math.max(0, ...pts.map((p) => p.gex));
        const span = maxY - minY || 1;
        const lo = pts[0].S,
            hi = pts[pts.length - 1].S;
        const x = (S) => padL + ((S - lo) / (hi - lo)) * (W - padL - padR);
        const y = (v) => padT + ((maxY - v) / span) * (H - padT - padB);
        const y0 = y(0);

        let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total GEX versus spot">`;
        s +=
            '<defs>' +
            `<clipPath id="abv"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath><clipPath id="blw"><rect x="0" y="${y0}" width="${W}" height="${H}"/></clipPath>` +
            `<linearGradient id="aC" x1="0" x2="0" y1="${padT}" y2="${y0}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${COLORS.call}" stop-opacity="0.45"/><stop offset="1" stop-color="${COLORS.call}" stop-opacity="0.03"/></linearGradient>` +
            `<linearGradient id="aP" x1="0" x2="0" y1="${y0}" y2="${H - padB}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${COLORS.put}" stop-opacity="0.03"/><stop offset="1" stop-color="${COLORS.put}" stop-opacity="0.45"/></linearGradient>` +
            '</defs>';
        for (const t of niceTicks(lo, hi, 8))
            s += `<line x1="${x(t)}" x2="${x(t)}" y1="${padT}" y2="${H - padB}" stroke="${COLORS.grid}"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle">${t.toLocaleString('en-US')}</text>`;
        s += `<text x="${padL - 10}" y="${y(maxY) + 10}" text-anchor="end">${money(maxY)}</text><text x="${padL - 10}" y="${y(minY)}" text-anchor="end">${money(minY)}</text>`;

        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.S).toFixed(1)},${y(p.gex).toFixed(1)}`).join('');
        const area = `${line}L${x(hi)},${y0}L${x(lo)},${y0}Z`;
        s += `<path d="${area}" fill="url(#aC)" clip-path="url(#abv)"/><path d="${area}" fill="url(#aP)" clip-path="url(#blw)"/>`;
        s += `<line x1="${padL}" x2="${W - padR}" y1="${y0}" y2="${y0}" stroke="${COLORS.line}" stroke-width="1"/>`;
        s += `<path d="${line}" fill="none" stroke="${COLORS.call}" stroke-width="2" clip-path="url(#abv)" stroke-linejoin="round"/>`;
        s += `<path d="${line}" fill="none" stroke="${COLORS.put}" stroke-width="2" clip-path="url(#blw)" stroke-linejoin="round"/>`;

        const marks = [
            [r.spot, COLORS.spot, 'Spot', '2 3'],
            [r.zeroGamma, COLORS.flip, 'Zero γ', ''],
        ];
        marks.forEach(([v, col, name, dash], i) => {
            if (v == null || v < lo || v > hi) return;
            s += `<line x1="${x(v)}" x2="${x(v)}" y1="${padT}" y2="${H - padB}" stroke="${col}" stroke-width="1.25" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
            s += tag(W - padR + 10, padT + 12 + i * 26, `${name} ${lvl(v)}`, col);
        });
        s += `<line class="xh" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="${COLORS.line}" visibility="hidden"/>`;
        s += `<circle class="xh-dot" r="4" fill="${COLORS.spot}" stroke="#0b0f16" stroke-width="2" visibility="hidden"/>`;
        s += '</svg>';
        host.innerHTML = s;
        state.curveScale = { pts, x, lo, hi, padL, padR, W };

        const svg = host.querySelector('svg');
        const xh = svg.querySelector('.xh');
        const dot = svg.querySelector('.xh-dot');
        const hide = () => {
            xh.setAttribute('visibility', 'hidden');
            dot.setAttribute('visibility', 'hidden');
            hideTip();
        };
        svg.addEventListener('mousemove', (e) => {
            const b = svg.getBoundingClientRect();
            const xv = ((e.clientX - b.left) / b.width) * svg.viewBox.baseVal.width;
            const S = lo + ((xv - padL) / (W - padL - padR)) * (hi - lo);
            if (S < lo || S > hi) return hide();
            let best = pts[0];
            for (const p of pts) if (Math.abs(p.S - S) < Math.abs(best.S - S)) best = p;
            const bx = x(best.S).toFixed(1);
            xh.setAttribute('x1', bx);
            xh.setAttribute('x2', bx);
            xh.setAttribute('visibility', 'visible');
            dot.setAttribute('cx', bx);
            dot.setAttribute('cy', y(best.gex).toFixed(1));
            dot.setAttribute('visibility', 'visible');
            showTip(e, `If spot = <b>${px(best.S)}</b><br>Total GEX <span class="${best.gex >= 0 ? 'c' : 'p'}">${money(best.gex)}</span> per 1%`);
        });
        svg.addEventListener('mouseleave', hide);
    }

    function niceTicks(lo, hi, count) {
        const raw = (hi - lo) / count;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => st >= raw) || 10 * mag;
        const out = [];
        for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(+t.toFixed(6));
        return out;
    }

    // ---------- tooltip / errors ----------
    function showTip(e, html) {
        const tip = $('tip');
        tip.innerHTML = html;
        tip.hidden = false;
        const w = tip.offsetWidth;
        tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 8)}px`;
        tip.style.top = `${e.clientY + 14}px`;
    }
    function hideTip() {
        $('tip').hidden = true;
    }
    function showError(msg) {
        const el = $('error');
        el.hidden = !msg;
        el.textContent = msg || '';
        if (msg && !state.chain) {
            $('regimeTitle').textContent = 'No data';
            $('regimeText').textContent = 'Check that the server can reach cdn.cboe.com, then press Refresh.';
        }
    }

    // ---------- wiring ----------
    function scheduleAuto() {
        clearInterval(state.timer);
        state.timer = setInterval(() => {
            if (!$('auto').checked || state.loading) return renderMetaSafe();
            if (Date.now() - state.lastFetch >= REFRESH_MS) fetchChain();
            else renderMetaSafe();
        }, 1000);
    }
    const renderMetaSafe = () => state.result && renderMeta();

    function debounce(fn, ms) {
        let t;
        return (...a) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...a), ms);
        };
    }

    loadSettings();
    $('controls').addEventListener('submit', (e) => {
        e.preventDefault();
        fetchChain(true);
    });
    $('symbol').addEventListener('change', () => {
        state.savedExpiry = 'all';
        fetchChain();
    });
    ['expiry', 'weight', 'sign', 'view'].forEach((id) => $(id).addEventListener('change', recompute));
    ['range', 'bucket', 'fut'].forEach((id) => $(id).addEventListener('input', debounce(recompute, 250)));
    $('refresh').addEventListener('click', () => fetchChain(true));
    $('auto').addEventListener('change', () => {
        saveSettings();
        renderMetaSafe();
    });
    $('copyPine').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('pineStr').textContent);
            $('copyPine').textContent = 'Copied ✓';
            setTimeout(() => ($('copyPine').textContent = 'Copy'), 1200);
        } catch {
            $('copyPine').textContent = 'Select manually';
        }
    });
    window.addEventListener(
        'resize',
        debounce(() => state.result && (renderProfile(), renderCurve()), 150),
    );

    fetchChain();
    scheduleAuto();
})();
