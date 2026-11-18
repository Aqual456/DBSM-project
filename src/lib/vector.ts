import { Pool } from "pg";
import { pool } from "./postgres";
import { getMongoDb } from "./mongodb";
import { activeProvider, embed, type Provider } from "./embeddings";
import { logger } from "./logger";

/**
 * Vector store = a separate PostgreSQL+pgvector database (VECTOR_DATABASE_URL).
 * Ownership: PostgreSQL (operational) and MongoDB (incidents) own the text; the vector
 * store only holds derived embeddings, rebuilt by an explicit sync that is recorded in
 * integration_sync_runs. If it is unavailable, the rest of ReliefFlow is unaffected.
 */
declare global {
  var rfVectorPool: Pool | undefined;
  var rfVectorReady: boolean | undefined;
}

export function vectorConfigured() {
  return Boolean(process.env.VECTOR_DATABASE_URL);
}
function vpool() {
  if (!vectorConfigured()) throw Object.assign(new Error("Vector store is not configured"), { code: "VECTOR_DISABLED" });
  global.rfVectorPool ??= new Pool({ connectionString: process.env.VECTOR_DATABASE_URL, max: 4, connectionTimeoutMillis: 3000 });
  return global.rfVectorPool;
}
const safeProvider = (p: Provider) => p.id.replace(/[^a-z0-9]/g, "_");

async function ensureSchema(p: Provider) {
  const db = vpool();
  if (!global.rfVectorReady) {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await db.query(`CREATE TABLE IF NOT EXISTS document_vectors (
        source     TEXT NOT NULL CHECK (source IN ('incident','disaster','request')),
        source_id  TEXT NOT NULL,
        provider   TEXT NOT NULL,
        dims       INTEGER NOT NULL CHECK (dims > 0),
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding  vector NOT NULL,
        synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (source, source_id, provider))`);
    global.rfVectorReady = true;
  }
  // Partial expression HNSW index per provider (fixed dimension), cosine distance operator class.
  await db.query(
    `CREATE INDEX IF NOT EXISTS dv_hnsw_${safeProvider(p)} ON document_vectors
       USING hnsw ((embedding::vector(${p.dims})) vector_cosine_ops) WHERE provider = '${p.id}'`,
  );
}

export async function vectorPing() {
  if (!vectorConfigured()) return { configured: false, ok: false };
  const t = performance.now();
  try {
    await vpool().query("SELECT 1");
    return { configured: true, ok: true, latencyMs: +(performance.now() - t).toFixed(2) };
  } catch {
    return { configured: true, ok: false };
  }
}

type Doc = { source: "incident" | "disaster" | "request"; source_id: string; title: string; content: string; metadata: Record<string, unknown> };

async function collectDocuments(): Promise<Doc[]> {
  const docs: Doc[] = [];
  const disasters = await pool.query(
    `SELECT disaster_id, disaster_name, disaster_type, severity, coalesce(description,'') AS description FROM disasters`,
  );
  for (const d of disasters.rows)
    docs.push({
      source: "disaster",
      source_id: String(d.disaster_id),
      title: d.disaster_name,
      content: `${d.disaster_name}. ${d.disaster_type} disaster, severity ${d.severity}. ${d.description}`,
      metadata: { severity: d.severity, type: d.disaster_type },
    });
  const requests = await pool.query(
    `SELECT rr.request_id, rr.priority_level, coalesce(rr.remarks,'') AS remarks, c.camp_name,
            string_agg(r.resource_name || ' ' || ri.quantity_requested || ' ' || r.unit, ', ') AS items
       FROM resource_requests rr JOIN relief_camps c USING (camp_id)
       JOIN request_items ri USING (request_id) JOIN resources r USING (resource_id)
      GROUP BY rr.request_id, c.camp_name`,
  );
  for (const r of requests.rows)
    docs.push({
      source: "request",
      source_id: String(r.request_id),
      title: `Request #${r.request_id} — ${r.camp_name}`,
      content: `Resource request from ${r.camp_name} (${r.priority_level}) for ${r.items}. ${r.remarks}`,
      metadata: { priority: r.priority_level },
    });
  try {
    const incidents = await (await getMongoDb()).collection("incident_reports").find({}).limit(5000).toArray();
    for (const i of incidents)
      docs.push({
        source: "incident",
        source_id: String(i._id),
        title: `${i.reportType} incident — ${i.location?.label ?? "unknown location"}`,
        content: `${i.description} Tags: ${(i.tags ?? []).join(", ")}. Location: ${i.location?.label ?? ""}`,
        metadata: { severity: i.severity, reportType: i.reportType, disasterId: i.disasterId },
      });
  } catch (e) {
    logger.warn("vector sync: MongoDB unavailable, incidents skipped", { name: (e as Error).name });
  }
  return docs;
}

