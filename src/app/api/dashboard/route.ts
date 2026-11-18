import { endpoint, actor, staff, managers } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { cached } from "@/lib/cache";
import { getMongoDb } from "@/lib/mongodb";

async function loadMetrics() {
  const [kpi, severity, demand, stockTrend, requestTrend, deliveryStatus, campLoad, units] = await Promise.all([
    pool.query(`
      SELECT (SELECT count(*) FROM disasters WHERE status = 'ACTIVE')::int AS active_disasters,
             (SELECT COALESCE(sum(dl.affected_population),0) FROM disaster_locations dl JOIN disasters d USING (disaster_id) WHERE d.status <> 'CLOSED')::bigint AS affected_population,
             (SELECT count(*) FROM relief_camps WHERE status <> 'CLOSED')::int AS active_camps,
             (SELECT COALESCE(sum(current_population),0) FROM relief_camps WHERE status <> 'CLOSED')::bigint AS sheltered_population,
             (SELECT COALESCE(sum(capacity),0) FROM relief_camps WHERE status <> 'CLOSED')::bigint AS shelter_capacity,
             (SELECT count(*) FROM inventory i JOIN warehouses w USING (warehouse_id) WHERE w.status = 'ACTIVE' AND i.quantity_available > 0)::int AS stocked_lines,
             (SELECT count(*) FROM v_low_stock)::int AS low_stock_lines,
             (SELECT count(*) FROM resource_requests WHERE status = 'PENDING')::int AS pending_requests,
             (SELECT count(*) FROM resource_requests WHERE status IN ('APPROVED','PARTIALLY_FULFILLED'))::int AS approved_open_requests,
             (SELECT count(*) FROM allocations WHERE status <> 'CANCELLED')::int AS allocations,
             (SELECT count(*) FROM deliveries WHERE status IN ('PLANNED','IN_TRANSIT','DELAYED'))::int AS active_deliveries,
             (SELECT count(*) FROM deliveries WHERE status = 'DELIVERED')::int AS completed_deliveries,
             (SELECT count(*) FROM deliveries WHERE status <> 'CANCELLED')::int AS total_deliveries`),
    pool.query(`SELECT severity, count(*)::int AS count FROM disasters WHERE status <> 'CLOSED' GROUP BY severity`),
    pool.query(`SELECT resource_name, unit, outstanding_demand::float AS demand, available_stock::float AS available FROM v_resource_demand ORDER BY resource_name`),
    pool.query(`
      WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS day)
      SELECT to_char(d.day, 'Mon DD') AS day,
             COALESCE(sum(m.delta) FILTER (WHERE m.delta > 0), 0)::float AS inflow,
             COALESCE(-sum(m.delta) FILTER (WHERE m.delta < 0), 0)::float AS outflow
        FROM days d LEFT JOIN inventory_movements m ON m.created_at::date = d.day
       GROUP BY d.day ORDER BY d.day`),
    pool.query(`
      WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS day)
      SELECT to_char(d.day, 'Mon DD') AS day,
             (SELECT count(*) FROM resource_requests r WHERE r.requested_at::date = d.day)::int AS requested,
             (SELECT count(DISTINCT a.request_id) FROM allocations a WHERE a.allocated_at::date = d.day AND a.status <> 'CANCELLED')::int AS allocated,
             (SELECT count(*) FROM deliveries x WHERE x.actual_arrival::date = d.day)::int AS delivered
        FROM days d ORDER BY d.day`),
    pool.query(`SELECT status, count(*)::int AS count FROM deliveries GROUP BY status`),
    pool.query(`SELECT camp_name, capacity, current_population FROM relief_camps WHERE status <> 'CLOSED' ORDER BY current_population::float / capacity DESC LIMIT 8`),
    pool.query(`SELECT r.unit, COALESCE(sum(i.quantity_available),0)::float AS available
                  FROM inventory i JOIN resources r USING (resource_id) JOIN warehouses w USING (warehouse_id)
                 WHERE w.status = 'ACTIVE' GROUP BY r.unit ORDER BY available DESC`),
  ]);
  const k = kpi.rows[0];
  return {
    kpi: {
      ...k,
      affected_population: Number(k.affected_population),
      sheltered_population: Number(k.sheltered_population),
      shelter_capacity: Number(k.shelter_capacity),
      delivery_completion_pct: k.total_deliveries ? Math.round((1000 * k.completed_deliveries) / k.total_deliveries) / 10 : 0,
    },
    stockByUnit: units.rows,
    severity: ["CRITICAL", "HIGH", "MODERATE", "LOW"].map((s) => ({
      severity: s,
      count: severity.rows.find((r) => r.severity === s)?.count ?? 0,
    })),
    demand: demand.rows,
    stockTrend: stockTrend.rows,
    requestTrend: requestTrend.rows,
    deliveryStatus: deliveryStatus.rows,
    campLoad: campLoad.rows,
    generatedAt: new Date().toISOString(),
  };
}

export const GET = endpoint(async (req) => {
  const u = await actor(req, staff);
  const started = performance.now();
  const { value, hit } = await cached("rf:cache:dashboard:v2", 30, loadMetrics);
  const loadMs = +(performance.now() - started).toFixed(1);

  // Live (uncached) panels: recent incidents from MongoDB and recent activity from PostgreSQL.
  const [incidents, activity] = await Promise.all([
    getMongoDb()
      .then((db) =>
        db
          .collection("incident_reports")
          .find({}, { projection: { description: 1, severity: 1, reportType: 1, "location.label": 1, createdAt: 1, status: 1 } })
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray(),
      )
      .catch(() => null),
    managers.includes(u.role_name)
      ? pool
          .query(
            `SELECT a.audit_id, a.created_at, a.action, u.full_name AS user_name
               FROM audit_logs a LEFT JOIN app_users u USING (user_id) ORDER BY a.audit_id DESC LIMIT 8`,
          )
          .then((r) => r.rows)
      : Promise.resolve([]),
  ]);
  return { ...value, incidents, activity, cache: { hit, loadMs } };
});
