import {
  TEAMS, IDS, TEAM, SCHEDULE, MATCH, ROUNDS, PAYOUT, START, GAMES_PER_TEAM,
  M, normTour, activeIds, qFromUsers, priceMap, worth, standings, rankTeams, nextMatch,
} from './shared.js';

const POLL_MS = 4000;
const S = {
  tour: normTour(null), users: [], trades: [], loaded: false, offline: false,
  storage: null, needsCode: false,
  session: load('powerball.session'), adminKey: load('powerball.admin'),
  sel: 'T1', mode: 'buy', busy: false, settleArmed: false, scoreMatch: null,
};

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const r6 = x => Math.round(x * 1e6) / 1e6;
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const f0 = x => Math.round(x).toLocaleString();
const pd = n => (n > 0 ? '+' : '') + n;
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400); }

async function api(path, body, headers = {}) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(d.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
  return d;
}
const authHeader = () => (S.session ? { authorization: 'Bearer ' + S.session.token } : {});
const adminHeader = () => ({ 'x-admin-key': S.adminKey || '' });

/* ---------- derived state ---------- */
const me = () => (S.session ? S.users.find(u => u.id === S.session.id) || null : null);
const prices = () => priceMap(qFromUsers(S.users), activeIds(S.tour), S.tour.b);
const isOut = id => id in S.tour.eliminated && id !== S.tour.champion;

function history() {
  const ev = S.trades.filter(t => t && IDS.includes(t.t)).map(t => ({ ...t }));
  for (const [k, ts] of Object.entries(S.tour.eliminated)) ev.push({ ts: +ts || 0, elim: k });
  ev.sort((a, b) => a.ts - b.ts);
  const q = Object.fromEntries(IDS.map(i => [i, 0])); const dead = new Set();
  const series = Object.fromEntries(IDS.map(i => [i, []]));
  const snap = ts => { const p = priceMap(q, IDS.filter(i => !dead.has(i)), S.tour.b); for (const i of IDS) series[i].push([ts, p[i]]); };
  snap(ev.length ? ev[0].ts - 1 : Date.now());
  for (const e of ev) { if (e.elim) dead.add(e.elim); else q[e.t] += +e.n || 0; snap(e.ts); }
  return { ev, series };
}
function currentRound() {
  const m = SCHEDULE.find(x => !S.tour.results[x.id]);
  return m ? m.round : null;
}

/* ---------- render ---------- */
function render() {
  const P = prices(), H = history(), ST = standings(S.tour.results);
  renderHeader(P); renderJoin(); renderBoard(P, H, ST); renderTicket(P);
  renderLeaders(P); renderLadder(P, ST); renderSchedule(); renderFeed(H); renderAdmin(ST);
}

function renderHeader(P) {
  const st = $('#status'), lbl = st.querySelector('span');
  st.className = 'pill';
  if (S.offline) lbl.textContent = 'Reconnecting…';
  else if (!S.loaded) lbl.textContent = 'Connecting…';
  else if (S.tour.status === 'settled') { st.classList.add('settled'); lbl.textContent = `Champions: ${S.tour.champion} · ${TEAM[S.tour.champion].name}`; }
  else if (S.tour.status === 'paused') { st.classList.add('paused'); lbl.textContent = 'Trading paused'; }
  else { st.classList.add('open'); lbl.textContent = 'Trading open'; }
  const u = me();
  $('#wallet').hidden = !u;
  if (u) {
    const net = worth(u, P);
    $('#w-cash').textContent = f1(u.cash || 0);
    $('#w-hold').textContent = f1(net - (u.cash || 0));
    $('#w-net').textContent = f1(net);
  }
  const warn = $('#warn');
  warn.hidden = S.storage !== 'memory';
  warn.textContent = 'Database not connected: bets are kept in temporary memory and will be lost. Connect Upstash Redis in Vercel (see README), then redeploy.';
}

