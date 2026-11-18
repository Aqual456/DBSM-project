import { z } from "zod";
import { endpoint, actor, allRoles, managers, body } from "@/lib/api";
import { cacheGet, cacheInspect, cacheInvalidate, cacheSet, cacheKind } from "@/lib/cache";
import { pool } from "@/lib/postgres";

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  return cacheInspect("rf:");
});

/**
 * Measured cache benchmark: the same aggregate query served from PostgreSQL and from the
 * key-value store. Numbers are measured on each run, never hard-coded.
 */
export const POST = endpoint(async (req) => {
  const b = z.strictObject({ action: z.enum(["benchmark", "invalidate"]) }).parse(await body(req));
  if (b.action === "invalidate") {
    await actor(req, managers);
    await cacheInvalidate("rf:cache:");
    return { invalidated: true };
  }
  await actor(req, allRoles);
  const key = "rf:cache:lab:benchmark";
  const sql = `SELECT r.resource_name, sum(i.quantity_available) AS available, count(*) AS lines
                 FROM inventory i JOIN resources r USING (resource_id) GROUP BY r.resource_name ORDER BY 2 DESC`;
  await cacheInvalidate(key);
  const runs: { source: string; ms: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await pool.query(sql);
    runs.push({ source: "postgres", ms: +(performance.now() - t).toFixed(3) });
  }
  const t0 = performance.now();
  const miss = await cacheGet(key);
  const rows = (await pool.query(sql)).rows;
  await cacheSet(key, JSON.stringify(rows), 60);
  const firstMs = +(performance.now() - t0).toFixed(3);
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    JSON.parse((await cacheGet(key)) ?? "[]");
    runs.push({ source: "cache", ms: +(performance.now() - t).toFixed(3) });
  }
  const avg = (s: string) => +(runs.filter((r) => r.source === s).reduce((a, r) => a + r.ms, 0) / 5).toFixed(3);
  return { backend: await cacheKind(), sql, ttlSeconds: 60, firstMiss: miss === null, readThroughMs: firstMs, runs, avgPostgresMs: avg("postgres"), avgCacheMs: avg("cache"), rows: rows.length };
});
