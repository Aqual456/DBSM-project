import { endpoint, actor, managers, staff, transaction, audit, HttpError, body } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { disasterSchema, id } from "@/lib/validation";

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const params = req.nextUrl.searchParams;
  if (params.get("id")) {
    const disasterId = id.parse(params.get("id"));
    const [d, locations, camps, requests] = await Promise.all([
      pool.query(
        `SELECT s.*, d.description, d.event_location_id, l.location_name, l.latitude, l.longitude
           FROM v_disaster_response_summary s JOIN disasters d USING (disaster_id)
           LEFT JOIN locations l ON l.location_id = d.event_location_id
          WHERE s.disaster_id = $1`,
        [disasterId],
      ),
      pool.query(
        `SELECT dl.*, l.location_name, l.location_type, l.latitude, l.longitude
           FROM disaster_locations dl JOIN locations l USING (location_id)
          WHERE dl.disaster_id = $1 ORDER BY dl.affected_population DESC`,
        [disasterId],
      ),
      pool.query(
        `SELECT c.camp_id, c.camp_name, c.capacity, c.current_population, c.status, l.location_name
           FROM relief_camps c JOIN locations l USING (location_id)
          WHERE c.location_id IN (SELECT location_id FROM disaster_locations WHERE disaster_id = $1)
          ORDER BY c.camp_name`,
        [disasterId],
      ),
      pool.query(
        `SELECT rr.request_id, rr.status, rr.priority_level, rr.need_by, c.camp_name,
                request_fulfillment_pct(rr.request_id) AS fulfillment_pct
           FROM resource_requests rr JOIN relief_camps c USING (camp_id)
          WHERE rr.disaster_id = $1 ORDER BY rr.requested_at DESC LIMIT 50`,
        [disasterId],
      ),
    ]);
    if (!d.rowCount) throw new HttpError(404, "Disaster not found", "NOT_FOUND");
    return { ...d.rows[0], locations: locations.rows, camps: camps.rows, requests: requests.rows };
  }
  const q = params.get("q")?.trim().slice(0, 200);
  const r = await pool.query(
    `SELECT d.disaster_id, d.disaster_name, d.disaster_type, d.severity, d.status, d.started_at, d.ended_at,
            d.description, d.event_location_id, d.created_at, l.location_name,
            s.affected_population, s.affected_locations, s.open_requests, s.total_requests,
            ${q ? "ts_rank(d.search_vector, websearch_to_tsquery('english', $1))" : "NULL::real"} AS rank
       FROM disasters d
       JOIN v_disaster_response_summary s USING (disaster_id)
       LEFT JOIN locations l ON l.location_id = d.event_location_id
      ${q ? "WHERE d.search_vector @@ websearch_to_tsquery('english', $1) OR d.disaster_name ILIKE '%' || $1 || '%'" : ""}
      ORDER BY ${q ? "rank DESC NULLS LAST," : ""} d.created_at DESC
      LIMIT 500`,
    q ? [q] : [],
  );
  return r.rows;
});

async function save(req: Parameters<typeof actor>[0], edit: boolean) {
  const u = await actor(req, managers);
  const raw = await body(req);
  const { disaster_id: rawId, ...fields } = raw;
  const disasterId = edit ? id.parse(rawId) : undefined;
  if (!edit && rawId !== undefined) throw new HttpError(400, "disaster_id is not allowed when creating", "VALIDATION_ERROR");
  const d = disasterSchema.parse(fields);
  return transaction(async (c) => {
    if (!(await c.query("SELECT 1 FROM locations WHERE location_id = $1", [d.event_location_id])).rowCount)
      throw new HttpError(400, "Unknown event location", "INVALID_REFERENCE");
    const values = [d.disaster_name, d.disaster_type, d.severity, d.started_at, d.description, d.event_location_id, d.status];
    const r = edit
      ? await c.query(
          `UPDATE disasters
              SET disaster_name=$1, disaster_type=$2, severity=$3, started_at=$4, description=$5,
                  event_location_id=$6, status=$7::varchar,
                  ended_at = CASE WHEN $7::varchar = 'CLOSED' THEN COALESCE(ended_at, GREATEST(now(), $4::timestamptz)) ELSE NULL END
            WHERE disaster_id=$8 RETURNING *`,
          [...values, disasterId],
        )
      : await c.query(
          `INSERT INTO disasters(disaster_name, disaster_type, severity, started_at, description, event_location_id, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [...values, u.user_id],
        );
    if (!r.rowCount) throw new HttpError(404, "Disaster not found", "NOT_FOUND");
    if (!edit)
      await c.query(
        `INSERT INTO disaster_locations(disaster_id, location_id, impact_level, affected_population)
         VALUES ($1, $2, 'MODERATE', 0) ON CONFLICT DO NOTHING`,
        [r.rows[0].disaster_id, d.event_location_id],
      );
    await audit(c, u, edit ? "DISASTER_UPDATED" : "DISASTER_CREATED", { id: r.rows[0].disaster_id, status: d.status });
    const { search_vector: _sv, ...row } = r.rows[0];
    void _sv;
    return row;
  }, u);
}
export const POST = endpoint((req) => save(req, false));
export const PATCH = endpoint((req) => save(req, true));
