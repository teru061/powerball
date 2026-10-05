import { send, loadAll, publicUser, fail } from '../lib/core.js';
import { usingMemory } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
  try {
    const { tour, users, trades } = await loadAll();
    send(res, 200, {
      tour,
      users: users.map(publicUser),
      trades,
      storage: usingMemory ? 'memory' : 'redis',
      needsCode: !!process.env.EVENT_CODE,
      now: Date.now(),
    });
  } catch (e) { fail(res, e); }
}
