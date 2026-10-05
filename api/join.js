import crypto from 'node:crypto';
import { send, readBody, withLock, loadAll, saveUser, makeToken, publicUser, fail, httpError } from '../lib/core.js';
import { store, K } from '../lib/store.js';
import { START } from '../public/shared.js';

// Join with a name. If the name already exists, this signs you back in as that person.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const body = await readBody(req);
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 24) throw httpError(400, 'Use a name between 2 and 24 characters.');
    const key = name.toLowerCase();
    const out = await withLock(async () => {
      const existing = await store.hget(K.names, key);
      if (existing) {
        const { users } = await loadAll();
        const u = users.find(x => x.id === existing);
        if (u) return { user: u, created: false };
      }
      const code = process.env.EVENT_CODE;
      if (code && String(body.code || '').trim().toLowerCase() !== code.trim().toLowerCase())
        throw httpError(403, "That event code isn't right. Ask the organizer for it.");
      const { tour } = await loadAll();
      if (tour.status === 'settled') throw httpError(403, 'The market is settled. Joining has closed.');
      const user = { id: 'u' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), name, cash: START, shares: {}, joinedAt: Date.now() };
      await saveUser(user);
      await store.hset(K.names, { [key]: user.id });
      return { user, created: true };
    });
    send(res, 200, { token: makeToken(out.user.id), user: publicUser(out.user), created: out.created });
  } catch (e) { fail(res, e); }
}
