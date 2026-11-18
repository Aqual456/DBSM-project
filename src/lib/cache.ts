import { createClient } from "redis";
import { logger } from "./logger";

/**
 * Key-value adapter. Uses Redis when REDIS_URL is configured and reachable,
 * otherwise an in-process Map with TTLs. Redis is never required for core
 * functionality: every caller works with either backend.
 */
export type CacheKind = "redis" | "memory";
type RedisClient = ReturnType<typeof createClient>;

const memory = new Map<string, { value: string; expires: number }>();
const stats = { hits: 0, misses: 0, sets: 0, invalidations: 0 };

declare global {
  var rfRedis: { client?: RedisClient; failedAt?: number; connecting?: Promise<RedisClient | undefined> } | undefined;
}
const state = (global.rfRedis ??= {});

async function redis(): Promise<RedisClient | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (state.client?.isReady) return state.client;
  if (state.failedAt && Date.now() - state.failedAt < 15000) return undefined; // back off after failure
  state.connecting ??= (async () => {
    try {
      const client = createClient({ url, socket: { connectTimeout: 1500, reconnectStrategy: false } });
      client.on("error", (e) => {
        logger.warn("redis error", { code: (e as { code?: string }).code });
        state.failedAt = Date.now();
      });
      await client.connect();
      state.client = client;
      state.failedAt = undefined;
      return client;
    } catch (e) {
      state.failedAt = Date.now();
      logger.warn("redis unavailable; using in-memory cache", { code: (e as { code?: string }).code });
      return undefined;
    } finally {
      state.connecting = undefined;
    }
  })();
  return state.connecting;
}

export async function cacheKind(): Promise<CacheKind> {
  return (await redis()) ? "redis" : "memory";
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = await redis();
  let v: string | null = null;
  if (r) {
    try { v = await r.get(key); } catch { v = null; }
  } else {
    const m = memory.get(key);
    if (m && m.expires > Date.now()) v = m.value;
    else if (m) memory.delete(key);
  }
  if (v === null) stats.misses++; else stats.hits++;
  return v;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  stats.sets++;
  const r = await redis();
  if (r) {
    try { await r.set(key, value, { EX: ttlSeconds }); return; } catch { /* fall through */ }
  }
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Delete every key with the given prefix (SCAN-based for Redis; never KEYS in hot paths). */
export async function cacheInvalidate(prefix: string) {
  stats.invalidations++;
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  const r = await redis();
  if (!r) return;
  try {
    const keys: string[] = [];
    for await (const batch of r.scanIterator({ MATCH: prefix + "*", COUNT: 100 })) keys.push(...(Array.isArray(batch) ? batch : [batch]));
    if (keys.length) await r.del(keys);
  } catch (e) {
    logger.warn("cache invalidation failed", { code: (e as { code?: string }).code });
  }
}

/** Read-through cache helper. Returns the value and whether it came from cache. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hit = await cacheGet(key);
  if (hit !== null) return { value: JSON.parse(hit) as T, hit: true };
  const value = await load();
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
  return { value, hit: false };
}

/** Fixed-window rate limiter (INCR + EXPIRE). Returns remaining allowance. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await redis();
  let count: number;
  if (r) {
    try {
      count = await r.incr(key);
      if (count === 1) await r.expire(key, windowSeconds);
    } catch {
      count = 0;
    }
  } else {
    const m = memory.get(key);
    count = m && m.expires > Date.now() ? Number(m.value) + 1 : 1;
    memory.set(key, { value: String(count), expires: m && m.expires > Date.now() ? m.expires : Date.now() + windowSeconds * 1000 });
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

/** Introspection for the key-value lab page. */
export async function cacheInspect(prefix = "rf:") {
  const r = await redis();
  const keys: { key: string; ttl: number; bytes: number; type: string }[] = [];
  let info: Record<string, string> = {};
  if (r) {
    for await (const batch of r.scanIterator({ MATCH: prefix + "*", COUNT: 100 })) {
      for (const key of Array.isArray(batch) ? batch : [batch]) {
        if (keys.length >= 50) break;
        const [ttl, type, len] = await Promise.all([r.ttl(key), r.type(key), r.strLen(key).catch(() => 0)]);
        keys.push({ key, ttl, type, bytes: Number(len) });
      }
    }
    const raw = await r.info("server");
    info = Object.fromEntries(
      raw.split(/\r?\n/).filter((l) => /^(redis_version|uptime_in_seconds|tcp_port):/.test(l)).map((l) => l.split(":") as [string, string]),
    );
    const mem = await r.info("memory");
    const used = mem.split(/\r?\n/).find((l) => l.startsWith("used_memory_human:"));
    if (used) info.used_memory_human = used.split(":")[1];
    info.dbsize = String(await r.dbSize());
  } else {
    for (const [key, m] of memory) {
      if (!key.startsWith(prefix) || m.expires <= Date.now()) continue;
      keys.push({ key, ttl: Math.round((m.expires - Date.now()) / 1000), type: "string", bytes: m.value.length });
    }
  }
  return { kind: r ? "redis" : "memory", configured: Boolean(process.env.REDIS_URL), stats: { ...stats }, keys, info };
}

export async function cachePing(): Promise<{ configured: boolean; ok: boolean; latencyMs?: number }> {
  if (!process.env.REDIS_URL) return { configured: false, ok: false };
  const r = await redis();
  if (!r) return { configured: true, ok: false };
  const t = performance.now();
  try {
    await r.ping();
    return { configured: true, ok: true, latencyMs: +(performance.now() - t).toFixed(2) };
  } catch {
    return { configured: true, ok: false };
  }
}
