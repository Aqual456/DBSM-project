import { z } from "zod";
import { endpoint, actor, staff, managers, body, HttpError } from "@/lib/api";
import { graphConfigured, graphPing, graphQueries, lastSync, runGraphQuery, syncGraph, type GraphQueryId } from "@/lib/graph";

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const p = req.nextUrl.searchParams;
  const q = p.get("query");
  if (!q) {
    const [ping, runs] = await Promise.all([graphPing(), lastSync("neo4j")]);
    return {
      ...ping,
      configured: graphConfigured(),
      runs,
      queries: Object.entries(graphQueries).map(([id, d]) => ({ id, title: d.title, cypher: d.cypher, params: d.params })),
    };
  }
  if (!Object.hasOwn(graphQueries, q)) throw new HttpError(400, "Unknown graph query", "VALIDATION_ERROR");
  if (!graphConfigured()) throw new HttpError(503, "Neo4j is not configured (set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)", "SERVICE_DISABLED");
  const params = z
    .object({ disasterId: z.coerce.number().int().positive().optional(), warehouseId: z.coerce.number().int().positive().optional() })
    .parse({ disasterId: p.get("disasterId") ?? undefined, warehouseId: p.get("warehouseId") ?? undefined });
  try {
    return await runGraphQuery(q as GraphQueryId, params as Record<string, number>);
  } catch (e) {
    if ((e as { code?: string }).code?.startsWith("Neo.ClientError.Statement"))
      throw new HttpError(400, "Graph query failed", "GRAPH_QUERY_FAILED");
    throw new HttpError(503, "Neo4j is unavailable", "SERVICE_UNAVAILABLE");
  }
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, managers);
  await body(req);
  if (!graphConfigured()) throw new HttpError(503, "Neo4j is not configured", "SERVICE_DISABLED");
  return syncGraph(u.user_id);
});
