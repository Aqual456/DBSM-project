import { NextRequest } from "next/server";
import { endpoint, actor, allRoles, body } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { requestSchema } from "@/lib/validation";

/**
 * Traces one request through the Next.js → API → validation → SQL pipeline with real
 * timings. The transaction stage runs a genuine multi-statement transaction and then
 * ROLLS BACK, so nothing is persisted.
 */
export const POST = endpoint(async (req: NextRequest) => {
  const stages: { stage: string; detail: string; ms: number; ok: boolean }[] = [];
  const time = async <T,>(stage: string, detail: string, fn: () => Promise<T> | T) => {
    const t = performance.now();
    try {
      const v = await fn();
      stages.push({ stage, detail, ms: +(performance.now() - t).toFixed(2), ok: true });
      return v;
    } catch (e) {
      stages.push({ stage, detail: `${detail} → ${(e as Error).message.split("\n")[0].slice(0, 160)}`, ms: +(performance.now() - t).toFixed(2), ok: false });
      return undefined;
    }
  };
  const raw = await time("1. Parse body", "await req.json() → JS object (malformed JSON → 400)", () => body(req));
  const u = await time("2. Authenticate & authorise", "session cookie → SHA-256 → sessions ⋈ app_users ⋈ roles", () => actor(req, allRoles));
  if (!u) return { stages };
  const opts = await pool.query(
    `SELECT (SELECT camp_id FROM relief_camps WHERE status <> 'CLOSED' LIMIT 1) AS camp_id,
            (SELECT disaster_id FROM disasters WHERE status <> 'CLOSED' LIMIT 1) AS disaster_id,
            (SELECT resource_id FROM resources LIMIT 1) AS resource_id`,
  );
  const sample = {
    camp_id: Number(opts.rows[0].camp_id),
    disaster_id: Number(opts.rows[0].disaster_id),
    need_by: new Date(Date.now() + 86400000).toISOString(),
    priority_level: "HIGH",
    items: [{ resource_id: Number(opts.rows[0].resource_id), quantity_requested: Number((raw as { quantity?: number })?.quantity ?? 25) }],
  };
  const parsed = await time("3. Validate (Zod)", `requestSchema.parse(${JSON.stringify(sample).slice(0, 120)}…)`, () => requestSchema.parse(sample));
  if (!parsed) return { stages, sample };
  const c = await pool.connect();
  try {
    await time("4. BEGIN", "pool.connect(); BEGIN", () => c.query("BEGIN"));
    await time("5. Lock parents", "SELECT … FROM relief_camps / disasters FOR SHARE", () =>
      c.query("SELECT 1 FROM relief_camps WHERE camp_id = $1 FOR SHARE", [parsed.camp_id]).then(() => c.query("SELECT 1 FROM disasters WHERE disaster_id = $1 FOR SHARE", [parsed.disaster_id])),
    );
    const id = await time("6. INSERT header (parameterised)", "INSERT INTO resource_requests(...) VALUES ($1,$2,…) RETURNING request_id", async () =>
      (
        await c.query(
          `INSERT INTO resource_requests(camp_id, disaster_id, requested_by, need_by, priority_level, remarks) VALUES ($1,$2,$3,$4,$5,'trace — rolled back') RETURNING request_id`,
          [parsed.camp_id, parsed.disaster_id, u.user_id, parsed.need_by, parsed.priority_level],
        )
      ).rows[0].request_id,
    );
    await time("7. INSERT lines", "INSERT INTO request_items … SELECT FROM unnest($2::bigint[], $3::numeric[])", () =>
      c.query(`INSERT INTO request_items SELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) x(r, q)`, [id, parsed.items.map((i) => i.resource_id), parsed.items.map((i) => i.quantity_requested)]),
    );
    await time("8. ROLLBACK", "trace mode: discard everything (a real request would COMMIT)", () => c.query("ROLLBACK"));
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
  await time("9. Serialise response", "NextResponse.json(result) with x-request-id header", () => JSON.stringify(stages));
  return { stages, sample, totalMs: +stages.reduce((s, x) => s + x.ms, 0).toFixed(2) };
});
