import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFileSync } from "fs";

// Incremental migrations, applied in order, each inside its own transaction and
// recorded in schema_migrations. 001-004 are the original bootstrap/seed files and
// are never re-run here, so existing data is untouched. All listed files are
// idempotent, so a database migrated by the previous runner is handled safely.
const MIGRATIONS = [
  "005_integrity_security.sql",
  "006_allocation_history.sql",
  "007_dbms_engineering.sql",
];

async function main() {
  const { pool } = await import("../src/lib/postgres");
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
    );
    for (const file of MIGRATIONS) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync("db/postgres/" + file, "utf8")
        .replace(/^BEGIN;\s*$/gm, "")
        .replace(/^COMMIT;\s*$/gm, "");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING", [file]);
        await client.query("COMMIT");
        console.log(`apply  ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw Object.assign(e as Error, { file });
      }
    }
    console.log("Migrations complete");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error("Migration failed:", e.file ?? "", e.code ?? "", e.message);
  process.exit(1);
});
