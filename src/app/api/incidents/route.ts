import { ObjectId, type Filter, type Document } from "mongodb";
import { endpoint, actor, HttpError, staff, body, paging } from "@/lib/api";
import { getMongoDb } from "@/lib/mongodb";
import { pool } from "@/lib/postgres";
import { incidentSchema, incidentUpdateSchema, id } from "@/lib/validation";

const severities = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const types = ["DAMAGE", "MEDICAL", "SUPPLY", "SAFETY", "GENERAL"];
const statuses = ["OPEN", "MONITORING", "RESOLVED"];

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const p = req.nextUrl.searchParams;
  const col = (await getMongoDb()).collection("incident_reports");
  const filter: Filter<Document> = {};
  if (p.get("disasterId")) filter.disasterId = id.parse(p.get("disasterId"));
  const sev = p.get("severity");
  if (sev) {
    if (!severities.includes(sev)) throw new HttpError(400, "Invalid severity", "VALIDATION_ERROR");
    filter.severity = sev;
  }
  const type = p.get("reportType");
  if (type) {
    if (!types.includes(type)) throw new HttpError(400, "Invalid report type", "VALIDATION_ERROR");
    filter.reportType = type;
  }
  const status = p.get("status");
  if (status) {
    if (!statuses.includes(status)) throw new HttpError(400, "Invalid status", "VALIDATION_ERROR");
    filter.status = status === "OPEN" ? { $in: ["OPEN", null] } : status;
  }
  const q = p.get("q")?.trim().slice(0, 200);
  if (q) filter.$text = { $search: q };

  if (p.get("stats")) {
    // Aggregation pipeline: one round trip, three facets.
    const [facets] = await col
      .aggregate([
        { $match: filter },
        {
          $facet: {
            bySeverity: [{ $group: { _id: "$severity", count: { $sum: 1 } } }],
            byType: [{ $group: { _id: "$reportType", count: { $sum: 1 } } }],
            byDisaster: [{ $group: { _id: "$disasterId", count: { $sum: 1 }, latest: { $max: "$createdAt" } } }, { $sort: { count: -1 } }, { $limit: 10 }],
            topTags: [{ $unwind: "$tags" }, { $group: { _id: "$tags", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 12 }],
            total: [{ $count: "n" }],
          },
        },
      ])
      .toArray();
    return facets;
  }

  const { page, pageSize, offset } = paging(req, 20, 100);
  const projection = q ? { score: { $meta: "textScore" } } : {};
  const sort: Document = q ? { score: { $meta: "textScore" }, createdAt: -1 } : { createdAt: -1 };
  let mode: string | null = q ? "mongodb-text-index" : null;
  let items: Document[];
  let total: number;
  try {
    [items, total] = await Promise.all([col.find(filter, { projection }).sort(sort).skip(offset).limit(pageSize).toArray(), col.countDocuments(filter)]);
  } catch (e) {
    // Text index missing (code 27, run `npm run mongo:indexes`): degrade to an escaped, case-insensitive regex search.
    if (!q || (e as { code?: number }).code !== 27) throw e;
    mode = "regex-fallback";
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    delete filter.$text;
    filter.$or = [{ description: rx }, { tags: rx }, { "location.label": rx }];
    [items, total] = await Promise.all([col.find(filter).sort({ createdAt: -1 }).skip(offset).limit(pageSize).toArray(), col.countDocuments(filter)]);
  }
  const ids = [...new Set(items.map((i) => Number(i.disasterId)))];
  const names = ids.length
    ? (await pool.query("SELECT disaster_id, disaster_name FROM disasters WHERE disaster_id = ANY($1::bigint[])", [ids])).rows
    : [];
  const byId = new Map(names.map((n) => [Number(n.disaster_id), n.disaster_name]));
  return {
    items: items.map((i) => ({ ...i, status: i.status ?? "OPEN", disasterName: byId.get(Number(i.disasterId)) ?? null })),
    total,
    page,
    pageSize,
    search: mode,
  };
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, staff);
  const d = incidentSchema.parse(await body(req));
  // Application-level referential integrity: MongoDB cannot hold a foreign key to PostgreSQL.
  if (!(await pool.query("SELECT 1 FROM disasters WHERE disaster_id = $1", [d.disasterId])).rowCount)
    throw new HttpError(400, "Unknown disaster", "INVALID_REFERENCE");
  const now = new Date();
  const doc = { ...d, tags: [...new Set(d.tags)], status: "OPEN", updates: [], reportedBy: Number(u.user_id), reporterName: u.full_name, createdAt: now, updatedAt: now };
  const r = await (await getMongoDb()).collection("incident_reports").insertOne(doc);
  return { _id: r.insertedId, ...doc };
});

export const PATCH = endpoint(async (req) => {
  const u = await actor(req, staff);
  const d = incidentUpdateSchema.parse(await body(req));
  const update: Document = { $set: { updatedAt: new Date() } };
  if (d.status) update.$set.status = d.status;
  if (d.note) update.$push = { updates: { note: d.note, by: Number(u.user_id), byName: u.full_name, at: new Date() } };
  const r = await (await getMongoDb())
    .collection("incident_reports")
    .findOneAndUpdate({ _id: new ObjectId(d.id) }, update, { returnDocument: "after" });
  if (!r) throw new HttpError(404, "Incident not found", "NOT_FOUND");
  return r;
});
