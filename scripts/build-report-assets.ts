import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { execSync } from "child_process";

/**
 * Generates the evidence fragments embedded in the project report: data dictionary (from the
 * PostgreSQL catalog comments), outputs of the important queries (run READ ONLY against the
 * real database), MongoDB / pgvector command outputs, sample semantic-search results, the
 * project tree and test totals. Output: docs/report/assets/*.md
 */
const OUT = "docs/report/assets";
const md = (rows: Record<string, unknown>[], max = 12) => {
  if (!rows.length) return "_(no rows)_";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => (v === null || v === undefined ? "NULL" : v instanceof Date ? v.toISOString().slice(0, 16).replace("T", " ") : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 80);
  return [`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...rows.slice(0, max).map((r) => `| ${cols.map((c) => cell(r[c])).join(" | ")} |`)].join("\n") + (rows.length > max ? `\n\n_${rows.length - max} more rows not shown_` : "");
};

const queries: { id: string; title: string; concept: string; sql: string }[] = [
  { id: "join-group-having", title: "Requests per camp (JOIN · GROUP BY · HAVING · ORDER BY · aggregates)", concept: "Joins three tables, aggregates per camp, keeps only camps with more than one request.",
    sql: `SELECT c.camp_name, count(DISTINCT rr.request_id) AS requests,
       sum(ri.quantity_requested) AS units_requested,
       round(avg(rr.priority_score), 1) AS avg_priority
FROM relief_camps c
JOIN resource_requests rr ON rr.camp_id = c.camp_id
JOIN request_items ri ON ri.request_id = rr.request_id
WHERE rr.status <> 'REJECTED'
GROUP BY c.camp_name
HAVING count(DISTINCT rr.request_id) > 1
ORDER BY units_requested DESC;` },
  { id: "aggregates", title: "Stock by category (COUNT · SUM · AVG · MIN · MAX)", concept: "Aggregate functions over inventory joined to its catalogue.",
    sql: `SELECT cat.category_name, count(*) AS stock_lines, sum(i.quantity_available) AS total_units,
       round(avg(i.quantity_available), 1) AS avg_units, min(i.quantity_available) AS min_units, max(i.quantity_available) AS max_units
FROM inventory i JOIN resources r USING (resource_id) JOIN resource_categories cat USING (category_id)
GROUP BY cat.category_name ORDER BY total_units DESC;` },
  { id: "nested", title: "Resources whose total stock is below the average (nested subquery)", concept: "The inner query computes the average once; the outer query compares each resource with it.",
    sql: `SELECT r.resource_name, r.unit, sum(i.quantity_available) AS total_stock
FROM resources r JOIN inventory i USING (resource_id)
GROUP BY r.resource_name, r.unit
HAVING sum(i.quantity_available) <
       (SELECT avg(t) FROM (SELECT sum(quantity_available) AS t FROM inventory GROUP BY resource_id) x)
ORDER BY total_stock;` },
  { id: "correlated", title: "Camps that requested more than 1,000 units (correlated subquery)", concept: "The subquery refers to the outer row (c.camp_id) and is evaluated per camp.",
    sql: `SELECT c.camp_name,
       (SELECT sum(ri.quantity_requested) FROM resource_requests rr JOIN request_items ri USING (request_id)
         WHERE rr.camp_id = c.camp_id) AS units_requested
FROM relief_camps c
WHERE (SELECT COALESCE(sum(ri.quantity_requested), 0) FROM resource_requests rr JOIN request_items ri USING (request_id)
        WHERE rr.camp_id = c.camp_id) > 1000
ORDER BY units_requested DESC;` },
  { id: "exists-division", title: "Warehouses that stock every MEDICAL resource (relational division with NOT EXISTS)", concept: "Double negation: there is no medical resource that the warehouse does not stock.",
    sql: `SELECT w.warehouse_name
FROM warehouses w
WHERE NOT EXISTS (
  SELECT 1 FROM resources r JOIN resource_categories c USING (category_id)
  WHERE c.category_name = 'MEDICAL'
    AND NOT EXISTS (SELECT 1 FROM inventory i
                    WHERE i.warehouse_id = w.warehouse_id AND i.resource_id = r.resource_id AND i.quantity_available > 0));` },
  { id: "recursive", title: "Days until drinking water runs out (recursive CTE)", concept: "WITH RECURSIVE: the anchor row is today's stock; each recursive step subtracts one day's consumption.",
    sql: `WITH RECURSIVE burn(day, remaining, daily) AS (
  SELECT 0,
         (SELECT sum(quantity_available) FROM inventory i JOIN resources r USING (resource_id) WHERE r.resource_name = 'Drinking Water'),
         GREATEST((SELECT sum(current_population) FROM relief_camps WHERE status <> 'CLOSED') / 5.0, 1)
  UNION ALL
  SELECT day + 1, remaining - daily, daily FROM burn WHERE remaining - daily > 0 AND day < 30
)
SELECT day, round(remaining, 0) AS litres_left FROM burn ORDER BY day;` },
  { id: "window", title: "Ranking requests by priority (window functions)", concept: "RANK / DENSE_RANK / ROW_NUMBER keep every row, unlike GROUP BY.",
    sql: `SELECT request_id, priority_level, priority_score,
       RANK() OVER (ORDER BY priority_score DESC) AS rank,
       DENSE_RANK() OVER (ORDER BY priority_score DESC) AS dense_rank,
       count(*) OVER (PARTITION BY priority_level) AS in_same_level
FROM resource_requests ORDER BY priority_score DESC;` },
  { id: "view", title: "Shortage detection (view v_resource_demand)", concept: "A view stores the demand-vs-supply query once; the dashboard and intelligence pages read it.",
    sql: `SELECT resource_name, unit, outstanding_demand, available_stock, net_position
FROM v_resource_demand ORDER BY net_position;` },
  { id: "functions", title: "Stored functions and procedure", concept: "request_fulfillment_pct() and operational_summary() are SQL functions; refresh_request_status() is a procedure called by the API.",
    sql: `SELECT rr.request_id, rr.status, request_fulfillment_pct(rr.request_id) AS fulfilled_pct
FROM resource_requests rr ORDER BY rr.request_id DESC LIMIT 6;` },
  { id: "summary", title: "operational_summary() (set-returning function)", concept: "A function that returns a table of KPIs.", sql: `SELECT * FROM operational_summary();` },
  { id: "fts", title: "Full-text search on disasters (tsvector + GIN index)", concept: "websearch_to_tsquery supports OR and -exclusion; ts_rank orders by relevance.",
    sql: `SELECT disaster_name, round(ts_rank(search_vector, q)::numeric, 3) AS rank
FROM disasters, websearch_to_tsquery('english', 'flood OR cyclone') q
WHERE search_vector @@ q ORDER BY rank DESC;` },
  { id: "trigger-history", title: "Trigger-written stock history", concept: "inventory_history (AFTER UPDATE) writes every stock change with its reason; no API code inserts these rows.",
    sql: `SELECT m.movement_id, w.warehouse_name, r.resource_name, m.delta, m.reason
FROM inventory_movements m JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
WHERE m.reason LIKE 'Allocation #%' ORDER BY m.movement_id DESC LIMIT 6;` },
  { id: "audit", title: "Row-level audit trail (trigger log_row_change)", concept: "Field-level diffs captured automatically with the acting user.",
    sql: `SELECT l.change_id, l.table_name, l.operation, l.changed_fields, u.full_name AS changed_by
FROM data_change_log l LEFT JOIN app_users u ON u.user_id = l.changed_by
WHERE l.operation = 'UPDATE' ORDER BY l.change_id DESC LIMIT 5;` },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { pool } = await import("../src/lib/postgres");
  const c = await pool.connect();
  const out: string[] = [];
  try {
    await c.query("BEGIN READ ONLY");
    for (const q of queries) {
      const r = await c.query(q.sql);
      out.push(`### ${q.title}\n\n${q.concept}\n\n\`\`\`sql\n${q.sql}\n\`\`\`\n\n**Result (live database):**\n\n${md(r.rows, 10)}\n`);
    }
    // RLS evidence
    const driver = (await c.query("SELECT driver_id FROM deliveries GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")).rows[0].driver_id;
    const total = (await c.query("SELECT count(*)::int AS n FROM deliveries")).rows[0].n;
    await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(driver)]);
    await c.query("SET LOCAL ROLE rf_driver");
    const seen = (await c.query("SELECT count(*)::int AS n FROM deliveries")).rows[0].n;
    await c.query("SAVEPOINT s");
    let denied = "";
    try { await c.query("SELECT password_hash FROM app_users LIMIT 1"); } catch (e) { denied = (e as Error).message; }
    await c.query("ROLLBACK TO SAVEPOINT s");
    await c.query("RESET ROLE");
    writeFileSync(`${OUT}/rls.md`, `| Executed as | Query | Result |\n|---|---|---|\n| postgres (owner) | \`SELECT count(*) FROM deliveries\` | ${total} rows |\n| rf_driver (user ${driver}) | \`SELECT count(*) FROM deliveries\` | ${seen} rows (own deliveries only) |\n| rf_driver | \`SELECT password_hash FROM app_users\` | ERROR: ${denied} |\n`);
    // data dictionary
    const dict = (await c.query(`
      SELECT c.table_name, c.column_name, c.ordinal_position,
             CASE WHEN c.data_type = 'character varying' THEN 'VARCHAR(' || c.character_maximum_length || ')'
                  WHEN c.data_type = 'numeric' THEN 'NUMERIC(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                  WHEN c.data_type = 'timestamp with time zone' THEN 'TIMESTAMPTZ' ELSE upper(c.data_type) END AS type,
             c.is_nullable = 'NO' AS not_null,
             EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t USING (constraint_name, table_schema, table_name)
                      WHERE t.constraint_type = 'PRIMARY KEY' AND k.table_name = c.table_name AND k.column_name = c.column_name AND k.table_schema = 'public') AS pk,
             EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t USING (constraint_name, table_schema, table_name)
                      WHERE t.constraint_type = 'FOREIGN KEY' AND k.table_name = c.table_name AND k.column_name = c.column_name AND k.table_schema = 'public') AS fk,
             col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position) AS description,
             obj_description(format('public.%I', c.table_name)::regclass) AS table_description
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' ORDER BY c.table_name, c.ordinal_position`)).rows;
    const byTable = new Map<string, typeof dict>();
    for (const d of dict) byTable.set(d.table_name, [...(byTable.get(d.table_name) ?? []), d]);
    const dd: string[] = [];
    for (const [t, cols] of byTable) {
      dd.push(`#### ${t}\n\n${cols[0].table_description ?? ""}\n\n| Column | Type | Key | Null | Description |\n|---|---|---|---|---|\n${cols
        .map((x) => `| ${x.column_name} | ${x.type} | ${[x.pk ? "PK" : "", x.fk ? "FK" : ""].filter(Boolean).join(", ")} | ${x.not_null ? "NOT NULL" : "NULL"} | ${(x.description ?? "").replace(/\|/g, "/")} |`)
        .join("\n")}\n`);
    }
    writeFileSync(`${OUT}/dictionary.md`, dd.join("\n"));
    const counts = (await c.query(`SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::int AS tables,
      (SELECT count(*) FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name) WHERE c.table_schema='public' AND t.table_type='BASE TABLE')::int AS columns,
      (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f')::int AS fks,
      (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c')::int AS checks,
      (SELECT count(*) FROM pg_views WHERE schemaname='public')::int AS views,
      (SELECT count(*) FROM pg_indexes WHERE schemaname='public')::int AS indexes,
      (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT tgisinternal AND c.relnamespace='public'::regnamespace)::int AS triggers,
      (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname NOT LIKE '%trgm%' AND proname NOT LIKE 'gtrgm%' AND proname NOT IN ('similarity','word_similarity','strict_word_similarity','show_limit','set_limit','show_trgm','similarity_op','word_similarity_op','strict_word_similarity_op','similarity_dist','word_similarity_dist_op','strict_word_similarity_dist_op','word_similarity_commutator_op','strict_word_similarity_commutator_op','word_similarity_dist_commutator_op','strict_word_similarity_dist_commutator_op'))::int AS functions,
      (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='p')::int AS procedures,
      (SELECT count(*) FROM pg_policies WHERE schemaname='public')::int AS policies,
      (SELECT count(*) FROM pg_roles WHERE rolname IN ('rf_admin','rf_coordinator','rf_field_officer','rf_driver'))::int AS db_roles`)).rows[0];
    writeFileSync(`${OUT}/counts.json`, JSON.stringify(counts, null, 2));
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
  writeFileSync(`${OUT}/queries.md`, out.join("\n"));

  // DML demonstration in the lab sandbox (rolled back)
  const { runSandboxed, resetLabPool } = await import("../src/lib/lab/sandbox");
  const { findDemo } = await import("../src/lib/lab/demos");
  const dml: string[] = [];
  for (const id of ["insert-update-delete", "upsert", "ddl", "violations", "seq-vs-index", "atomic-allocation"]) {
    const d = findDemo(id)!;
    const r = await runSandboxed(d.steps, { timeoutMs: 8000 });
    dml.push(`### ${d.title}\n\n${d.explain}\n\n` + r.results.map((s) => {
      const plan = s.fields?.[0] === "QUERY PLAN" && s.rows?.[0] && typeof s.rows[0]["QUERY PLAN"] === "object";
      let res = s.error ? `→ **ERROR ${s.error.code}**: ${s.error.message}` : plan ? (() => {
        const p = (s.rows![0]["QUERY PLAN"] as { Plan: { "Node Type": string; Plans?: { "Node Type": string }[] }; "Execution Time": number }[])[0];
        const kinds: string[] = []; const walk = (n: { "Node Type": string; Plans?: unknown[] }) => { kinds.push(n["Node Type"]); ((n.Plans ?? []) as never[]).forEach(walk); }; walk(p.Plan);
        return `→ plan: **${kinds.join(" → ")}**, execution **${p["Execution Time"].toFixed(2)} ms** (measured)`;
      })() : s.rows?.length ? "\n\n" + md(s.rows, 6) : `→ ${s.command ?? "OK"}${s.rowCount != null ? ` (${s.rowCount} row(s))` : ""}`;
      if (res.startsWith("\n")) res = res;
      return `\`\`\`sql\n${s.sql}\n\`\`\`\n${res}\n`;
    }).join("\n") + `\n_All statements above ran in the lab sandbox inside one transaction that was rolled back._\n`);
  }
  writeFileSync(`${OUT}/dml.md`, dml.join("\n"));
  await resetLabPool();

  // semantic search samples
  const v = await import("../src/lib/vector");
  const sem: string[] = [];
  for (const q of ["kids getting ill from dirty water", "people sleeping in the cold without shelter", "roads blocked so trucks cannot reach"]) {
    const r = await v.semanticSearch(q, 3);
    sem.push(`**Query:** "${q}" · provider ${r.provider.label} · ${r.dims} dimensions · search ${r.searchMs} ms\n\n${md(r.results.map((x: { similarity: number; source: string; title: string; content: string }) => ({ cosine_similarity: x.similarity, source: x.source, document: x.title, text: x.content.slice(0, 70) })))}\n`);
  }
  writeFileSync(`${OUT}/semantic.md`, sem.join("\n"));
  await pool.end();
  await global.rfVectorPool?.end().catch(() => undefined);

  // MongoDB + pgvector command outputs (scratch databases only)
  const mongo = execSync("docker exec -i reliefflow-mongo mongosh --quiet", { input: readFileSync("db/mongodb/incident_commands.mongosh.js"), encoding: "utf8" });
  writeFileSync(`${OUT}/mongo-output.txt`, mongo.replace(/test> /g, "").trim());
  const vec = execSync("docker exec -i reliefflow-vectordb psql -U postgres -d reliefflow_vectors -v ON_ERROR_STOP=1", { input: readFileSync("db/vector/pgvector_commands.sql"), encoding: "utf8" });
  writeFileSync(`${OUT}/vector-output.txt`, vec.trim());
  console.log("report assets written to", OUT);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
