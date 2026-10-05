import crypto from 'node:crypto';
import { store, K } from './store.js';
import { normTour } from '../public/shared.js';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

const parse = s => { if (s == null) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return null; } };

export async function loadAll() {
  const [tourRaw, usersRaw, tradesRaw] = await Promise.all([
    store.get(K.tour), store.hgetall(K.users), store.lrange(K.trades, 0, -1),
  ]);
  const users = Object.values(usersRaw || {}).map(parse).filter(Boolean);
  const trades = (tradesRaw || []).map(parse).filter(Boolean);
  return { tour: normTour(parse(tourRaw)), users, trades };
}
export const saveTour = tour => store.set(K.tour, JSON.stringify(tour));
export const saveUser = user => store.hset(K.users, { [user.id]: JSON.stringify(user) });

// One writer at a time, so two bets can't both use the same price.
export async function withLock(fn) {
  const me = crypto.randomUUID();
  for (let i = 0; i < 60; i++) {
    if (await store.set(K.lock, me, { nx: true, px: 8000 })) {
      try { return await fn(); }
      finally { if ((await store.get(K.lock)) === me) await store.del(K.lock); }
    }
    await new Promise(r => setTimeout(r, 60 + Math.random() * 90));
  }
  const e = new Error('The market is busy. Try again.'); e.status = 503; throw e;
}

// Sessions: a signed user id. Not a password system; names are the login.
const secret = () => process.env.SESSION_SECRET || 'dev-only-secret';
const sign = id => crypto.createHmac('sha256', secret()).update(id).digest('base64url');
export const makeToken = id => `${id}.${sign(id)}`;
export function userIdFrom(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [id, sig] = tok.split('.');
  if (!id || !sig) return null;
  const good = Buffer.from(sign(id)), got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got) ? id : null;
}

export function isAdmin(req) {
  const want = process.env.ADMIN_KEY || (process.env.VERCEL ? '' : 'admin');
  const got = String(req.headers['x-admin-key'] || '');
  if (!want || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest(), b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

export const r6 = x => Math.round(x * 1e6) / 1e6;
export const publicUser = u => ({ id: u.id, name: u.name, cash: u.cash, shares: u.shares || {} });

export function fail(res, e) {
  send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server. Try again.' });
  if (!e.status) console.error(e);
}
export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
