import neo4j, { type Driver, type Record as NeoRecord } from "neo4j-driver";
import { pool } from "./postgres";
import { logger } from "./logger";

/**
 * Neo4j is a read-optimised PROJECTION of PostgreSQL (the source of truth).
 * Synchronisation is explicit (manager-triggered), full-refresh, atomic inside one
 * Neo4j transaction, retried with exponential backoff, and every run is recorded in
 * PostgreSQL integration_sync_runs. There is no distributed transaction: if a sync
 * fails, Neo4j keeps the previous complete snapshot and the run is marked FAILED.
 */
declare global {
  var rfNeo4j: Driver | undefined;
}

export function graphConfigured() {
  return Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
}

function driver(): Driver {
  if (!graphConfigured()) throw Object.assign(new Error("Neo4j is not configured"), { code: "GRAPH_DISABLED" });
  global.rfNeo4j ??= neo4j.driver(process.env.NEO4J_URI!, neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!), {
    connectionTimeout: 3000,
    maxConnectionPoolSize: 10,
    disableLosslessIntegers: true,
  });
  return global.rfNeo4j;
}

export async function graphPing() {
  if (!graphConfigured()) return { configured: false, ok: false };
  const t = performance.now();
  try {
    await driver().verifyConnectivity();
    return { configured: true, ok: true, latencyMs: +(performance.now() - t).toFixed(2) };
  } catch {
    return { configured: true, ok: false };
  }
}

async function snapshot() {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const [disasters, locations, affects, camps, warehouses, resources, stock, requests, requestItems, allocations, allocItems, deliveries] =
    await Promise.all([
      q(`SELECT disaster_id::int AS id, disaster_name AS name, disaster_type AS type, severity, status FROM disasters`),
      q(`SELECT location_id::int AS id, location_name AS name, location_type AS type, latitude::float AS lat, longitude::float AS lon FROM locations`),
      q(`SELECT disaster_id::int AS d, location_id::int AS l, impact_level AS impact, affected_population AS population FROM disaster_locations`),
      q(`SELECT camp_id::int AS id, camp_name AS name, location_id::int AS l, capacity, current_population AS population, status FROM relief_camps`),
      q(`SELECT warehouse_id::int AS id, warehouse_name AS name, location_id::int AS l, status FROM warehouses`),
      q(`SELECT r.resource_id::int AS id, r.resource_name AS name, r.unit, c.category_name AS category FROM resources r JOIN resource_categories c USING (category_id)`),
      q(`SELECT warehouse_id::int AS w, resource_id::int AS r, quantity_available::float AS qty FROM inventory WHERE quantity_available > 0`),
      q(`SELECT request_id::int AS id, camp_id::int AS c, disaster_id::int AS d, status, priority_level AS priority FROM resource_requests`),
      q(`SELECT request_id::int AS req, resource_id::int AS r, quantity_requested::float AS qty FROM request_items`),
      q(`SELECT a.allocation_id::int AS id, a.request_id::int AS req, a.status, rr.camp_id::int AS c FROM allocations a JOIN resource_requests rr USING (request_id)`),
      q(`SELECT allocation_id::int AS a, warehouse_id::int AS w, sum(quantity_allocated)::float AS qty FROM allocation_items GROUP BY 1, 2`),
      q(`SELECT delivery_id::int AS id, allocation_id::int AS a, status FROM deliveries`),
    ]);
  return { disasters, locations, affects, camps, warehouses, resources, stock, requests, requestItems, allocations, allocItems, deliveries };
}

