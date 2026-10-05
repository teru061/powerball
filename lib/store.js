// Storage: Upstash Redis when its env vars are set (Vercel adds them when you
// connect the database), otherwise an in-memory store for local testing.
import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const usingMemory = !(url && token);

function memoryStore() {
  const g = globalThis.__powerballMem || (globalThis.__powerballMem = { kv: new Map(), exp: new Map() });
  const alive = k => {
    const e = g.exp.get(k);
    if (e && e < Date.now()) { g.kv.delete(k); g.exp.delete(k); }
    return g.kv.has(k);
  };
  return {
    async get(k) { return alive(k) ? g.kv.get(k) : null; },
    async set(k, v, o = {}) {
      if (o.nx && alive(k)) return null;
      g.kv.set(k, String(v));
      if (o.px) g.exp.set(k, Date.now() + o.px); else g.exp.delete(k);
      return 'OK';
    },
    async del(k) { g.kv.delete(k); g.exp.delete(k); return 1; },
    async hgetall(k) { const h = g.kv.get(k); return h && h.size ? Object.fromEntries(h) : null; },
    async hget(k, f) { const h = g.kv.get(k); return h && h.has(f) ? h.get(f) : null; },
    async hset(k, obj) {
      let h = g.kv.get(k); if (!(h instanceof Map)) { h = new Map(); g.kv.set(k, h); }
      for (const [f, v] of Object.entries(obj)) h.set(f, String(v));
      return 1;
    },
    async rpush(k, v) { let l = g.kv.get(k); if (!Array.isArray(l)) { l = []; g.kv.set(k, l); } l.push(String(v)); return l.length; },
    async lrange(k, a, b) { const l = g.kv.get(k); if (!Array.isArray(l)) return []; return l.slice(a, b === -1 ? undefined : b + 1); },
  };
}

function redisStore() {
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: k => r.get(k),
    set: (k, v, o = {}) => r.set(k, v, o),
    del: k => r.del(k),
    hgetall: k => r.hgetall(k),
    hget: (k, f) => r.hget(k, f),
    hset: (k, obj) => r.hset(k, obj),
    rpush: (k, v) => r.rpush(k, v),
    lrange: (k, a, b) => r.lrange(k, a, b),
  };
}

export const store = usingMemory ? memoryStore() : redisStore();

export const K = {
  tour: 'pb:tour',      // JSON: status, b, results, eliminated, champion
  users: 'pb:users',    // hash: userId -> JSON {id, name, cash, shares, joinedAt}
  names: 'pb:names',    // hash: lowercased name -> userId
  trades: 'pb:trades',  // list of JSON {u, t, n, c, ts}
  lock: 'pb:lock',
};
