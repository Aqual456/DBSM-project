import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import assert from "node:assert/strict";
import { writeFileSync } from "fs";

/**
 * Live tests for the OPTIONAL services (Redis, Neo4j, pgvector) against the configured
 * development instances. Read-only for PostgreSQL/MongoDB; writes only to the derived
 * stores (cache keys, the Neo4j projection, the vector table). Skips a service that is
 * not configured and reports it as SKIPPED rather than PASS.
 */
const results: { test: string; status: string; detail?: string }[] = [];
async function check(name: string, enabled: boolean, fn: () => Promise<string | void>) {
  if (!enabled) {
    results.push({ test: name, status: "SKIPPED", detail: "service not configured" });
    console.log("SKIP", name);
    return;
  }
  const detail = (await fn()) ?? undefined;
  results.push({ test: name, status: "PASS", detail });
  console.log("PASS", name, detail ? `— ${detail}` : "");
}

async function main() {
  const cache = await import("../src/lib/cache");
  const graph = await import("../src/lib/graph");
  const vector = await import("../src/lib/vector");
  const { pool } = await import("../src/lib/postgres");

  await check("Redis: set/get with TTL, prefix invalidation, INCR rate limiting", Boolean(process.env.REDIS_URL), async () => {
    assert.equal(await cache.cacheKind(), "redis");
    await cache.cacheSet("rf:cache:test:a", "1", 30);
    await cache.cacheSet("rf:cache:test:b", "2", 30);
    assert.equal(await cache.cacheGet("rf:cache:test:a"), "1");
    const keys = (await cache.cacheInspect("rf:cache:test:")).keys;
    assert.ok(keys.every((k) => k.ttl > 0 && k.ttl <= 30));
    await cache.cacheInvalidate("rf:cache:test:");
    assert.equal(await cache.cacheGet("rf:cache:test:a"), null);
    const key = `rf:rl:test:${Date.now()}`;
    const r = [];
    for (let i = 0; i < 4; i++) r.push((await cache.rateLimit(key, 3, 30)).allowed);
    assert.deepEqual(r, [true, true, true, false]);
    const t = performance.now();
    await cache.cached("rf:cache:test:c", 10, async () => ({ x: 1 }));
    const second = await cache.cached("rf:cache:test:c", 10, async () => ({ x: 2 }));
    assert.equal(second.hit, true);
    assert.deepEqual(second.value, { x: 1 });
    await cache.cacheInvalidate("rf:cache:test:");
    return `round trip ${(performance.now() - t).toFixed(1)} ms`;
  });

  await check("Neo4j: controlled sync matches PostgreSQL counts; all Cypher queries execute", graph.graphConfigured(), async () => {
    const s = await graph.syncGraph();
    assert.equal(s.status, "SUCCEEDED");
    const overview = await graph.runGraphQuery("overview", {});
    const disasters = overview.graph.nodes.filter((n) => n.label === "Disaster").length;
    const pgDisasters = Number((await pool.query("SELECT count(*) FROM disasters")).rows[0].count);
    assert.equal(disasters, pgDisasters, "graph mirrors PostgreSQL");
    const d = (await pool.query("SELECT rr.disaster_id, ai.warehouse_id FROM allocation_items ai JOIN resource_requests rr USING (request_id) LIMIT 1")).rows[0];
    if (d) {
      const path = await graph.runGraphQuery("shortestPath", { disasterId: Number(d.disaster_id), warehouseId: Number(d.warehouse_id) });
      assert.ok(path.graph.edges.length >= 1, "a path exists between a disaster and a warehouse that supplied it");
      const wh = await graph.runGraphQuery("warehousesForDisaster", { disasterId: Number(d.disaster_id) });
      assert.ok(wh.rows.length >= 1);
    }
    assert.ok((await graph.runGraphQuery("sharedResources", {})).rows.length >= 0);
    assert.ok((await graph.runGraphQuery("criticalResources", {})).rows.length >= 1);
    return `${s.records} records synced, ${overview.graph.nodes.length} nodes`;
  });

  await check("Neo4j: failed sync retries 3× and is recorded as FAILED, previous graph kept", graph.graphConfigured(), async () => {
    const real = process.env.NEO4J_PASSWORD;
    const driver = global.rfNeo4j;
    global.rfNeo4j = undefined;
    process.env.NEO4J_PASSWORD = "definitely-wrong-password";
    try {
      const r = await graph.syncGraph();
      assert.equal(r.status, "FAILED");
      assert.equal(r.attempts, 3);
      const run = (await pool.query("SELECT status, attempts, detail FROM integration_sync_runs WHERE run_id = $1", [r.runId])).rows[0];
      assert.equal(run.status, "FAILED");
      assert.match(run.detail, /Previous graph snapshot retained/);
    } finally {
      await (global.rfNeo4j as typeof driver)?.close().catch(() => undefined);
      process.env.NEO4J_PASSWORD = real;
      global.rfNeo4j = driver;
    }
    const after = await graph.runGraphQuery("overview", {});
    assert.ok(after.graph.nodes.length > 0, "previous snapshot still queryable");
  });

  await check("pgvector: sync embeds all sources; nearest-neighbour search is ordered by cosine similarity; HNSW index used", vector.vectorConfigured(), async () => {
    const s = await vector.syncVectors();
    assert.equal(s.status, "SUCCEEDED");
    const stats = await vector.vectorStats();
    const total = stats.counts.reduce((n, c) => n + c.n, 0);
    assert.equal(total, s.records);
    const r = await vector.semanticSearch("children sick from contaminated drinking water", 5);
    assert.ok(r.results.length > 0);
    for (let i = 1; i < r.results.length; i++) assert.ok(r.results[i - 1].similarity >= r.results[i].similarity);
    const plan = await vector.explainVectorSearch();
    assert.match(plan, /hnsw|Index Scan/i);
    return `${total} vectors (${s.provider.label}); top hit "${r.results[0].title}" cos=${r.results[0].similarity}`;
  });

  await pool.end();
  await global.rfNeo4j?.close().catch(() => undefined);
  await global.rfVectorPool?.end().catch(() => undefined);
  await global.rfRedis?.client?.quit().catch(() => undefined);
}

main()
  .catch((e) => {
    results.push({ test: e.message, status: "FAIL" });
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    writeFileSync("docs/services-test-results.json", JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
    process.exit(process.exitCode ?? 0);
  });
