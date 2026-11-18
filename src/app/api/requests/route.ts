import { endpoint, actor, transaction, audit, HttpError, managers, staff, body } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { requestSchema, requestStatusSchema, id, canTransition } from "@/lib/validation";

const LIST_SQL = `
  SELECT rr.request_id, rr.camp_id, rr.disaster_id, rr.requested_at, rr.need_by, rr.priority_score,
         rr.priority_level, rr.status, rr.medical_emergency, rr.remarks,
         c.camp_name, d.disaster_name, u.full_name AS requested_by_name,
         (SELECT count(*)::int FROM request_items WHERE request_id = rr.request_id) AS item_count,
         request_fulfillment_pct(rr.request_id) AS fulfillment_pct,
         (SELECT json_agg(v ORDER BY v.resource_name) FROM v_request_fulfillment v WHERE v.request_id = rr.request_id) AS items
    FROM resource_requests rr
    JOIN relief_camps c USING (camp_id)
    JOIN disasters d USING (disaster_id)
    JOIN app_users u ON u.user_id = rr.requested_by`;

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const p = req.nextUrl.searchParams;
  if (p.get("id")) {
    const requestId = id.parse(p.get("id"));
    const [r, allocations, deliveries, history] = await Promise.all([
      pool.query(`${LIST_SQL} WHERE rr.request_id = $1`, [requestId]),
      pool.query(
        `SELECT a.allocation_id, a.status, a.allocated_at, a.remarks, u.full_name AS allocated_by_name,
                json_agg(json_build_object('resource_name', r.resource_name, 'unit', r.unit, 'warehouse_name', w.warehouse_name,
                         'quantity', ai.quantity_allocated) ORDER BY r.resource_name) AS items
           FROM allocations a
           JOIN app_users u ON u.user_id = a.allocated_by
           JOIN allocation_items ai USING (allocation_id)
           JOIN resources r ON r.resource_id = ai.resource_id
           JOIN warehouses w ON w.warehouse_id = ai.warehouse_id
          WHERE a.request_id = $1
          GROUP BY a.allocation_id, u.full_name ORDER BY a.allocation_id`,
        [requestId],
      ),
      pool.query(
        `SELECT d.delivery_id, d.allocation_id, d.status, d.departure_time, d.expected_arrival, d.actual_arrival,
                v.vehicle_number, u.full_name AS driver_name
           FROM deliveries d JOIN allocations a USING (allocation_id)
           JOIN vehicles v USING (vehicle_id) JOIN app_users u ON u.user_id = d.driver_id
          WHERE a.request_id = $1 ORDER BY d.delivery_id`,
        [requestId],
      ),
      pool.query(
        `SELECT changed_at, changed_fields, u.full_name AS changed_by_name
           FROM data_change_log l LEFT JOIN app_users u ON u.user_id = l.changed_by
          WHERE table_name = 'resource_requests' AND (row_data->>'request_id')::bigint = $1
          ORDER BY change_id`,
        [requestId],
      ),
    ]);
    if (!r.rowCount) throw new HttpError(404, "Request not found", "NOT_FOUND");
    return { ...r.rows[0], allocations: allocations.rows, deliveries: deliveries.rows, history: history.rows };
  }
  const where: string[] = [];
  const values: unknown[] = [];
  const status = p.get("status");
  if (status && /^[A-Z_]{3,25}$/.test(status)) {
    values.push(status);
    where.push(`rr.status = $${values.length}`);
  }
  const q = p.get("q")?.trim().slice(0, 200);
  if (q) {
    values.push(q);
    where.push(`(rr.search_vector @@ websearch_to_tsquery('english', $${values.length}) OR c.camp_name ILIKE '%' || $${values.length} || '%' OR d.disaster_name ILIKE '%' || $${values.length} || '%')`);
  }
  return (
    await pool.query(
      `${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY CASE WHEN rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED') THEN 0 ELSE 1 END,
                rr.priority_score DESC, rr.need_by LIMIT 500`,
      values,
    )
  ).rows;
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, staff);
  const d = requestSchema.parse(await body(req));
  return transaction(async (c) => {
    // Lock parents in a fixed order (camp, then disaster) so concurrent closures cannot interleave.
    const camp = await c.query(`SELECT status FROM relief_camps WHERE camp_id = $1 FOR SHARE`, [d.camp_id]);
    const disaster = await c.query(`SELECT status FROM disasters WHERE disaster_id = $1 FOR SHARE`, [d.disaster_id]);
    if (!camp.rowCount || !disaster.rowCount) throw new HttpError(400, "Unknown camp or disaster", "INVALID_REFERENCE");
    if (camp.rows[0].status === "CLOSED" || disaster.rows[0].status === "CLOSED")
      throw new HttpError(409, "Camp or disaster is closed", "BUSINESS_RULE");
    const known = await c.query("SELECT count(*)::int AS n FROM resources WHERE resource_id = ANY($1::bigint[])", [
      d.items.map((i) => i.resource_id),
    ]);
    if (known.rows[0].n !== d.items.length) throw new HttpError(400, "Unknown resource in request", "INVALID_REFERENCE");
    const r = await c.query(
      `INSERT INTO resource_requests(camp_id, disaster_id, requested_by, need_by, priority_score, priority_level, medical_emergency, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING request_id, camp_id, disaster_id, requested_by, requested_at, need_by, priority_score, priority_level, status, medical_emergency, remarks`,
      [d.camp_id, d.disaster_id, u.user_id, d.need_by, d.priority_score, d.priority_level, d.medical_emergency, d.remarks],
    );
    // Multi-row insert of request lines inside the same transaction (all-or-nothing).
    await c.query(
      `INSERT INTO request_items(request_id, resource_id, quantity_requested)
       SELECT $1, x.resource_id, x.quantity FROM unnest($2::bigint[], $3::numeric[]) AS x(resource_id, quantity)`,
      [r.rows[0].request_id, d.items.map((i) => i.resource_id), d.items.map((i) => i.quantity_requested)],
    );
    await audit(c, u, "REQUEST_CREATED", { id: r.rows[0].request_id, items: d.items.length });
    return r.rows[0];
  }, u);
});

export const PATCH = endpoint(async (req) => {
  const u = await actor(req, managers);
  const d = requestStatusSchema.parse(await body(req));
  return transaction(async (c) => {
    const r = (await c.query("SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE", [d.request_id])).rows[0];
    if (!r) throw new HttpError(404, "Request not found", "NOT_FOUND");
    if (!canTransition("request", r.status, d.status))
      throw new HttpError(409, `Invalid request transition ${r.status} → ${d.status}`, "INVALID_TRANSITION");
    if ((await c.query(`SELECT 1 FROM allocations WHERE request_id = $1 AND status <> 'CANCELLED'`, [d.request_id])).rowCount)
      throw new HttpError(409, "Allocated requests cannot be cancelled", "BUSINESS_RULE");
    await c.query("UPDATE resource_requests SET status = $1 WHERE request_id = $2", [d.status, d.request_id]);
    await audit(c, u, "REQUEST_STATUS", { requestId: d.request_id, from: r.status, status: d.status });
    return { updated: true, request_id: d.request_id, status: d.status };
  }, u);
});
