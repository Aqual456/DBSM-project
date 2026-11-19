import { endpoint, actor, staff, HttpError } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { id } from "@/lib/validation";

const HAVERSINE = (a: string, b: string) => `
  CASE WHEN ${a}.latitude IS NULL OR ${b}.latitude IS NULL THEN NULL ELSE
  round((6371 * 2 * asin(sqrt(power(sin(radians(${b}.latitude - ${a}.latitude) / 2), 2) +
        cos(radians(${a}.latitude)) * cos(radians(${b}.latitude)) * power(sin(radians(${b}.longitude - ${a}.longitude) / 2), 2))))::numeric, 1) END`;

/**
 * Explainable allocation recommendations. Nothing is ever allocated here: the
 * coordinator reviews the suggestion and submits it through the normal, validated
 * allocation endpoint.
 */
async function recommend(requestId: number) {
  const head = (
    await pool.query(
      `SELECT rr.request_id, rr.status, rr.priority_level, rr.medical_emergency, rr.need_by, c.camp_name, l.location_name,
              l.latitude, l.longitude
         FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN locations l ON l.location_id = c.location_id
        WHERE rr.request_id = $1`,
      [requestId],
    )
  ).rows[0];
  if (!head) throw new HttpError(404, "Request not found", "NOT_FOUND");
  const lines = (
    await pool.query(
      `SELECT f.resource_id, f.resource_name, r.unit, f.quantity_requested::float AS requested, f.quantity_remaining::float AS remaining,
              COALESCE(json_agg(json_build_object(
                 'warehouse_id', w.warehouse_id, 'warehouse_name', w.warehouse_name, 'location_id', wl.location_id, 'location_name', wl.location_name,
                 'available', i.quantity_available::float, 'threshold', i.minimum_threshold::float,
                 'distance_km', ${HAVERSINE("cl", "wl")})
               ORDER BY i.quantity_available DESC) FILTER (WHERE w.warehouse_id IS NOT NULL), '[]') AS candidates
         FROM v_request_fulfillment f
         JOIN resources r USING (resource_id)
         JOIN resource_requests rr ON rr.request_id = f.request_id
         JOIN relief_camps c ON c.camp_id = rr.camp_id
         JOIN locations cl ON cl.location_id = c.location_id
         LEFT JOIN inventory i ON i.resource_id = f.resource_id AND i.quantity_available > 0
         LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id AND w.status = 'ACTIVE'
         LEFT JOIN locations wl ON wl.location_id = w.location_id
        WHERE f.request_id = $1
        GROUP BY f.resource_id, f.resource_name, r.unit, f.quantity_requested, f.quantity_remaining
        ORDER BY f.resource_name`,
      [requestId],
    )
  ).rows;
  type Cand = { warehouse_id: number; warehouse_name: string; location_id: number; location_name: string; available: number; threshold: number; distance_km: number | null };
  const recs: { resource_id: number; remaining: number; unit: string; candidates: (Cand & { suggested_quantity: number; full: boolean; keepsBuffer: boolean; score: number; reasons: string[] })[]; [k: string]: unknown }[] = lines.map((l) => {
    const cands = (l.candidates as Cand[]).filter((c) => c.available > 0);
    const scored = cands
      .map((c) => {
        const qty = Math.min(l.remaining, c.available);
        const full = c.available >= l.remaining;
        const keepsBuffer = c.available - qty >= c.threshold;
        const score = (full ? 50 : 25 * (qty / Math.max(l.remaining, 1))) + (keepsBuffer ? 20 : 0) + (c.distance_km == null ? 5 : Math.max(0, 30 - c.distance_km / 20));
        const reasons = [
          full ? `covers the full outstanding ${l.remaining} ${l.unit}` : `covers ${qty} of ${l.remaining} ${l.unit} (partial)`,
          keepsBuffer ? `stays above its low-stock threshold (${c.threshold})` : `would drop below its threshold (${c.threshold})`,
          c.distance_km == null ? "distance unknown (missing coordinates)" : `${c.distance_km} km from the camp`,
        ];
        return { ...c, suggested_quantity: +qty.toFixed(3), full, keepsBuffer, score: +score.toFixed(1), reasons };
      })
      .sort((a, b) => b.score - a.score);
    return { ...l, candidates: scored.slice(0, 4), status: l.remaining <= 0 ? "FULFILLED" : scored.length ? "OPTIONS" : "NO_STOCK" };
  });
  // Deliveries require one pickup location per allocation: suggest the best single source.
  const byLocation = new Map<number, { location_name: string; covered: number; lines: { resource_id: number; warehouse_id: number; quantity: number }[]; distance: number | null }>();
  for (const r of recs.filter((x) => x.remaining > 0)) // only lines still outstanding
    for (const c of r.candidates) {
      const cur = byLocation.get(c.location_id) ?? { location_name: c.location_name, covered: 0, lines: [], distance: c.distance_km };
      if (!cur.lines.some((x) => x.resource_id === r.resource_id)) {
        cur.lines.push({ resource_id: r.resource_id, warehouse_id: c.warehouse_id, quantity: c.suggested_quantity });
        if (c.full) cur.covered++;
      }
      byLocation.set(c.location_id, cur);
    }
  const best = [...byLocation.entries()]
    .map(([location_id, v]) => ({ location_id, ...v }))
    .sort((a, b) => b.lines.length - a.lines.length || b.covered - a.covered || (a.distance ?? 1e9) - (b.distance ?? 1e9))[0];
  return { request: head, lines: recs, bestSingleSource: best ?? null, note: "Recommendations are advisory. Submitting them still goes through stock and demand validation." };
}

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const rid = req.nextUrl.searchParams.get("requestId");
  if (rid) return recommend(id.parse(rid));
  const [shortages, excess, priority, byLocation, coverage] = await Promise.all([
    pool.query(`SELECT * FROM v_resource_demand WHERE outstanding_demand > 0 ORDER BY net_position ASC`),
    pool.query(
      `SELECT w.warehouse_name, l.location_name, r.resource_name, r.unit, i.quantity_available::float AS available, i.minimum_threshold::float AS threshold,
              round(i.quantity_available / NULLIF(i.minimum_threshold, 0), 1)::float AS times_threshold
         FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id) JOIN locations l ON l.location_id = w.location_id
         JOIN v_resource_demand d ON d.resource_id = i.resource_id
        WHERE w.status = 'ACTIVE' AND i.quantity_available > 3 * GREATEST(i.minimum_threshold, 1) AND d.net_position > 0
        ORDER BY times_threshold DESC NULLS LAST LIMIT 15`,
    ),
    pool.query(
      `SELECT rr.request_id, rr.priority_level, rr.priority_score, rr.medical_emergency, rr.status, rr.need_by, c.camp_name, d.disaster_name,
              request_fulfillment_pct(rr.request_id)::float AS fulfillment_pct,
              round(extract(epoch FROM rr.need_by - now()) / 3600)::int AS hours_left
         FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN disasters d USING (disaster_id)
        WHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED') AND (rr.priority_level IN ('CRITICAL','HIGH') OR rr.medical_emergency)
        ORDER BY rr.medical_emergency DESC, rr.priority_score DESC, rr.need_by LIMIT 20`,
    ),
    pool.query(
      `SELECT l.location_name, c.category_name, sum(i.quantity_available)::float AS units
         FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN locations l ON l.location_id = w.location_id
         JOIN resources r USING (resource_id) JOIN resource_categories c USING (category_id)
        WHERE w.status = 'ACTIVE' GROUP BY l.location_name, c.category_name ORDER BY l.location_name, c.category_name`,
    ),
    pool.query(
      `SELECT d.disaster_name, d.severity, sum(f.quantity_requested)::float AS requested, sum(f.quantity_allocated)::float AS allocated
         FROM v_request_fulfillment f JOIN resource_requests rr USING (request_id) JOIN disasters d USING (disaster_id)
        WHERE rr.status NOT IN ('REJECTED','CANCELLED') GROUP BY d.disaster_name, d.severity ORDER BY requested DESC`,
    ),
  ]);
  return { shortages: shortages.rows, excess: excess.rows, priority: priority.rows, byLocation: byLocation.rows, coverage: coverage.rows };
});
