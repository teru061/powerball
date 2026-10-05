import { send, readBody, withLock, loadAll, saveUser, userIdFrom, publicUser, r6, fail, httpError } from '../lib/core.js';
import { store, K } from '../lib/store.js';
import { IDS, M, priceMap, qFromUsers, activeIds } from '../public/shared.js';

// body: { side: 'buy' | 'sell', team: 'T5', amount }
// buy amount = credits to spend; sell amount = shares to sell
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const id = userIdFrom(req);
    if (!id) throw httpError(401, 'Sign in again to place bets.');
    const body = await readBody(req);
    const { side, team } = body;
    const amount = +body.amount;
    if (!['buy', 'sell'].includes(side)) throw httpError(400, 'Choose buy or sell.');
    if (!IDS.includes(team)) throw httpError(400, 'Unknown team.');
    if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Enter an amount above 0.');

    const out = await withLock(async () => {
      const { tour, users } = await loadAll();
      const user = users.find(u => u.id === id);
      if (!user) throw httpError(401, 'Your account was not found. Join again.');
      if (tour.status === 'settled') throw httpError(409, 'The market is settled.');
      if (tour.status === 'paused') throw httpError(409, 'The organizer has paused trading.');
      if (team in tour.eliminated) throw httpError(409, `${team} is knocked out. Its shares pay nothing.`);
      const p = priceMap(qFromUsers(users), activeIds(tour), tour.b)[team];
      if (!(p > 0)) throw httpError(409, 'That team cannot be traded right now.');
      user.shares = user.shares || {};
      const held = +user.shares[team] || 0;
      let trade;
      if (side === 'buy') {
        if (amount < 0.1) throw httpError(400, 'The smallest bet is 0.1 credits.');
        if (amount > user.cash + 1e-9) throw httpError(400, `You have ${user.cash.toFixed(1)} credits.`);
        const n = M.sharesFor(amount, p, tour.b);
        user.cash = Math.max(0, r6(user.cash - amount));
        user.shares[team] = r6(held + n);
        trade = { u: id, t: team, n: r6(n), c: r6(amount), ts: Date.now() };
      } else {
        if (amount > held + 1e-6) throw httpError(400, `You hold ${held.toFixed(1)} shares of ${team}.`);
        const n = amount >= held - 1e-6 ? held : amount;
        const got = M.proceeds(n, p, tour.b);
        user.cash = r6(user.cash + got);
        const left = held - n;
        if (left < 1e-6) delete user.shares[team]; else user.shares[team] = r6(left);
        trade = { u: id, t: team, n: -r6(n), c: -r6(got), ts: Date.now() };
      }
      await saveUser(user);
      await store.rpush(K.trades, JSON.stringify(trade));
      return { user: publicUser(user), trade };
    });
    send(res, 200, out);
  } catch (e) { fail(res, e); }
}