function renderJoin() {
  const u = me();
  // A saved session whose account no longer exists (e.g. the database was reset)
  if (S.loaded && S.session && !u) { S.session = null; save('powerball.session', null); }
  const settled = S.tour.status === 'settled';
  $('#joinform').hidden = !S.loaded || !!u || settled;
  $('#j-code-wrap').hidden = !S.needsCode;
  $('#whoami').hidden = !u;
  if (u) $('#who-name').textContent = u.name;
}

function spark(series) {
  const pts = series.slice(-40);
  if (pts.length < 2) return h('span', { class: 'muted', style: 'font-size:.75rem', text: 'no trades' });
  const ys = pts.map(p => p[1]); let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 0.01) { const m = (hi + lo) / 2; lo = m - 0.005; hi = m + 0.005; }
  const W = 104, H = 30, pad = 3, ns = 'http://www.w3.org/2000/svg';
  const xy = pts.map((p, i) => [pad + i * (W - 2 * pad) / (pts.length - 1), H - pad - (p[1] - lo) / (hi - lo) * (H - 2 * pad)]);
  const col = ys[ys.length - 1] >= ys[0] ? 'var(--up)' : 'var(--down)';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('aria-hidden', 'true');
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const last = xy[xy.length - 1];
  svg.append(
    mk('path', { d: `${d} L${last[0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`, fill: col, opacity: '.12' }),
    mk('path', { d, fill: 'none', stroke: col, 'stroke-width': '1.6', 'stroke-linejoin': 'round' }),
    mk('circle', { cx: last[0], cy: last[1], r: '2.4', fill: col }));
  return svg;
}

function recordLine(id, ST) {
  const r = ST[id];
  const parts = [];
  parts.push(r.played ? `${r.w}–${r.l}` + (r.pf + r.pa ? ` · ${pd(r.pf - r.pa)} pts` : '') : 'No games yet');
  const nx = nextMatch(id, S.tour.results);
  if (nx) { const opp = nx.a === id ? nx.b : nx.a; parts.push(`next R${nx.round} ${ROUNDS[nx.round - 1].start} vs ${opp}`); }
  return parts.join(' · ');
}

function renderBoard(P, H, ST) {
  const u = me(), hourAgo = Date.now() - 3600e3;
  const order = [...IDS].sort((a, b) => (isOut(a) - isOut(b)) || P[b] - P[a] || IDS.indexOf(a) - IDS.indexOf(b));
  $('#board').replaceChildren(...order.map(id => {
    const t = TEAM[id], p = P[id], out = isOut(id), champ = id === S.tour.champion;
    const ser = H.series[id];
    let base = ser[0][1]; for (const pt of ser) if (pt[0] <= hourAgo) base = pt[1];
    const ch = (p - base) * 100;
    const held = u ? (+(u.shares || {})[id] || 0) : 0;
    const canBuy = !out && !champ && S.tour.status === 'open';
    return h('div', {
        class: 'row' + (id === S.sel ? ' sel' : '') + (out ? ' out' : '') + (champ ? ' champ' : ''),
        role: 'button', tabindex: '0', 'aria-label': `${id} ${t.name}, price ${f1(p * 100)}`,
        onclick: () => select(id), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } } },
      h('span', { class: 'code', text: id }),
      h('div', { class: 'team' },
        h('div', { class: 'nm' }, t.name, out ? h('span', { class: 'tag', text: 'Out' }) : null, champ ? h('span', { class: 'tag', text: 'Champion' }) : null),
        h('div', { class: 'rec num', text: recordLine(id, ST) })),
      h('div', { class: 'spark' }, spark(ser)),
      h('div', { class: 'r' }, h('span', { class: 'price' }, f1(p * 100), h('small', { text: 'cr' })),
        Math.abs(ch) >= 0.05 ? h('span', { class: 'chg ' + (ch > 0 ? 'up' : 'down'), text: (ch > 0 ? '▲' : '▼') + f1(Math.abs(ch)) + ' 1h' }) : h('span', { class: 'chg muted', text: '—' })),
      h('div', { class: 'r hold', text: held > 0.0005 ? f1(held) + ' sh' : '—' }),
      h('div', { class: 'act' }, canBuy ? h('button', { class: 'buybtn', type: 'button', text: 'Buy', onclick: e => { e.stopPropagation(); select(id, 'buy'); $('#tk-amt').focus(); } }) : null));
  }));
}

