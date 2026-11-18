import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "../postgres";
import { LAB_DB, LAB_ROLE, labAdminUrl, labPassword, resetLabPool } from "./sandbox";

/**
 * (Re)build the lab database:
 *   1. ensure the least-privilege role and the separate database exist;
 *   2. recreate the schema from the project's own migration files;
 *   3. copy a SANITISED snapshot of operational data (no e-mails, phones or password hashes);
 *   4. build synthetic benchmark tables for the query-optimisation lab;
 *   5. grant only what the role needs.
 * The operational database is only READ (SELECT) during this process.
 */
const SCHEMA_FILES = ["001_schema.sql", "005_integrity_security.sql", "006_allocation_history.sql", "007_dbms_engineering.sql"];
const COPY_ORDER: { table: string; select?: string }[] = [
  { table: "roles" },
  {
    table: "app_users",
    select: `SELECT user_id, role_id, full_name, 'user' || user_id || '@lab.local' AS email, 'REDACTED' AS password_hash,
                    NULL::text AS phone, is_active, created_at FROM app_users`,
  },
  { table: "locations" },
  { table: "disasters" },
  { table: "disaster_locations" },
  { table: "relief_camps" },
  { table: "resource_categories" },
  { table: "resources" },
  { table: "warehouses" },
  { table: "inventory" },
  { table: "resource_requests" },
  { table: "request_items" },
  { table: "allocations" },
  { table: "allocation_items" },
  { table: "vehicles" },
  { table: "volunteers", select: `SELECT volunteer_id, full_name, '+00 0000' || lpad(volunteer_id::text, 6, '0') AS phone, NULL::text AS email, skills, availability_status, registered_at FROM volunteers` },
  { table: "deliveries" },
  { table: "delivery_volunteers" },
  { table: "inventory_movements" },
];

function sqlFile(name: string) {
  return readFileSync(join(process.cwd(), "db", "postgres", name), "utf8").replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
}

