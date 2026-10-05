// Shared by the browser (public/app.js) and the API (api/*.js).
// Teams, schedule and market math live here so both sides agree.

export const PAYOUT = 100;     // credits a winning share pays
export const START = 100;      // credits each person starts with
export const DEFAULT_B = 25;   // LMSR liquidity: higher = prices move less per bet

export const TEAMS = [
  { id: 'T1',  name: 'David & Aspen' },
  { id: 'T2',  name: 'Emilio & Matt' },
  { id: 'T3',  name: 'Jon & Kevin Short' },
  { id: 'T4',  name: 'Ben S & Jessica' },
  { id: 'T5',  name: 'Vandana & Nick' },
  { id: 'T6',  name: 'Ed & Skye' },
  { id: 'T7',  name: 'Morgan Porteous & Benjamin LeRoy' },
  { id: 'T8',  name: 'Kathleen & Brandon' },
  { id: 'T9',  name: 'Mary & Charlie' },
  { id: 'T10', name: 'Vana & Shamus' },
  { id: 'T12', name: 'Aleksandra & Arnav' },
  { id: 'T13', name: 'Steven & Chris' },
  { id: 'T14', name: 'Savannah & Jordan' },
  { id: 'T15', name: 'Yash & T Hephner' },
];
export const IDS = TEAMS.map(t => t.id);
export const TEAM = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// Round start/end times (8-minute games, 2-minute changeovers)
export const ROUNDS = [
  ['9:45', '9:53'], ['9:55', '10:03'], ['10:05', '10:13'], ['10:15', '10:23'],
  ['10:25', '10:33'], ['10:35', '10:43'], ['10:45', '10:53'], ['10:55', '11:03'],
  ['11:05', '11:13'], ['11:15', '11:23'], ['11:25', '11:33'],
].map(([start, end], i) => ({ n: i + 1, start, end }));

// [round, court, teamA, teamB] from pickleball_draw_v2_final "Team Schedules"
export const SCHEDULE = [
  [1, 1, 'T5', 'T12'],  [1, 2, 'T3', 'T8'],
  [2, 1, 'T9', 'T14'],  [2, 2, 'T1', 'T13'],
  [3, 1, 'T2', 'T4'],   [3, 2, 'T7', 'T15'],
  [4, 1, 'T6', 'T10'],  [4, 2, 'T3', 'T5'],
  [5, 1, 'T12', 'T13'], [5, 2, 'T1', 'T8'],
  [6, 1, 'T7', 'T14'],  [6, 2, 'T2', 'T9'],
  [7, 1, 'T10', 'T15'], [7, 2, 'T4', 'T6'],
  [8, 1, 'T3', 'T12'],  [8, 2, 'T5', 'T8'],
  [9, 1, 'T13', 'T14'], [9, 2, 'T1', 'T7'],
  [10, 1, 'T6', 'T9'],  [10, 2, 'T2', 'T15'],
  [11, 1, 'T4', 'T10'],
].map(([round, court, a, b]) => ({ id: `R${round}C${court}`, round, court, a, b }));
export const MATCH = Object.fromEntries(SCHEDULE.map(m => [m.id, m]));
export const GAMES_PER_TEAM = 3;

export function normTour(d) {
  d = d || {};
  const results = {};
  for (const [k, r] of Object.entries(d.results || {})) {
    const m = MATCH[k];
    if (m && r && (r.w === m.a || r.w === m.b)) results[k] = r;
  }
  return {
    status: ['open', 'paused', 'settled'].includes(d.status) ? d.status : 'open',
    b: +d.b > 0 ? +d.b : DEFAULT_B,
    results,
    eliminated: d.eliminated && typeof d.eliminated === 'object' ? d.eliminated : {},
    champion: IDS.includes(d.champion) ? d.champion : null,
  };
}

export function activeIds(tour) {
  return tour.champion ? [tour.champion] : IDS.filter(i => !(i in tour.eliminated));
}

export function qFromUsers(users) {
  const q = Object.fromEntries(IDS.map(i => [i, 0]));
  for (const u of users) for (const [k, v] of Object.entries(u.shares || {})) if (k in q) q[k] += (+v || 0);
  return q;
}

export function priceMap(q, act, b) {
  const p = Object.fromEntries(IDS.map(i => [i, 0]));
  if (!act.length) return p;
  const m = Math.max(...act.map(i => q[i] / b));
  let Z = 0; const e = {};
  for (const i of act) { e[i] = Math.exp(q[i] / b - m); Z += e[i]; }
  for (const i of act) p[i] = e[i] / Z;
  return p;
}

// LMSR, expressed with p = the team's current probability. Costs are in credits.
export const M = {
  sharesFor: (spend, p, b) => b * Math.log(1 + Math.expm1(spend / (PAYOUT * b)) / p),
  proceeds: (n, p, b) => -PAYOUT * b * Math.log(1 - p + p * Math.exp(-n / b)),
  after: (n, p, b) => { const e = p * Math.exp(n / b); return e / (1 - p + e); },
};

export function worth(user, prices) {
  let v = +user.cash || 0;
  for (const [k, n] of Object.entries(user.shares || {})) v += (+n || 0) * (prices[k] || 0) * PAYOUT;
  return v;
}

export function standings(results) {
  const s = Object.fromEntries(IDS.map(i => [i, { w: 0, l: 0, pf: 0, pa: 0, played: 0, form: [] }]));
  for (const m of SCHEDULE) {
    const r = results[m.id];
    if (!r) continue;
    const L = r.w === m.a ? m.b : m.a;
    s[r.w].w++; s[L].l++; s[m.a].played++; s[m.b].played++;
    s[r.w].form.push('W'); s[L].form.push('L');
    if (Number.isFinite(r.sa) && Number.isFinite(r.sb)) {
      s[m.a].pf += r.sa; s[m.a].pa += r.sb; s[m.b].pf += r.sb; s[m.b].pa += r.sa;
    }
  }
  return s;
}

// Wins, then point difference, then points scored
export function rankTeams(st, ids = IDS) {
  return [...ids].sort((a, b) =>
    st[b].w - st[a].w ||
    (st[b].pf - st[b].pa) - (st[a].pf - st[a].pa) ||
    st[b].pf - st[a].pf ||
    IDS.indexOf(a) - IDS.indexOf(b));
}

export function nextMatch(team, results) {
  return SCHEDULE.find(m => (m.a === team || m.b === team) && !results[m.id]) || null;
}
