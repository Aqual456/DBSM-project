import { BSON, type CollectionInfo, type Document } from "mongodb";
const { EJSON } = BSON;
import { getMongoDb } from "../mongodb";
import { pool } from "../postgres";

/**
 * MongoDB demonstrations run in a SEPARATE database (reliefflow_lab) seeded from a copy
 * of the operational incident reports, so CRUD and validation demos never modify the
 * real incident_reports collection.
 */
const LAB = "reliefflow_lab";
type Step = { label: string; op: string; result?: unknown; error?: { code?: number | string; message: string; details?: unknown }; ms: number };

async function lab() {
  return getMongoDb(LAB);
}

export async function resetMongoLab() {
  const src = (await getMongoDb()).collection("incident_reports");
  const db = await lab();
  const docs = await src.find({}).limit(2000).toArray();
  await db.collection("incidents").drop().catch(() => undefined);
  await db.collection("disasters").drop().catch(() => undefined);
  const validator = ((await (await getMongoDb()).listCollections({ name: "incident_reports" }).toArray())[0] as CollectionInfo | undefined)?.options?.validator;
  await db.createCollection("incidents", validator ? { validator, validationLevel: "strict", validationAction: "error" } : {});
  if (docs.length) await db.collection("incidents").insertMany(docs);
  const disasters = (await pool.query("SELECT disaster_id::int AS _id, disaster_name AS name, disaster_type AS type, severity, status FROM disasters")).rows;
  if (disasters.length) await db.collection("disasters").insertMany(disasters);
  const col = db.collection("incidents");
  await col.createIndex({ disasterId: 1, createdAt: -1 });
  await col.createIndex({ reportType: 1, severity: 1 });
  await col.createIndex({ description: "text", tags: "text", "location.label": "text" }, { weights: { description: 5, tags: 3, "location.label": 1 } });
  return { incidents: docs.length, disasters: disasters.length };
}

async function step(label: string, op: string, fn: () => Promise<unknown>): Promise<Step> {
  const t = performance.now();
  try {
    const result = await fn();
    return { label, op, result: JSON.parse(EJSON.stringify(result, { relaxed: true })), ms: +(performance.now() - t).toFixed(2) };
  } catch (e) {
    const err = e as { code?: number; message: string; errInfo?: unknown };
    return { label, op, error: { code: err.code, message: err.message, details: err.errInfo }, ms: +(performance.now() - t).toFixed(2) };
  }
}

function summariseExplain(e: Document) {
  const stages: string[] = [];
  const walk = (p: Document | undefined) => {
    if (!p) return;
    stages.push(p.stage + (p.indexName ? ` (${p.indexName})` : ""));
    walk(p.inputStage);
    (p.inputStages ?? []).forEach(walk);
  };
  walk(e.queryPlanner?.winningPlan?.queryPlan ?? e.queryPlanner?.winningPlan);
  return {
    stages,
    keysExamined: e.executionStats?.totalKeysExamined,
    docsExamined: e.executionStats?.totalDocsExamined,
    returned: e.executionStats?.nReturned,
    ms: e.executionStats?.executionTimeMillis,
  };
}