export async function buildLab(log: (m: string) => void = () => undefined) {
  const su = (await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper;
  if (!su) throw Object.assign(new Error("Lab setup requires a superuser DATABASE_URL"), { code: "LAB_SETUP" });

  // 1. role + database
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${LAB_ROLE}') THEN
        CREATE ROLE ${LAB_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 12;
      END IF; END $$`);
  await pool.query(`ALTER ROLE ${LAB_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${labPassword()}'`);
  for (const [k, v] of [
    ["statement_timeout", "'5s'"],
    ["lock_timeout", "'3s'"],
    ["idle_in_transaction_session_timeout", "'15s'"],
    ["temp_file_limit", "'64MB'"],
    ["work_mem", "'8MB'"],
  ])
    await pool.query(`ALTER ROLE ${LAB_ROLE} SET ${k} = ${v}`);
  const exists = (await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [LAB_DB])).rowCount;
  if (!exists) {
    await pool.query(`CREATE DATABASE ${LAB_DB}`);
    log("created database " + LAB_DB);
  }
  await pool.query(`REVOKE ALL ON DATABASE ${LAB_DB} FROM PUBLIC`);
  await pool.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${LAB_DB} TO ${LAB_ROLE}`);
  await pool.query(`ALTER ROLE ${LAB_ROLE} IN DATABASE ${LAB_DB} SET search_path = sandbox, public`);

  await resetLabPool();
  await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND usename = $2`, [LAB_DB, LAB_ROLE]);

  const lab = new Pool({ connectionString: labAdminUrl(), max: 2 });
  const c = await lab.connect();
  try {
    const db = (await c.query("SELECT current_database() AS d")).rows[0].d;
    if (db !== LAB_DB) throw new Error("Refusing to rebuild: not connected to the lab database");

    // 2. schema (destructive ONLY inside reliefflow_lab, guarded above)
    await c.query("DROP SCHEMA IF EXISTS sandbox CASCADE");
    await c.query("DROP SCHEMA IF EXISTS public CASCADE");
    await c.query("CREATE SCHEMA public");
    await c.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    for (const f of SCHEMA_FILES) {
      await c.query(sqlFile(f));
      log("schema " + f);
    }

    // 3. sanitised snapshot (triggers and FK checks disabled for a faithful copy)
    // Constraints that are NOT VALID in production (legacy rows predate them) are mirrored
    // exactly: dropped for the copy and re-added NOT VALID, so the snapshot stays faithful.
    const unvalidated = (
      await pool.query(
        `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE NOT convalidated AND connamespace = 'public'::regnamespace`,
      )
    ).rows;
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    for (const u of unvalidated) await c.query(`ALTER TABLE ${u.tbl} DROP CONSTRAINT IF EXISTS "${u.conname}"`);
    const counts: Record<string, number> = {};
    for (const { table, select } of COPY_ORDER) {
      const cols = (
        await c.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
          [table],
        )
      ).rows.map((r) => `"${r.column_name}"`);
      const src = await pool.query(`SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM (${select ?? `SELECT * FROM ${table}`}) t`);
      const rows = src.rows[0].rows as unknown[];
      counts[table] = rows.length;
      if (!rows.length) continue;
      await c.query(
        `INSERT INTO ${table} (${cols.join(",")}) OVERRIDING SYSTEM VALUE
         SELECT ${cols.join(",")} FROM json_populate_recordset(NULL::${table}, $1::json)`,
        [JSON.stringify(rows)],
      );
    }
    for (const u of unvalidated)
      await c.query(`ALTER TABLE ${u.tbl} ADD CONSTRAINT "${u.conname}" ${u.def.replace(/\s+NOT VALID$/, "")} NOT VALID`);
    await c.query("COMMIT");
    const identities = (
      await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND is_identity = 'YES'`)
    ).rows;
    for (const { table_name, column_name } of identities)
      await c.query(
        `SELECT setval(pg_get_serial_sequence('public.${table_name}', '${column_name}'), COALESCE((SELECT max(${column_name}) FROM public.${table_name}), 0) + 1, false)`,
      );
    log("snapshot copied");

    // 4. sandbox schema: scratch tables + synthetic benchmark data (clearly synthetic)
    await c.query(`
      CREATE SCHEMA sandbox;
      CREATE TABLE sandbox.lab_snapshot (taken_at TIMESTAMPTZ PRIMARY KEY DEFAULT now(), row_counts JSONB NOT NULL);
      CREATE TABLE sandbox.demo_stock (item TEXT PRIMARY KEY, qty INTEGER NOT NULL CHECK (qty >= 0), version INTEGER NOT NULL DEFAULT 1);
      INSERT INTO sandbox.demo_stock(item, qty) VALUES ('Drinking Water', 100), ('Food Packet', 100), ('Blanket', 100);

      SELECT setseed(0.42);
      CREATE TABLE sandbox.bench_warehouses (warehouse_id INTEGER PRIMARY KEY, warehouse_name TEXT NOT NULL, region TEXT NOT NULL);
      INSERT INTO sandbox.bench_warehouses
      SELECT g, 'Synthetic Depot ' || g, (ARRAY['North','South','East','West','Central'])[1 + g % 5] FROM generate_series(1, 60) g;

      CREATE TABLE sandbox.bench_movements (
        movement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        warehouse_id INTEGER NOT NULL REFERENCES sandbox.bench_warehouses,
        resource_id INTEGER NOT NULL,
        delta NUMERIC(12,3) NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL);
      INSERT INTO sandbox.bench_movements(warehouse_id, resource_id, delta, reason, created_at)
      SELECT 1 + floor(random() * 60)::int, 1 + floor(random() * 40)::int,
             round((random() * 200 - 80)::numeric, 3),
             (ARRAY['Allocation','Donation received','Stock count correction','Spoilage write-off','Transfer'])[1 + floor(random() * 5)::int],
             timestamptz '2025-01-01' + random() * interval '600 days'
        FROM generate_series(1, 300000);
      CREATE INDEX bench_mv_wh_created ON sandbox.bench_movements(warehouse_id, created_at);

      CREATE TABLE sandbox.bench_requests (
        request_id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL, priority TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
      INSERT INTO sandbox.bench_requests
      SELECT g, 1 + floor(random() * 60)::int, (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])[1 + floor(random() * 4)::int],
             timestamptz '2025-01-01' + random() * interval '600 days'
        FROM generate_series(1, 50000) g;
    `);
    await c.query(`INSERT INTO sandbox.lab_snapshot(row_counts) VALUES ($1)`, [JSON.stringify(counts)]);
    await c.query("VACUUM ANALYZE");
    log("benchmark tables built");

    // 5. privileges: DML on everything (always rolled back by the runner), ownership of
    //    sandbox objects so index/DDL demonstrations work, nothing else.
    await c.query(`
      GRANT USAGE ON SCHEMA public, sandbox TO ${LAB_ROLE};
      GRANT CREATE ON SCHEMA sandbox TO ${LAB_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON ALL TABLES IN SCHEMA public TO ${LAB_ROLE};
      GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${LAB_ROLE};
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${LAB_ROLE};
      GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO ${LAB_ROLE};
      ALTER TABLE sandbox.demo_stock OWNER TO ${LAB_ROLE};
      ALTER TABLE sandbox.bench_warehouses OWNER TO ${LAB_ROLE};
      ALTER TABLE sandbox.bench_movements OWNER TO ${LAB_ROLE};
      ALTER TABLE sandbox.bench_requests OWNER TO ${LAB_ROLE};
      GRANT SELECT ON sandbox.lab_snapshot TO ${LAB_ROLE};
    `);
    return { database: LAB_DB, role: LAB_ROLE, counts };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await lab.end();
  }
}