async function writeGraph(s: Awaited<ReturnType<typeof snapshot>>) {
  const session = driver().session();
  try {
    // Schema changes cannot share a transaction with data writes in Neo4j.
    for (const label of ["Disaster", "Location", "Camp", "Warehouse", "Resource", "Request", "Allocation", "Delivery"])
      await session.run(`CREATE INDEX rf_${label.toLowerCase()}_id IF NOT EXISTS FOR (n:${label}) ON (n.id)`);
    await session.executeWrite(async (tx) => {
      await tx.run("MATCH (n:RF) DETACH DELETE n");
      // JS numbers would be stored as floats; key fields are converted to Neo4j integers.
      const keyFields = new Set(["id", "d", "l", "c", "w", "r", "req", "a", "capacity", "population"]);
      const ints = (rows: unknown[]) =>
        (rows as Record<string, unknown>[]).map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, keyFields.has(k) && typeof v === "number" ? neo4j.int(v) : v])),
        );
      const run = (cypher: string, rows: unknown[]) => (rows.length ? tx.run(cypher, { rows: ints(rows) }) : Promise.resolve());
      await run("UNWIND $rows AS r CREATE (:RF:Disaster {id: r.id, name: r.name, type: r.type, severity: r.severity, status: r.status})", s.disasters);
      await run("UNWIND $rows AS r CREATE (:RF:Location {id: r.id, name: r.name, type: r.type, lat: r.lat, lon: r.lon})", s.locations);
      await run("UNWIND $rows AS r CREATE (:RF:Camp {id: r.id, name: r.name, capacity: r.capacity, population: r.population, status: r.status})", s.camps);
      await run("UNWIND $rows AS r CREATE (:RF:Warehouse {id: r.id, name: r.name, status: r.status})", s.warehouses);
      await run("UNWIND $rows AS r CREATE (:RF:Resource {id: r.id, name: r.name, unit: r.unit, category: r.category})", s.resources);
      await run("UNWIND $rows AS r CREATE (:RF:Request {id: r.id, name: 'Request #' + r.id, status: r.status, priority: r.priority})", s.requests);
      await run("UNWIND $rows AS r CREATE (:RF:Allocation {id: r.id, name: 'Allocation #' + r.id, status: r.status})", s.allocations);
      await run("UNWIND $rows AS r CREATE (:RF:Delivery {id: r.id, name: 'Delivery #' + r.id, status: r.status})", s.deliveries);
      await run("UNWIND $rows AS r MATCH (d:Disaster {id: r.d}), (l:Location {id: r.l}) CREATE (d)-[:AFFECTS {impact: r.impact, population: r.population}]->(l)", s.affects);
      await run("UNWIND $rows AS r MATCH (l:Location {id: r.l}), (c:Camp {id: r.id}) CREATE (l)-[:CONTAINS]->(c)", s.camps);
      await run("UNWIND $rows AS r MATCH (l:Location {id: r.l}), (w:Warehouse {id: r.id}) CREATE (l)-[:HOSTS]->(w)", s.warehouses);
      await run("UNWIND $rows AS r MATCH (w:Warehouse {id: r.w}), (x:Resource {id: r.r}) CREATE (w)-[:STORES {qty: r.qty}]->(x)", s.stock);
      await run("UNWIND $rows AS r MATCH (c:Camp {id: r.c}), (q:Request {id: r.id}) CREATE (c)-[:RAISED]->(q)", s.requests);
      await run("UNWIND $rows AS r MATCH (q:Request {id: r.id}), (d:Disaster {id: r.d}) CREATE (q)-[:FOR_DISASTER]->(d)", s.requests);
      await run("UNWIND $rows AS r MATCH (q:Request {id: r.req}), (x:Resource {id: r.r}) CREATE (q)-[:NEEDS {qty: r.qty}]->(x)", s.requestItems);
      await tx.run(
        "MATCH (c:Camp)-[:RAISED]->(:Request)-[n:NEEDS]->(x:Resource) WITH c, x, sum(n.qty) AS qty CREATE (c)-[:REQUESTS {qty: qty}]->(x)",
      );
      await run("UNWIND $rows AS r MATCH (a:Allocation {id: r.id}), (q:Request {id: r.req}) CREATE (a)-[:FULFILLS]->(q)", s.allocations);
      await run("UNWIND $rows AS r MATCH (a:Allocation {id: r.id}), (c:Camp {id: r.c}) CREATE (a)-[:SUPPLIES]->(c)", s.allocations);
      await run("UNWIND $rows AS r MATCH (a:Allocation {id: r.a}), (w:Warehouse {id: r.w}) CREATE (a)-[:DRAWS_FROM {qty: r.qty}]->(w)", s.allocItems);
      await run("UNWIND $rows AS r MATCH (d:Delivery {id: r.id}), (a:Allocation {id: r.a}) CREATE (d)-[:TRANSPORTS]->(a)", s.deliveries);
    });
  } finally {
    await session.close();
  }
}

export async function syncGraph(triggeredBy?: string) {
  const run = (
    await pool.query(`INSERT INTO integration_sync_runs(target, status, triggered_by) VALUES ('neo4j', 'RUNNING', $1) RETURNING run_id`, [
      triggeredBy ?? null,
    ])
  ).rows[0].run_id;
  const s = await snapshot();
  const records = Object.values(s).reduce((n, rows) => n + rows.length, 0);
  let attempt = 0;
  let lastError = "";
  while (attempt < 3) {
    attempt++;
    try {
      await writeGraph(s);
      await pool.query(
        `UPDATE integration_sync_runs SET status = 'SUCCEEDED', attempts = $2, records_synced = $3, finished_at = now(), detail = $4 WHERE run_id = $1`,
        [run, attempt, records, `Full refresh of ${s.disasters.length} disasters, ${s.requests.length} requests`],
      );
      return { runId: run, status: "SUCCEEDED", attempts: attempt, records };
    } catch (e) {
      lastError = (e as { code?: string }).code ?? (e as Error).name;
      logger.warn("neo4j sync attempt failed", { attempt, code: lastError });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
  await pool.query(`UPDATE integration_sync_runs SET status = 'FAILED', attempts = $2, finished_at = now(), detail = $3 WHERE run_id = $1`, [
    run,
    attempt,
    `Failed after ${attempt} attempts (${lastError}). Previous graph snapshot retained.`,
  ]);
  return { runId: run, status: "FAILED", attempts: attempt, records: 0, error: lastError };
}

export async function lastSync(target: "neo4j" | "vector") {
  return (
    await pool.query(
      `SELECT run_id, status, attempts, records_synced, detail, started_at, finished_at FROM integration_sync_runs
        WHERE target = $1 ORDER BY run_id DESC LIMIT 5`,
      [target],
    )
  ).rows;
}

type Node = { id: string; label: string; name: string; props: Record<string, unknown> };
type Edge = { source: string; target: string; type: string; props: Record<string, unknown> };
function toGraph(records: NeoRecord[]) {
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  const addNode = (n: { elementId: string; labels: string[]; properties: Record<string, unknown> }) =>
    nodes.set(n.elementId, {
      id: n.elementId,
      label: n.labels.find((l) => l !== "RF") ?? "Node",
      name: String(n.properties.name ?? n.elementId),
      props: n.properties,
    });
  for (const rec of records)
    for (const v of rec.values()) {
      const items = Array.isArray(v) ? v : [v];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        if ("labels" in it) addNode(it as never);
        else if ("startNodeElementId" in it) {
          const r = it as { elementId: string; startNodeElementId: string; endNodeElementId: string; type: string; properties: Record<string, unknown> };
          edges.set(r.elementId, { source: r.startNodeElementId, target: r.endNodeElementId, type: r.type, props: r.properties });
        } else if ("segments" in it) {
          for (const seg of (it as { segments: { start: never; end: never; relationship: never }[] }).segments) {
            addNode(seg.start);
            addNode(seg.end);
            const r = seg.relationship as { elementId: string; startNodeElementId: string; endNodeElementId: string; type: string; properties: Record<string, unknown> };
            edges.set(r.elementId, { source: r.startNodeElementId, target: r.endNodeElementId, type: r.type, props: r.properties });
          }
        }
      }
    }
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target)) };
}

