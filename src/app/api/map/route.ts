import { endpoint, actor, staff } from "@/lib/api";
import { pool } from "@/lib/postgres";

/** Geographic layer: every marker comes from stored coordinates; rows without coordinates are reported, not guessed. */
export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const [disasters, camps, warehouses, missing] = await Promise.all([
    pool.query(
      `SELECT d.disaster_id, d.disaster_name, d.disaster_type, d.severity, d.status, l.location_name,
              l.latitude::float AS lat, l.longitude::float AS lon, s.affected_population, s.open_requests,
              (SELECT json_agg(json_build_object('location_name', al.location_name, 'lat', al.latitude::float, 'lon', al.longitude::float,
                                                 'impact', dl.impact_level, 'population', dl.affected_population))
                 FROM disaster_locations dl JOIN locations al USING (location_id)
                WHERE dl.disaster_id = d.disaster_id AND al.latitude IS NOT NULL) AS affected
         FROM disasters d JOIN v_disaster_response_summary s USING (disaster_id)
         LEFT JOIN locations l ON l.location_id = d.event_location_id
        WHERE l.latitude IS NOT NULL`,
    ),
    pool.query(
      `SELECT c.camp_id, c.camp_name, c.status, c.capacity, c.current_population, l.location_name, l.latitude::float AS lat, l.longitude::float AS lon,
              (SELECT count(*)::int FROM resource_requests rr WHERE rr.camp_id = c.camp_id AND rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')) AS open_requests
         FROM relief_camps c JOIN locations l USING (location_id) WHERE l.latitude IS NOT NULL`,
    ),
    pool.query(
      `SELECT w.warehouse_id, w.warehouse_name, w.status, l.location_name, l.latitude::float AS lat, l.longitude::float AS lon,
              s.units_available::float AS units, s.low_stock_lines, s.resource_lines
         FROM warehouses w JOIN locations l USING (location_id) JOIN v_warehouse_inventory_summary s USING (warehouse_id)
        WHERE l.latitude IS NOT NULL`,
    ),
    pool.query(`SELECT count(*)::int AS n FROM locations WHERE latitude IS NULL`),
  ]);
  return { disasters: disasters.rows, camps: camps.rows, warehouses: warehouses.rows, locationsWithoutCoordinates: missing.rows[0].n };
});
