import { z } from "zod";
import { endpoint, actor, staff, managers, body, HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/cache";
import { resolveProvider } from "@/lib/embeddings";
import { lastSync } from "@/lib/graph";
import { explainVectorSearch, semanticSearch, syncVectors, vectorConfigured, vectorPing, vectorStats } from "@/lib/vector";
import { getMongoDb } from "@/lib/mongodb";

export const GET = endpoint(async (req) => {
  const u = await actor(req, staff);
  const p = req.nextUrl.searchParams;
  const q = p.get("q")?.trim();
  if (!q) {
    const ping = await vectorPing();
    const [stats, runs, plan] = ping.ok
      ? await Promise.all([vectorStats(), lastSync("vector"), explainVectorSearch().catch(() => null)])
      : [null, await lastSync("vector"), null];
    return { ...ping, configured: vectorConfigured(), provider: await resolveProvider(), stats, runs, plan };
  }
  if (!vectorConfigured()) throw new HttpError(503, "Vector store is not configured (set VECTOR_DATABASE_URL)", "SERVICE_DISABLED");
  const limit = await rateLimit(`rf:rl:vector:${u.user_id}`, 30, 60);
  if (!limit.allowed) throw new HttpError(429, "Too many searches. Wait a minute", "RATE_LIMITED");
  const query = z.string().min(2).max(300).parse(q);
  const source = z.enum(["incident", "disaster", "request"]).optional().parse(p.get("source") ?? undefined);
  const vector = await semanticSearch(query, 8, source);
  // Side-by-side keyword search (MongoDB $text) for comparison.
  let keyword: unknown[] | null = null;
  try {
    keyword = await (await getMongoDb())
      .collection("incident_reports")
      .find({ $text: { $search: query } }, { projection: { score: { $meta: "textScore" }, description: 1, reportType: 1, severity: 1, "location.label": 1 } })
      .sort({ score: { $meta: "textScore" } })
      .limit(8)
      .toArray();
  } catch {
    keyword = null;
  }
  return { ...vector, keyword };
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, managers);
  await body(req);
  if (!vectorConfigured()) throw new HttpError(503, "Vector store is not configured", "SERVICE_DISABLED");
  return syncVectors(u.user_id);
});