function tradeBlock() {
  const u = me();
  if (!S.loaded) return 'Connecting…';
  if (!u) return S.tour.status === 'settled' ? 'The market is settled.' : 'Enter your name at the top to get 100 credits.';
  if (S.tour.status === 'settled') return 'The market is settled.';
  if (S.tour.status === 'paused') return 'The organizer has paused trading.';
  if (isOut(S.sel)) return `${S.sel} is knocked out. Its shares pay nothing.`;
  return '';
}
function quote(P) {
  const id = S.sel, b = S.tour.b, p = P[id];
  const u = me(), held = u ? (+(u.shares || {})[id] || 0) : 0;
  const amt = Math.max(0, parseFloat($('#tk-amt').value) || 0);
  if (S.mode === 'buy') {
    const n = amt > 0 && p > 0 ? M.sharesFor(amt, p, b) : 0;
    return { p, n, amt, held, avg: n > 0 ? amt / n : p * PAYOUT, after: n > 0 ? M.after(n, p, b) : p };
  }
  const n = Math.min(amt, held);
  const got = n > 0 && p > 0 ? M.proceeds(n, p, b) : 0;
  return { p, n, amt, held, got, avg: n > 0 ? got / n : p * PAYOUT, after: n > 0 ? M.after(-n, p, b) : p };
}
function renderTicket(P = prices()) {
  const id = S.sel, u = me();
  $('#tk-code').textContent = id; $('#tk-name').textContent = TEAM[id].name;
  $('#tk-price').textContent = `${f1(P[id] * 100)} credits a share · ${f1(P[id] * 100)}% chance`;
  $('#mode-buy').setAttribute('aria-pressed', S.mode === 'buy'); $('#mode-sell').setAttribute('aria-pressed', S.mode === 'sell');
  $('#tk-label').textContent = S.mode === 'buy' ? 'Spend (credits)' : 'Sell (shares)';
  const q = quote(P);
  const quick = S.mode === 'buy'
    ? [5, 10, 25].map(v => ['+' + v, () => setAmt((parseFloat($('#tk-amt').value) || 0) + v)])
    : [['25%', 0.25], ['50%', 0.5], ['All', 1]].map(([l, f]) => [l, () => setAmt(r6(q.held * f))]);
  $('#tk-quick').replaceChildren(...quick.map(([l, fn]) => h('button', { type: 'button', onclick: fn, text: l })));
  const rows = S.mode === 'buy'
    ? [['Shares you get', f1(q.n), true], ['Average price', f1(q.avg) + ' cr'], ['Price after', f1(q.after * 100) + ' cr'], ['Pays if they win', f0(q.n * PAYOUT) + ' cr', true]]
    : [['You receive', f1(q.got) + ' cr', true], ['Average price', f1(q.avg) + ' cr'], ['Price after', f1(q.after * 100) + ' cr']];
  $('#tk-quote').replaceChildren(...rows.flatMap(([k, v, big]) => [h('dt', { text: k }), h('dd', { class: big ? 'big' : null, text: v })]));
  const block = tradeBlock();
  let err = '';
  if (!block && S.mode === 'buy' && q.amt > (u.cash || 0) + 1e-9) err = `You have ${f1(u.cash || 0)} credits.`;
  if (!block && S.mode === 'sell' && q.amt > q.held + 1e-9) err = `You hold ${f1(q.held)} shares of ${id}.`;
  const msg = $('#tk-msg'); msg.textContent = block || err; msg.className = 'note' + (block || err ? ' err' : '');
  const go = $('#tk-go');
  go.textContent = S.busy ? 'Placing…' : `${S.mode === 'buy' ? 'Buy' : 'Sell'} ${id} shares`;
  go.disabled = !!(block || err || S.busy || !(q.n > 0));
  $('#tk-max').disabled = !!block;
  $('#tk-hold').textContent = u
    ? (q.held > 0.0005 ? `You own ${f1(q.held)} shares of ${id}: worth ${f1(q.held * P[id] * PAYOUT)} cr now, ${f0(q.held * PAYOUT)} cr if they win.` : `You don't own any ${id} shares yet.`)
    : '';
}
function setAmt(v) { $('#tk-amt').value = v > 0 ? String(r6(v)) : ''; renderTicket(); }
function select(id, mode) {
  S.sel = id; if (mode) S.mode = mode;
  render();
  if (matchMedia('(max-width:900px)').matches)
    document.querySelector('.ticket').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function renderLeaders(P) {
  const list = S.users.map(u => ({ u, v: worth(u, P) })).sort((a, b) => b.v - a.v);
  const ol = $('#leaders');
  if (!list.length) { ol.replaceChildren(h('li', { class: 'empty', text: 'No one has joined yet. Enter your name to take the top spot.' })); return; }
  const mine = S.session && S.session.id;
  ol.replaceChildren(...list.map(({ u, v }, i) => {
    const d = v - START;
    return h('li', { class: u.id === mine ? 'me' : null },
      h('span', { class: 'rk', text: i + 1 }),
      h('span', { class: 'who', text: u.name + (u.id === mine ? ' (you)' : '') }),
      h('span', { class: 'v' }, f1(v), h('span', { class: d >= 0 ? 'up' : 'down', style: 'display:block;font-size:.74rem', text: (d >= 0 ? '+' : '−') + f1(Math.abs(d)) })));
  }));
}

function renderLadder(P, ST) {
  const heads = ['Start', 'After game 1', 'After game 2', 'Final record'];
  const leader = rankTeams(ST)[0];
  const cols = [];
  for (let g = 0; g <= GAMES_PER_TEAM; g++) {
    const cells = [];
    for (let w = g; w >= 0; w--) {
      const ids = rankTeams(ST, IDS.filter(i => ST[i].played === g && ST[i].w === w));
      const cls = 'lcell' + (g === GAMES_PER_TEAM && w === g && ids.length ? ' perfect' : (ids.includes(leader) && g > 0 ? ' top' : ''));
      cells.push(h('div', { class: cls },
        h('div', { class: 'lcell-rec' }, g ? `${w}–${g - w}` : '0–0', h('span', { text: ids.length ? `${ids.length} team${ids.length > 1 ? 's' : ''}` : '' })),
        ids.length ? ids.map(id => h('button', { type: 'button', class: 'tchip' + (isOut(id) ? ' out' : ''), title: `${TEAM[id].name}: ${recordLine(id, ST)}`, onclick: () => select(id) },
          h('b', { text: id }), h('span', { class: 'n', text: TEAM[id].name }), h('span', { class: 'p', text: f1(P[id] * 100) })))
          : h('div', { class: 'lempty', text: '—' })));
    }
    cols.push(h('div', { class: 'lcol' }, h('div', { class: 'lcol-head', text: heads[g] }), cells));
  }
  $('#ladder').replaceChildren(...cols);
}

function renderSchedule() {
  const now = currentRound();
  const done = Object.keys(S.tour.results).length;
  $('#s-count').textContent = `${done} of ${SCHEDULE.length} played`;
  const admin = !!S.adminKey;
  $('#schedule').replaceChildren(...ROUNDS.map(r => {
    const ms = SCHEDULE.filter(m => m.round === r.n);
    const allDone = ms.every(m => S.tour.results[m.id]);
    return h('div', { class: 'round' + (r.n === now ? ' now' : '') },
      h('div', { class: 'round-head' }, h('span', { text: `Round ${r.n}${r.n === now ? ' · up now' : ''}` }), h('span', { text: `${r.start}–${r.end}${allDone ? ' · done' : ''}` })),
      ms.map(m => {
        const res = S.tour.results[m.id];
        const scored = res && Number.isFinite(res.sa) && Number.isFinite(res.sb);
        const side = (id, cls) => h('div', { class: `side ${cls}` + (res ? (res.w === id ? ' w' : ' l') : '') }, cls === 'b' ? `${TEAM[id].name} · ${id}` : `${id} · ${TEAM[id].name}`);
        return h('div', { class: 'match' },
          h('span', { class: 'ct', text: `Ct ${m.court}` }),
          side(m.a, 'a'),
          h('span', { class: 'sc' + (res ? '' : ' pending'), text: res ? (scored ? `${res.sa}–${res.sb}` : (res.w === m.a ? 'W–L' : 'L–W')) : 'vs' }),
          side(m.b, 'b'),
          admin ? h('button', { type: 'button', class: 'scorebtn', text: res ? 'Edit' : 'Score', onclick: () => openScore(m.id) }) : h('span'));
      }));
  }));
}

function renderFeed(H) {
  const names = Object.fromEntries(S.users.map(u => [u.id, u.name]));
  const items = H.ev.filter(e => !e.elim).slice(-25).reverse();
  const ul = $('#feed');
  if (!items.length) { ul.replaceChildren(h('li', { class: 'empty', text: 'Bets show up here as people place them.' })); return; }
  ul.replaceChildren(...items.map(e => {
    const buy = e.n > 0;
    return h('li', null,
      h('div', null, h('b', { text: names[e.u] || 'Someone' }), buy ? ' bought ' : ' sold ',
        h('span', { class: 'num', text: f1(Math.abs(e.n)) }), ' ', h('b', { text: e.t }), ` (${TEAM[e.t].name}) ${buy ? 'for' : 'and got'} `,
        h('span', { class: 'num', text: f1(Math.abs(e.c)) + ' cr' })),
      h('span', { class: 'when', text: ago(e.ts) }));
  }));
}

/* ---------- organizer ---------- */
function renderAdmin(ST) {
  const on = !!S.adminKey, T = S.tour;
  $('#ad-unlock').hidden = on; $('#ad-body').hidden = !on;
  if (!on) { $('#scorepad').hidden = true; return; }
  $('#ad-open').disabled = T.status !== 'paused';
  $('#ad-pause').disabled = T.status !== 'open';
  $('#ad-elims').replaceChildren(...IDS.map(id => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id in T.eliminated), title: TEAM[id].name, text: id,
    onclick: () => adminDo({ action: 'eliminate', team: id, on: !(id in T.eliminated) }, id in T.eliminated ? `${id} is back in` : `${id} knocked out`) })));
  const champSel = $('#ad-champ');
  if (document.activeElement !== champSel) {
    const ranked = rankTeams(ST, activeIds(T));
    const cur = champSel.value;
    champSel.replaceChildren(...ranked.map((i, n) => h('option', { value: i, text: `${i} · ${TEAM[i].name} (${ST[i].w}–${ST[i].l}, ${pd(ST[i].pf - ST[i].pa)})${n === 0 ? ' · leader' : ''}` })));
    champSel.value = T.champion || (ranked.includes(cur) && S.settleArmed ? cur : ranked[0]);
  }
  champSel.disabled = !!T.champion;
  $('#ad-settle').hidden = !!T.champion; $('#ad-unsettle').hidden = !T.champion;
  $('#ad-settle').textContent = S.settleArmed ? `Confirm: ${champSel.value} wins` : 'Settle market';
  $('#ad-settle-msg').textContent = T.champion ? `Settled. Each ${T.champion} share paid ${PAYOUT} credits.` : (S.settleArmed ? 'Click again to pay out. Trading closes.' : 'Defaults to the standings leader. Pick another team if a playoff decides it.');
  const bIn = $('#ad-b-param'); if (document.activeElement !== bIn) bIn.value = T.b;
  const locked = S.trades.length > 0; bIn.disabled = locked; $('#ad-b-save').disabled = locked;
}
async function adminDo(body, okMsg) {
  try {
    const d = await api('/api/admin', body, adminHeader());
    if (d.tour) S.tour = normTour(d.tour);
    if (okMsg) toast(okMsg);
    render(); return true;
  } catch (e) {
    if (e.status === 401) { S.adminKey = null; save('powerball.admin', null); render(); }
    toast(e.message); return false;
  }
}
function openScore(matchId) {
  const m = MATCH[matchId], res = S.tour.results[matchId];
  S.scoreMatch = matchId;
  $('#sp-label').textContent = `Round ${m.round}, Court ${m.court}: ${m.a} vs ${m.b}`;
  $('#sp-a').textContent = `${m.a} · ${TEAM[m.a].name}`;
  $('#sp-b').textContent = `${m.b} · ${TEAM[m.b].name}`;
  $('#sp-sa').value = res && Number.isFinite(res.sa) ? res.sa : '';
  $('#sp-sb').value = res && Number.isFinite(res.sb) ? res.sb : '';
  $('#sp-w').replaceChildren(h('option', { value: '', text: 'Pick the winner' }), h('option', { value: m.a, text: `${m.a} · ${TEAM[m.a].name}` }), h('option', { value: m.b, text: `${m.b} · ${TEAM[m.b].name}` }));
  $('#sp-w').value = res ? res.w : '';
  $('#sp-clear').hidden = !res; $('#sp-msg').textContent = '';
  $('#scorepad').hidden = false;
  $('#scorepad').scrollIntoView({ block: 'nearest' });
  $('#sp-sa').focus();
}
function syncWinner() {
  const m = MATCH[S.scoreMatch]; if (!m) return;
  const sa = parseInt($('#sp-sa').value), sb = parseInt($('#sp-sb').value);
  if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) $('#sp-w').value = sa > sb ? m.a : m.b;
}
async function saveScore() {
  const m = MATCH[S.scoreMatch]; if (!m) return;
  const w = $('#sp-w').value, sa = $('#sp-sa').value.trim(), sb = $('#sp-sb').value.trim();
  const msg = $('#sp-msg');
  if (!w) { msg.textContent = 'Enter the score or pick a winner.'; return; }
  if ((sa === '') !== (sb === '')) { msg.textContent = 'Enter both scores, or neither.'; return; }
  if (await adminDo({ action: 'result', match: m.id, w, sa, sb }, `Saved: ${w} beat ${w === m.a ? m.b : m.a}`)) { $('#scorepad').hidden = true; S.scoreMatch = null; }
}

