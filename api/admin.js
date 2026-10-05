import { send, readBody, withLock, loadAll, saveTour, isAdmin, fail, httpError } from '../lib/core.js';
import { IDS, MATCH } from '../public/shared.js';

// Organizer actions. Requires the x-admin-key header to match ADMIN_KEY.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    if (!isAdmin(req)) throw httpError(401, "That organizer password isn't right.");
    const b = await readBody(req);
    if (b.action === 'check') return send(res, 200, { ok: true });
    const tour = await withLock(async () => {
      const { tour, trades } = await loadAll();
      switch (b.action) {
        case 'result': {
          const m = MATCH[b.match]; if (!m) throw httpError(400, 'Unknown match.');
          if (![m.a, m.b].includes(b.w)) throw httpError(400, 'Pick the winner.');
          const sa = b.sa === '' || b.sa == null ? null : Math.round(+b.sa);
          const sb = b.sb === '' || b.sb == null ? null : Math.round(+b.sb);
          if ((sa == null) !== (sb == null)) throw httpError(400, 'Enter both scores, or neither.');
          if (sa != null && (!(sa >= 0) || !(sb >= 0))) throw httpError(400, 'Scores must be 0 or more.');
          if (sa != null && sa !== sb && (sa > sb ? m.a : m.b) !== b.w) throw httpError(400, "The winner doesn't match the score.");
          tour.results[m.id] = sa == null ? { w: b.w, ts: Date.now() } : { w: b.w, sa, sb, ts: Date.now() };
          break;
        }
        case 'clear': delete tour.results[b.match]; break;
        case 'status':
          if (!['open', 'paused'].includes(b.status)) throw httpError(400, 'Unknown status.');
          if (tour.status === 'settled') throw httpError(409, 'Undo the settlement first.');
          tour.status = b.status; break;
        case 'eliminate':
          if (!IDS.includes(b.team)) throw httpError(400, 'Unknown team.');
          if (tour.champion) throw httpError(409, 'Undo the settlement first.');
          if (b.on) tour.eliminated[b.team] = Date.now(); else delete tour.eliminated[b.team];
          if (Object.keys(tour.eliminated).length >= IDS.length) throw httpError(400, 'At least one team has to stay in.');
          break;
        case 'settle':
          if (!IDS.includes(b.team)) throw httpError(400, 'Pick the champion.');
          tour.champion = b.team; tour.status = 'settled'; break;
        case 'unsettle': tour.champion = null; tour.status = 'paused'; break;
        case 'setB':
          if (trades.length) throw httpError(409, 'Liquidity is locked once the first bet is placed.');
          if (!(+b.b >= 5 && +b.b <= 200)) throw httpError(400, 'Use a value from 5 to 200.');
          tour.b = +b.b; break;
        default: throw httpError(400, 'Unknown action.');
      }
      await saveTour(tour);
      return tour;
    });
    send(res, 200, { ok: true, tour });
  } catch (e) { fail(res, e); }
}