/** Fixed, parameterised Cypher queries. No user-supplied Cypher is ever executed. */
export const graphQueries = {
  overview: {
    title: "Whole response network",
    cypher: "MATCH (n:RF) OPTIONAL MATCH (n)-[r]->(m:RF) RETURN n, r, m LIMIT 600",
    params: [] as string[],
  },
  warehousesForDisaster: {
    title: "Warehouses connected to a disaster through resource requests",
    cypher: `MATCH (d:Disaster {id: $disasterId})<-[:FOR_DISASTER]-(q:Request)-[:NEEDS]->(x:Resource)<-[s:STORES]-(w:Warehouse)
             RETURN w.name AS warehouse, collect(DISTINCT x.name) AS resources, sum(s.qty) AS units_on_hand
             ORDER BY size(resources) DESC`,
    params: ["disasterId"],
  },
  sharedResources: {
    title: "Resources requested by more than one camp",
    cypher: `MATCH (c:Camp)-[r:REQUESTS]->(x:Resource)
             WITH x, collect(c.name) AS camps, sum(r.qty) AS total_requested
             WHERE size(camps) > 1
             RETURN x.name AS resource, x.unit AS unit, camps, total_requested ORDER BY size(camps) DESC, total_requested DESC`,
    params: [] as string[],
  },
  shortestPath: {
    title: "Shortest relationship path from a disaster to a warehouse",
    cypher: `MATCH (d:Disaster {id: $disasterId}), (w:Warehouse {id: $warehouseId})
             MATCH p = shortestPath((d)-[*..10]-(w)) RETURN p`,
    params: ["disasterId", "warehouseId"],
  },
  criticalResources: {
    title: "Resources demanded across multiple affected locations",
    cypher: `MATCH (d:Disaster)-[:AFFECTS]->(l:Location)-[:CONTAINS]->(c:Camp)-[r:REQUESTS]->(x:Resource)
             WITH x, collect(DISTINCT l.name) AS locations, collect(DISTINCT d.name) AS disasters, sum(r.qty) AS demand
             OPTIONAL MATCH (:Warehouse)-[s:STORES]->(x)
             WITH x, locations, disasters, demand, coalesce(sum(s.qty), 0) AS stock
             RETURN x.name AS resource, size(locations) AS location_count, locations, disasters, demand, stock,
                    CASE WHEN stock < demand THEN 'SHORTAGE' ELSE 'COVERED' END AS position
             ORDER BY location_count DESC, demand - stock DESC`,
    params: [] as string[],
  },
} as const;
export type GraphQueryId = keyof typeof graphQueries;

export async function runGraphQuery(qid: GraphQueryId, params: Record<string, number>) {
  const def = graphQueries[qid];
  const session = driver().session({ defaultAccessMode: neo4j.session.READ });
  const t = performance.now();
  try {
    const res = await session.run(def.cypher, Object.fromEntries(def.params.map((p) => [p, neo4j.int(params[p] ?? 0)])));
    const ms = +(performance.now() - t).toFixed(1);
    const graph = toGraph(res.records);
    const rows = res.records.map((r) => {
      const o: Record<string, unknown> = {};
      for (const k of r.keys) {
        const v = r.get(k);
        o[String(k)] = v && typeof v === "object" && ("labels" in v || "segments" in v || "startNodeElementId" in v) ? undefined : v;
      }
      return o;
    });
    return { title: def.title, cypher: def.cypher, ms, rows: rows.filter((r) => Object.values(r).some((v) => v !== undefined)), graph };
  } finally {
    await session.close();
  }
}
