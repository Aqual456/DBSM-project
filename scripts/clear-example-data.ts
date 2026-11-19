import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

/**
 * DESTRUCTIVE: removes all operational / example data so a clean dataset can be loaded.
 *   npx tsx scripts/clear-example-data.ts --yes
 * Take a backup first (pg_dump + mongodump). What it removes:
 *   - every disaster, location, camp, warehouse, resource, category, stock line, request,
 *     allocation, delivery, vehicle, volunteer, and the history/audit rows describing them
 *     (TRUNCATE ... RESTART IDENTITY, so ids start again at 1);
 *   - sample staff accounts only (e-mail ending @reliefflow.demo or @reliefflow.sample);
 *   - all MongoDB incident reports, all pgvector embeddings, cached dashboard values.
 * What it keeps: roles, every other user account and its sessions, schema_migrations.
 */
const OPERATIONAL = [
  "delivery_volunteers", "deliveries", "allocation_items", "allocations", "request_items", "resource_requests",
  "inventory_movements", "inventory", "warehouses", "relief_camps", "disaster_locations", "disasters",
  "vehicles", "volunteers", "resources", "resource_categories", "locations",
  "audit_logs", "data_change_log", "integration_sync_runs",
];
const SAMPLE_STAFF = "email LIKE '%@reliefflow.demo' OR email LIKE '%@reliefflow.sample'";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This deletes all operational data. Re-run with --yes after taking a backup.");
    process.exit(2);
  }
  const { pool } = await import("../src/lib/postgres");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`TRUNCATE ${OPERATIONAL.join(", ")} RESTART IDENTITY`);
    const staff = await c.query(`DELETE FROM app_users WHERE ${SAMPLE_STAFF} RETURNING email`);
    await c.query("TRUNCATE data_change_log RESTART IDENTITY"); // drop the log rows the user deletion just wrote
    await c.query("COMMIT");
    console.log(`PostgreSQL: ${OPERATIONAL.length} tables emptied, ${staff.rowCount} sample staff accounts removed.`);
    const kept = (await c.query("SELECT email FROM app_users ORDER BY user_id")).rows.map((r) => r.email);
    console.log("Accounts kept:", kept.join(", "));
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }

  const { getMongoDb, getMongoClient } = await import("../src/lib/mongodb");
  const removed = await (await getMongoDb()).collection("incident_reports").deleteMany({});
  console.log(`MongoDB: ${removed.deletedCount} incident reports removed.`);
  await (await getMongoClient()).close();

  if (process.env.VECTOR_DATABASE_URL) {
    const { Client } = await import("pg");
    const v = new Client({ connectionString: process.env.VECTOR_DATABASE_URL });
    await v.connect();
    const r = await v.query("DELETE FROM document_vectors").catch(() => ({ rowCount: 0 }));
    console.log(`pgvector: ${r.rowCount} embeddings removed.`);
    await v.end();
  }
  const { cacheInvalidate } = await import("../src/lib/cache");
  await cacheInvalidate("rf:cache:").catch(() => undefined);
  console.log("Cache cleared. Load the standard dataset with: npm run db:seed");
  process.exit(0);
}
main().catch((e) => {
  console.error("Clean-up failed (PostgreSQL changes rolled back):", e.message);
  process.exit(1);
});
