import { NextResponse } from "next/server";
import { pool } from "@/lib/postgres";
import { mongoPing } from "@/lib/mongodb";
import { cachePing } from "@/lib/cache";
import { graphPing } from "@/lib/graph";
import { vectorPing } from "@/lib/vector";
import { labPing } from "@/lib/lab/sandbox";

export const dynamic = "force-dynamic";

async function postgres() {
  const t = performance.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latencyMs: +(performance.now() - t).toFixed(2) };
  } catch {
    return { ok: false };
  }
}

/**
 * Liveness/readiness. PostgreSQL is required (503 if down). MongoDB down = degraded.
 * Optional services report individually and never change the core status.
 * Only booleans and latency are exposed; no hosts, versions or error text.
 */
export async function GET() {
  const withTimeout = <T,>(p: Promise<T>, fallback: T) =>
    Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 3000))]);
  const [pg, mongo, redis, neo4j, vector, lab] = await Promise.all([
    withTimeout(postgres(), { ok: false }),
    withTimeout(mongoPing(), { ok: false }),
    withTimeout(cachePing(), { configured: true, ok: false }),
    withTimeout(graphPing(), { configured: true, ok: false }),
    withTimeout(vectorPing(), { configured: true, ok: false }),
    withTimeout(labPing(), { ok: false }),
  ]);
  const status = !pg.ok ? "down" : !mongo.ok ? "degraded" : "ok";
  return NextResponse.json(
    {
      status,
      checkedAt: new Date().toISOString(),
      services: {
        postgres: { required: true, ...pg },
        mongodb: { required: true, ...mongo },
        redis: { required: false, ...redis },
        neo4j: { required: false, ...neo4j },
        vector: { required: false, ...vector },
        lab: { required: false, ...lab },
      },
    },
    { status: pg.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
