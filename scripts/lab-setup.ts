import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { buildLab } = await import("../src/lib/lab/setup");
  const { pool } = await import("../src/lib/postgres");
  const { resetLabPool } = await import("../src/lib/lab/sandbox");
  const r = await buildLab((m) => console.log("  " + m));
  console.log(`Lab database '${r.database}' ready (role ${r.role}). Snapshot rows:`, r.counts);
  await resetLabPool();
  await pool.end();
}
main().catch((e) => {
  console.error("Lab setup failed:", e.code ?? "", e.message);
  process.exit(1);
});
