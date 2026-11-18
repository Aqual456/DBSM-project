import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
loadEnvConfig(process.cwd());

// Applies JSON-schema validation (moderate: existing documents are preserved) and indexes.
async function main() {
  const { getMongoDb, getMongoClient } = await import("../src/lib/mongodb");
  const db = await getMongoDb();
  const validator = JSON.parse(readFileSync("db/mongodb/validator.json", "utf8"));
  const exists = await db.listCollections({ name: "incident_reports" }).hasNext();
  if (exists) await db.command({ collMod: "incident_reports", validator, validationLevel: "moderate", validationAction: "error" });
  else await db.createCollection("incident_reports", { validator, validationLevel: "moderate", validationAction: "error" });
  const c = db.collection("incident_reports");
  await c.createIndex({ disasterId: 1, createdAt: -1 });
  await c.createIndex({ reportType: 1, severity: 1 });
  await c.createIndex({ status: 1, createdAt: -1 }, { name: "status_recent" });
  // A collection may have only one text index; reuse it if it already exists with different weights.
  const indexes = await c.indexes();
  if (!indexes.some((i) => i.key?._fts === "text"))
    await c.createIndex({ description: "text", tags: "text", "location.label": "text" }, { name: "incident_text", weights: { description: 5, tags: 3, "location.label": 1 } });
  console.log("MongoDB incident indexes and validation ready; existing documents preserved");
  await (await getMongoClient()).close();
}
main().catch((e) => {
  console.error("MongoDB setup failed:", e.message);
  process.exit(1);
});