export const mongoDemos: Record<string, { title: string; explain: string; run: () => Promise<Step[]> }> = {
  document: {
    title: "Document model & BSON types",
    explain: "One incident is a self-contained document: scalar fields, an EMBEDDED location sub-document, an array of tags, an embedded array of field updates, and REFERENCES (disasterId, reportedBy) to PostgreSQL rows. Extended JSON shows the BSON types ($oid, $date, $numberInt…).",
    run: async () => {
      const c = (await lab()).collection("incidents");
      return [
        await step("Sample document (Extended JSON)", "db.incidents.findOne({ updates: { $ne: [] } })", () => c.findOne({ "updates.0": { $exists: true } }).then((d) => d ?? c.findOne())),
        await step("Field types across the collection", "aggregate([$project {$type}])", () =>
          c.aggregate([{ $limit: 1 }, { $project: { _id: { $type: "$_id" }, disasterId: { $type: "$disasterId" }, location: { $type: "$location" }, tags: { $type: "$tags" }, createdAt: { $type: "$createdAt" }, updates: { $type: "$updates" } } }]).toArray(),
        ),
      ];
    },
  },
  crud: {
    title: "CRUD operations",
    explain: "insertOne → find → updateOne ($set on an embedded field, $push into an embedded array) → deleteOne. Each step shows the server's acknowledgement.",
    run: async () => {
      const c = (await lab()).collection("incidents");
      const any = await c.findOne({}, { projection: { disasterId: 1 } });
      const disasterId = any?.disasterId ?? 1;
      const now = new Date();
      const doc = { disasterId, reportedBy: 1, reportType: "GENERAL", description: "Lab CRUD demonstration document created by the DBMS lab.", location: { label: "Lab sandbox" }, severity: "LOW", tags: ["lab"], status: "OPEN", updates: [], createdAt: now, updatedAt: now };
      const ins = await step("Create", "db.incidents.insertOne({...})", () => c.insertOne(doc));
      const id = (ins.result as { insertedId?: { $oid: string } })?.insertedId;
      const { ObjectId } = await import("mongodb");
      const oid = id ? new ObjectId(id.$oid) : undefined;
      return [
        ins,
        await step("Read", "db.incidents.findOne({ _id })", () => c.findOne({ _id: oid })),
        await step("Update (embedded + array)", "updateOne({_id}, {$set: {'location.label': …, status}, $push: {updates: {...}}})", () =>
          c.updateOne({ _id: oid }, { $set: { "location.label": "Lab sandbox — ward 2", status: "MONITORING", updatedAt: new Date() }, $push: { updates: { note: "Verified by lab", by: 1, at: new Date() } } } as Document),
        ),
        await step("Read after update", "db.incidents.findOne({ _id }, { projection })", () => c.findOne({ _id: oid }, { projection: { location: 1, status: 1, updates: 1 } })),
        await step("Delete", "db.incidents.deleteOne({ _id })", () => c.deleteOne({ _id: oid })),
      ];
    },
  },
  validation: {
    title: "Schema validation ($jsonSchema)",
    explain: "MongoDB is schema-flexible, but a collection can enforce a JSON Schema. These inserts violate it (bad enum, short description, missing field) and are rejected with error 121 and a detailed explanation.",
    run: async () => {
      const db = await lab();
      const c = db.collection("incidents");
      const info = (await db.listCollections({ name: "incidents" }).toArray())[0] as CollectionInfo | undefined;
      const base = { disasterId: 1, reportedBy: 1, reportType: "GENERAL", description: "A valid looking description", location: { label: "Ward 1" }, severity: "LOW", createdAt: new Date(), updatedAt: new Date() };
      return [
        await step("Active validator", "db.getCollectionInfos({name:'incidents'})", async () => ({ validationLevel: info?.options?.validationLevel, required: info?.options?.validator?.$jsonSchema?.required })),
        await step("Invalid severity enum", "insertOne({ severity: 'APOCALYPTIC' })", () => c.insertOne({ ...base, severity: "APOCALYPTIC" })),
        await step("Description too short", "insertOne({ description: 'help' })", () => c.insertOne({ ...base, description: "help" })),
        await step("Missing required field", "insertOne({ /* no location */ })", () => {
          const { location: _l, ...rest } = base;
          void _l;
          return c.insertOne(rest);
        }),
      ];
    },
  },
  indexes: {
    title: "Indexes & query plans",
    explain: "explain('executionStats') shows the winning plan. With the compound index {reportType, severity} the query is an IXSCAN; forcing a collection scan ($natural hint) examines every document.",
    run: async () => {
      const c = (await lab()).collection("incidents");
      return [
        await step("Indexes on the collection", "db.incidents.getIndexes()", () => c.indexes()),
        await step("Compound index used", "find({reportType:'MEDICAL', severity:'CRITICAL'}).explain()", async () =>
          summariseExplain(await c.find({ reportType: "MEDICAL", severity: "CRITICAL" }).explain("executionStats")),
        ),
        await step("Forced collection scan", "find(...).hint({$natural:1}).explain()", async () =>
          summariseExplain(await c.find({ reportType: "MEDICAL", severity: "CRITICAL" }).hint({ $natural: 1 }).explain("executionStats")),
        ),
        await step("Text index used", "find({$text:{$search:'water contaminated'}}).explain()", async () =>
          summariseExplain(await c.find({ $text: { $search: "water contaminated" } }).explain("executionStats")),
        ),
      ];
    },
  },
  text: {
    title: "Text search with relevance",
    explain: "The weighted text index (description × 5, tags × 3, location × 1) supports stemming and relevance scoring via $meta: 'textScore'.",
    run: async () => {
      const c = (await lab()).collection("incidents");
      return [
        await step("Search 'flood water children'", "find({$text:{$search:'flood water children'}}, {score:{$meta:'textScore'}}).sort(score)", () =>
          c.find({ $text: { $search: "flood water children" } }, { projection: { description: 1, tags: 1, score: { $meta: "textScore" } } }).sort({ score: { $meta: "textScore" } }).limit(5).toArray(),
        ),
        await step("Phrase and exclusion", "{$search: '\"road closure\" -convoy'}", () =>
          c.find({ $text: { $search: '"road" -convoy' } }, { projection: { description: 1, score: { $meta: "textScore" } } }).sort({ score: { $meta: "textScore" } }).limit(5).toArray(),
        ),
      ];
    },
  },
  aggregation: {
    title: "Aggregation pipelines & $lookup",
    explain: "Pipelines transform documents stage by stage. $lookup joins the disasters collection (a REFERENCE relationship); $unwind + $group computes tag frequencies; $bucket groups by time.",
    run: async () => {
      const c = (await lab()).collection("incidents");
      return [
        await step(
          "Incidents per disaster with severity breakdown ($group → $lookup)",
          "aggregate([$group, $lookup, $project, $sort])",
          () =>
            c
              .aggregate([
                { $group: { _id: "$disasterId", total: { $sum: 1 }, critical: { $sum: { $cond: [{ $eq: ["$severity", "CRITICAL"] }, 1, 0] } }, types: { $addToSet: "$reportType" } } },
                { $lookup: { from: "disasters", localField: "_id", foreignField: "_id", as: "disaster" } },
                { $project: { _id: 0, disaster: { $first: "$disaster.name" }, total: 1, critical: 1, types: 1 } },
                { $sort: { critical: -1, total: -1 } },
              ])
              .toArray(),
        ),
        await step("Top tags ($unwind → $group → $sort)", "aggregate([$unwind:'$tags', $group, $sort, $limit])", () =>
          c.aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 10 }]).toArray(),
        ),
        await step("Status by report type ($facet)", "aggregate([$facet])", () =>
          c.aggregate([{ $facet: { byStatus: [{ $group: { _id: { $ifNull: ["$status", "OPEN"] }, n: { $sum: 1 } } }], byType: [{ $group: { _id: "$reportType", n: { $sum: 1 } } }] } }]).toArray(),
        ),
      ];
    },
  },
};

export async function runMongoDemo(id: string) {
  const d = mongoDemos[id];
  if (!d) throw Object.assign(new Error("Unknown demo"), { status: 404 });
  const db = await lab();
  if (!(await db.listCollections({ name: "incidents" }).hasNext())) await resetMongoLab();
  return { id, title: d.title, explain: d.explain, steps: await d.run() };
}