export async function syncVectors(triggeredBy?: string) {
  const p = activeProvider();
  const run = (
    await pool.query(`INSERT INTO integration_sync_runs(target, status, triggered_by) VALUES ('vector', 'RUNNING', $1) RETURNING run_id`, [
      triggeredBy ?? null,
    ])
  ).rows[0].run_id;
  let attempt = 0;
  let lastError = "";
  while (attempt < 3) {
    attempt++;
    try {
      await ensureSchema(p);
      const docs = await collectDocuments();
      const vectors = await embed(docs.map((d) => d.content), "document", p);
      const c = await vpool().connect();
      try {
        await c.query("BEGIN");
        await c.query("DELETE FROM document_vectors WHERE provider = $1", [p.id]);
        for (let i = 0; i < docs.length; i++) {
          const d = docs[i];
          await c.query(
            `INSERT INTO document_vectors(source, source_id, provider, dims, title, content, metadata, embedding)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)`,
            [d.source, d.source_id, p.id, p.dims, d.title, d.content, JSON.stringify(d.metadata), JSON.stringify(vectors[i])],
          );
        }
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      await pool.query(
        `UPDATE integration_sync_runs SET status = 'SUCCEEDED', attempts = $2, records_synced = $3, finished_at = now(), detail = $4 WHERE run_id = $1`,
        [run, attempt, docs.length, `${docs.length} documents embedded with ${p.label}`],
      );
      return { runId: run, status: "SUCCEEDED", attempts: attempt, records: docs.length, provider: p };
    } catch (e) {
      lastError = (e as { code?: string }).code ?? (e as Error).name;
      logger.warn("vector sync attempt failed", { attempt, code: lastError });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  await pool.query(`UPDATE integration_sync_runs SET status = 'FAILED', attempts = $2, finished_at = now(), detail = $3 WHERE run_id = $1`, [
    run,
    attempt,
    `Failed after ${attempt} attempts (${lastError}). Previous vectors retained.`,
  ]);
  return { runId: run, status: "FAILED", attempts: attempt, records: 0, provider: p, error: lastError };
}

export async function vectorStats() {
  const p = activeProvider();
  await ensureSchema(p);
  const r = await vpool().query(
    `SELECT source, count(*)::int AS n, max(synced_at) AS synced_at FROM document_vectors WHERE provider = $1 GROUP BY source`,
    [p.id],
  );
  const ext = await vpool().query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  return { provider: p, counts: r.rows, pgvector: ext.rows[0]?.extversion ?? null };
}

export async function semanticSearch(query: string, k = 8, source?: string) {
  const p = activeProvider();
  await ensureSchema(p);
  const t0 = performance.now();
  const [q] = await embed([query], "query", p);
  const embedMs = +(performance.now() - t0).toFixed(1);
  const t1 = performance.now();
  const r = await vpool().query(
    `SELECT source, source_id, title, content, metadata,
            1 - (embedding::vector(${p.dims}) <=> $1::vector(${p.dims})) AS similarity
       FROM document_vectors
      WHERE provider = $2 AND ($3::text IS NULL OR source = $3)
      ORDER BY embedding::vector(${p.dims}) <=> $1::vector(${p.dims})
      LIMIT $4`,
    [JSON.stringify(q), p.id, source ?? null, k],
  );
  const searchMs = +(performance.now() - t1).toFixed(1);
  return {
    provider: p,
    queryVectorPreview: q.slice(0, 12),
    dims: q.length,
    embedMs,
    searchMs,
    results: r.rows.map((x) => ({ ...x, similarity: +Number(x.similarity).toFixed(4) })),
  };
}

export async function explainVectorSearch() {
  const p = activeProvider();
  await ensureSchema(p);
  const c = await vpool().connect();
  try {
    await c.query("BEGIN");
    // Small tables make the planner prefer a seq scan; disable it to show the HNSW index plan.
    await c.query("SET LOCAL enable_seqscan = off");
    const probe = JSON.stringify(new Array(p.dims).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const r = await c.query(
      `EXPLAIN SELECT source_id FROM document_vectors WHERE provider = '${p.id}'
        ORDER BY embedding::vector(${p.dims}) <=> '${probe}'::vector(${p.dims}) LIMIT 5`,
    );
    return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