/* ---------- actions ---------- */
async function join(e) {
  e.preventDefault();
  const name = $('#j-name').value.trim(), msg = $('#j-msg');
  if (name.length < 2) { msg.textContent = 'Enter at least 2 characters.'; return; }
  $('#j-go').disabled = true; msg.textContent = '';
  try {
    const d = await api('/api/join', { name, code: $('#j-code').value });
    S.session = { token: d.token, id: d.user.id };
    save('powerball.session', S.session);
    const i = S.users.findIndex(u => u.id === d.user.id);
    if (i >= 0) S.users[i] = d.user; else S.users.push(d.user);
    toast(d.created ? `Welcome, ${d.user.name}. You have 100 credits.` : `Welcome back, ${d.user.name}.`);
    render();
  } catch (err) { msg.textContent = err.message; }
  finally { $('#j-go').disabled = false; }
}
async function doTrade() {
  if (tradeBlock() || S.busy) return;
  const q = quote(prices()); if (!(q.n > 0)) return;
  const id = S.sel, side = S.mode;
  const amount = side === 'buy' ? q.amt : (q.amt >= q.held - 1e-6 ? q.held : q.n);
  S.busy = true; renderTicket();
  try {
    const d = await api('/api/trade', { side, team: id, amount }, authHeader());
    const i = S.users.findIndex(u => u.id === d.user.id); if (i >= 0) S.users[i] = d.user;
    S.trades.push(d.trade);
    const t = d.trade;
    toast(t.n > 0 ? `Bought ${f1(t.n)} ${id} shares for ${f1(t.c)} cr` : `Sold ${f1(-t.n)} ${id} shares for ${f1(-t.c)} cr`);
    $('#tk-amt').value = '';
  } catch (e) {
    if (e.status === 401) { S.session = null; save('powerball.session', null); }
    toast(e.message);
  } finally { S.busy = false; render(); refresh(); }
}

async function refresh() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad status');
    const d = await r.json();
    S.tour = normTour(d.tour); S.users = d.users || []; S.trades = d.trades || [];
    S.storage = d.storage; S.needsCode = !!d.needsCode; S.loaded = true; S.offline = false;
  } catch { S.offline = true; }
  if (!S.busy) render();
}

/* ---------- wiring ---------- */
$('#joinform').addEventListener('submit', join);
$('#signout').onclick = () => { S.session = null; save('powerball.session', null); render(); $('#j-name').focus(); };
$('#mode-buy').onclick = () => { S.mode = 'buy'; $('#tk-amt').value = ''; renderTicket(); };
$('#mode-sell').onclick = () => { S.mode = 'sell'; $('#tk-amt').value = ''; renderTicket(); };
$('#tk-amt').addEventListener('input', () => renderTicket());
$('#tk-max').onclick = () => { const u = me(); if (!u) return; setAmt(S.mode === 'buy' ? Math.floor((u.cash || 0) * 1e4) / 1e4 : +(u.shares || {})[S.sel] || 0); };
$('#tk-go').onclick = doTrade;
$('#ad-unlock').addEventListener('submit', async e => {
  e.preventDefault();
  const key = $('#ad-key').value; if (!key) return;
  try { await api('/api/admin', { action: 'check' }, { 'x-admin-key': key }); S.adminKey = key; save('powerball.admin', key); $('#ad-key').value = ''; $('#ad-unlock-msg').textContent = ''; render(); toast('Organizer desk unlocked'); }
  catch (err) { $('#ad-unlock-msg').textContent = err.message; }
});
$('#ad-lock').onclick = () => { S.adminKey = null; save('powerball.admin', null); render(); };
$('#ad-open').onclick = () => adminDo({ action: 'status', status: 'open' }, 'Trading open');
$('#ad-pause').onclick = () => adminDo({ action: 'status', status: 'paused' }, 'Trading paused');
$('#ad-champ').addEventListener('change', () => { S.settleArmed = false; render(); });
$('#ad-settle').onclick = () => {
  if (!S.settleArmed) { S.settleArmed = true; render(); setTimeout(() => { S.settleArmed = false; render(); }, 6000); return; }
  S.settleArmed = false;
  const c = $('#ad-champ').value;
  adminDo({ action: 'settle', team: c }, `${c} crowned champion. Market settled.`);
};
$('#ad-unsettle').onclick = () => adminDo({ action: 'unsettle' }, 'Settlement undone. Trading is paused.');
$('#ad-b-save').onclick = () => adminDo({ action: 'setB', b: +$('#ad-b-param').value }, 'Liquidity saved');
$('#sp-sa').addEventListener('input', syncWinner);
$('#sp-sb').addEventListener('input', syncWinner);
$('#sp-save').onclick = saveScore;
$('#sp-clear').onclick = async () => { if (await adminDo({ action: 'clear', match: S.scoreMatch }, 'Result cleared')) $('#scorepad').hidden = true; };
$('#sp-close').onclick = () => { $('#scorepad').hidden = true; S.scoreMatch = null; };

render();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
