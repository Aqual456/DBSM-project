import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import type { ZodType } from "zod";
import { hash } from "bcryptjs";
import { actor, endpoint, managers, staff, transaction, audit, HttpError, body, readAs, type Actor, type Role } from "@/lib/api";
import { pool } from "@/lib/postgres";
import {
  id,
  campSchema,
  warehouseSchema,
  locationSchema,
  vehicleSchema,
  volunteerSchema,
  resourceSchema,
  categorySchema,
  inventoryAdjustSchema,
  allocationSchema,
  deliverySchema,
  deliveryStatusSchema,
  campOccupancySchema,
  userCreateSchema,
  userRoleSchema,
  disasterLocationSchema,
  canTransition,
} from "@/lib/validation";

/** Simple master-data entities share one generic, whitelisted CRUD implementation. */
type Entity = {
  table: string;
  key: string;
  schema: ZodType<Record<string, unknown>>;
  fields: string[];
  list: string;
  deletable?: boolean;
};
const entities: Record<string, Entity> = {
  camps: {
    table: "relief_camps",
    key: "camp_id",
    schema: campSchema as ZodType<Record<string, unknown>>,
    fields: ["camp_name", "location_id", "capacity", "current_population", "status"],
    list: `SELECT c.*, c.xmin::text AS row_version, l.location_name,
                  ROUND(100.0 * c.current_population / c.capacity, 1) AS occupancy_pct
             FROM relief_camps c JOIN locations l USING (location_id) ORDER BY c.camp_id DESC`,
  },
  warehouses: {
    table: "warehouses",
    key: "warehouse_id",
    schema: warehouseSchema as ZodType<Record<string, unknown>>,
    fields: ["warehouse_name", "location_id", "capacity", "status"],
    list: `SELECT w.*, w.xmin::text AS row_version, l.location_name, s.resource_lines, s.units_available, s.low_stock_lines
             FROM warehouses w JOIN locations l USING (location_id)
             JOIN v_warehouse_inventory_summary s USING (warehouse_id) ORDER BY w.warehouse_id DESC`,
  },
  locations: {
    table: "locations",
    key: "location_id",
    schema: locationSchema as ZodType<Record<string, unknown>>,
    fields: ["location_name", "location_type", "address", "latitude", "longitude"],
    list: `SELECT l.*, l.xmin::text AS row_version FROM locations l ORDER BY l.location_id DESC`,
    deletable: true,
  },
  vehicles: {
    table: "vehicles",
    key: "vehicle_id",
    schema: vehicleSchema as ZodType<Record<string, unknown>>,
    fields: ["vehicle_number", "vehicle_type", "capacity", "status"],
    list: `SELECT v.*, v.xmin::text AS row_version, l.location_name AS current_location
             FROM vehicles v LEFT JOIN locations l ON l.location_id = v.current_location_id ORDER BY v.vehicle_id DESC`,
    deletable: true,
  },
  volunteers: {
    table: "volunteers",
    key: "volunteer_id",
    schema: volunteerSchema as ZodType<Record<string, unknown>>,
    fields: ["full_name", "phone", "email", "skills", "availability_status"],
    list: `SELECT v.*, v.xmin::text AS row_version,
                  (SELECT count(*)::int FROM delivery_volunteers dv WHERE dv.volunteer_id = v.volunteer_id) AS deliveries_supported
             FROM volunteers v ORDER BY v.volunteer_id DESC`,
    deletable: true,
  },
  resources: {
    table: "resources",
    key: "resource_id",
    schema: resourceSchema as ZodType<Record<string, unknown>>,
    fields: ["resource_name", "category_id", "unit", "is_perishable"],
    list: `SELECT r.*, r.xmin::text AS row_version, c.category_name, resource_availability(r.resource_id) AS total_available
             FROM resources r JOIN resource_categories c USING (category_id) ORDER BY r.resource_id DESC`,
    deletable: true,
  },
  categories: {
    table: "resource_categories",
    key: "category_id",
    schema: categorySchema as ZodType<Record<string, unknown>>,
    fields: ["category_name", "description"],
    list: `SELECT c.*, c.xmin::text AS row_version,
                  (SELECT count(*)::int FROM resources r WHERE r.category_id = c.category_id) AS resource_count
             FROM resource_categories c ORDER BY c.category_id DESC`,
    deletable: true,
  },
};

const readers: Record<string, { roles?: Role[]; run: (u: Actor) => Promise<unknown> }> = {
  users: {
    roles: ["ADMIN"],
    run: async () =>
      (
        await pool.query(
          `SELECT u.user_id, u.full_name, u.email, u.phone, r.role_name, u.is_active, u.created_at,
                  (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.user_id AND s.expires_at > now()) AS active_sessions
             FROM app_users u JOIN roles r USING (role_id) ORDER BY u.user_id`,
        )
      ).rows,
  },
  roles: { roles: ["ADMIN"], run: async () => (await pool.query("SELECT * FROM roles ORDER BY role_id")).rows },
  drivers: {
    roles: managers,
    run: async () =>
      (
        await pool.query(
          `SELECT u.user_id, u.full_name,
                  EXISTS (SELECT 1 FROM deliveries d WHERE d.driver_id = u.user_id AND d.status IN ('PLANNED','IN_TRANSIT','DELAYED')) AS busy
             FROM app_users u JOIN roles r USING (role_id) WHERE r.role_name = 'DRIVER' AND u.is_active ORDER BY u.full_name`,
        )
      ).rows,
  },
  inventory: {
    roles: staff,
    run: async () =>
      (
        await pool.query(
          `SELECT i.warehouse_id, i.resource_id, i.quantity_available, i.minimum_threshold, i.last_updated,
                  w.warehouse_name, w.status AS warehouse_status, r.resource_name, r.unit, c.category_name,
                  (i.quantity_available <= i.minimum_threshold) AS low_stock,
                  COALESCE(cm.committed, 0) AS quantity_committed
             FROM inventory i
             JOIN warehouses w USING (warehouse_id)
             JOIN resources r USING (resource_id)
             JOIN resource_categories c USING (category_id)
             LEFT JOIN (SELECT ai.warehouse_id, ai.resource_id, SUM(ai.quantity_allocated) AS committed
                          FROM allocation_items ai JOIN allocations a USING (allocation_id)
                         WHERE a.status IN ('ALLOCATED','IN_TRANSIT')
                         GROUP BY ai.warehouse_id, ai.resource_id) cm USING (warehouse_id, resource_id)
            ORDER BY w.warehouse_name, r.resource_name`,
        )
      ).rows,
  },
  movements: {
    roles: staff,
    run: async () =>
      (
        await pool.query(
          `SELECT m.movement_id, m.created_at, w.warehouse_name, r.resource_name, r.unit, m.delta, m.reason
             FROM inventory_movements m JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
            ORDER BY m.movement_id DESC LIMIT 500`,
        )
      ).rows,
  },
  audit: {
    roles: managers,
    run: async () =>
      (
        await pool.query(
          `SELECT a.audit_id, a.created_at, u.full_name AS user_name, a.action, a.details
             FROM audit_logs a LEFT JOIN app_users u USING (user_id) ORDER BY a.audit_id DESC LIMIT 500`,
        )
      ).rows,
  },
  changes: {
    roles: managers,
    run: async () =>
      (
        await pool.query(
          `SELECT l.change_id, l.changed_at, l.table_name, l.operation, l.changed_fields, l.row_data, l.txid, u.full_name AS changed_by_name
             FROM data_change_log l LEFT JOIN app_users u ON u.user_id = l.changed_by ORDER BY l.change_id DESC LIMIT 500`,
        )
      ).rows,
  },
  allocations: {
    roles: staff,
    run: async () =>
      (
        await pool.query(
          `SELECT a.allocation_id, a.request_id, a.status, a.allocated_at, a.remarks, u.full_name AS allocated_by_name,
                  c.camp_name, rr.priority_level,
                  (SELECT json_agg(json_build_object('warehouse_id', ai.warehouse_id, 'warehouse_name', w.warehouse_name,
                          'resource_id', ai.resource_id, 'resource_name', r.resource_name, 'unit', r.unit,
                          'quantity', ai.quantity_allocated) ORDER BY ai.allocation_item_id)
                     FROM allocation_items ai JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
                    WHERE ai.allocation_id = a.allocation_id) AS items,
                  (SELECT d.status FROM deliveries d WHERE d.allocation_id = a.allocation_id AND d.status <> 'CANCELLED' LIMIT 1) AS delivery_status
             FROM allocations a
             JOIN app_users u ON u.user_id = a.allocated_by
             JOIN resource_requests rr USING (request_id)
             JOIN relief_camps c USING (camp_id)
            ORDER BY a.allocation_id DESC LIMIT 500`,
        )
      ).rows,
  },
  deliveries: {
    // Runs as the user's database role: for drivers, PostgreSQL row-level security
    // (policy deliveries_driver_own) returns only their own deliveries.
    run: async (u) =>
      readAs(u, async (c) =>
        (
          await c.query(
          `SELECT d.delivery_id, d.allocation_id, d.status, d.departure_time, d.expected_arrival, d.actual_arrival,
                  d.vehicle_id, d.driver_id, u.full_name AS driver_name, v.vehicle_number, v.vehicle_type,
                  src.location_name AS source_name, dst.location_name AS destination_name, a.request_id,
                  (SELECT json_agg(json_build_object('volunteer_id', vo.volunteer_id, 'full_name', vo.full_name))
                     FROM delivery_volunteers dv JOIN volunteers vo USING (volunteer_id) WHERE dv.delivery_id = d.delivery_id) AS volunteers
             FROM deliveries d
             JOIN app_users u ON u.user_id = d.driver_id
             JOIN vehicles v USING (vehicle_id)
             JOIN allocations a USING (allocation_id)
             JOIN locations src ON src.location_id = d.source_location_id
             JOIN locations dst ON dst.location_id = d.destination_location_id
            ORDER BY d.delivery_id DESC LIMIT 500`,
          )
        ).rows,
      ),
  },
  "disaster-locations": {
    roles: staff,
    run: async () =>
      (
        await pool.query(
          `SELECT dl.*, d.disaster_name, l.location_name FROM disaster_locations dl
             JOIN disasters d USING (disaster_id) JOIN locations l USING (location_id)
            ORDER BY dl.reported_at DESC`,
        )
      ).rows,
  },
};

function kindOf(req: NextRequest) {
  return req.nextUrl.searchParams.get("kind") || "";
}

export const GET = endpoint(async (req) => {
  const k = kindOf(req);
  if (Object.hasOwn(entities, k)) {
    await actor(req, staff);
    return (await pool.query(entities[k].list + " LIMIT 500")).rows;
  }
  if (!Object.hasOwn(readers, k)) {
    await actor(req);
    throw new HttpError(404, "Unknown module", "NOT_FOUND");
  }
  const reader = readers[k];
  const u = await actor(req, reader.roles);
  return reader.run(u);
});

// ---------------------------------------------------------------------------
type Writer = { roles?: Role[]; run: (c: PoolClient, b: Record<string, unknown>, u: Actor) => Promise<unknown> };

async function saveEntity(k: string, c: PoolClient, b: Record<string, unknown>) {
  const cfg = entities[k];
  const { [cfg.key]: rawKey, row_version: rowVersion, ...fields } = b;
  const d = cfg.schema.parse(fields);
  const values = cfg.fields.map((f) => d[f] ?? null);
  if (rawKey === undefined || rawKey === null || rawKey === "") {
    return (
      await c.query(
        `INSERT INTO ${cfg.table}(${cfg.fields.join(",")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
        values,
      )
    ).rows[0];
  }
  const key = id.parse(rawKey);
  const old = (await c.query(`SELECT *, xmin::text AS row_version FROM ${cfg.table} WHERE ${cfg.key} = $1 FOR UPDATE`, [key])).rows[0];
  if (!old) throw new HttpError(404, "Record not found", "NOT_FOUND");
  if (rowVersion !== undefined && String(rowVersion) !== old.row_version)
    throw new HttpError(409, "This record was changed by someone else. Reload and try again", "STALE_RECORD");
  if (k === "vehicles" && (await c.query(`SELECT 1 FROM deliveries WHERE vehicle_id = $1 AND status IN ('PLANNED','IN_TRANSIT','DELAYED')`, [key])).rowCount)
    throw new HttpError(409, "Vehicle has an active delivery", "BUSINESS_RULE");
  if (k === "volunteers" && old.availability_status === "ASSIGNED")
    throw new HttpError(409, "Assigned volunteers cannot be edited until their delivery ends", "BUSINESS_RULE");
  if (k === "warehouses" && d.status !== "ACTIVE" && old.status === "ACTIVE") {
    const committed = await c.query(
      `SELECT 1 FROM allocation_items ai JOIN allocations a USING (allocation_id)
        WHERE ai.warehouse_id = $1 AND a.status = 'ALLOCATED' LIMIT 1`,
      [key],
    );
    if (committed.rowCount) throw new HttpError(409, "Warehouse has allocations awaiting dispatch", "BUSINESS_RULE");
  }
  return (
    await c.query(
      `UPDATE ${cfg.table} SET ${cfg.fields.map((f, i) => `${f} = $${i + 1}`).join(", ")} WHERE ${cfg.key} = $${values.length + 1} RETURNING *`,
      [...values, key],
    )
  ).rows[0];
}

const writers: Record<string, Writer> = {
  users: {
    roles: ["ADMIN"],
    run: async (c, b) => {
      const d = userCreateSchema.parse(b);
      const r = await c.query(
        `INSERT INTO app_users(full_name, email, password_hash, role_id)
         SELECT $1, $2, $3, role_id FROM roles WHERE role_name = $4 RETURNING user_id, full_name, email`,
        [d.full_name, d.email, await hash(d.password, 12), d.role_name],
      );
      return r.rows[0];
    },
  },
  "user-role": {
    roles: ["ADMIN"],
    run: async (c, b, u) => {
      const d = userRoleSchema.parse(b);
      if (String(d.user_id) === String(u.user_id)) throw new HttpError(409, "You cannot change your own permissions", "BUSINESS_RULE");
      const target = (await c.query("SELECT u.user_id, r.role_name, u.is_active FROM app_users u JOIN roles r USING (role_id) WHERE user_id = $1 FOR UPDATE", [d.user_id])).rows[0];
      if (!target) throw new HttpError(404, "User not found", "NOT_FOUND");
      const demotingDriver = target.role_name === "DRIVER" && (d.role_name !== "DRIVER" || !d.is_active);
      if (demotingDriver && (await c.query(`SELECT 1 FROM deliveries WHERE driver_id = $1 AND status IN ('PLANNED','IN_TRANSIT','DELAYED')`, [d.user_id])).rowCount)
        throw new HttpError(409, "User has assigned deliveries", "BUSINESS_RULE");
      if (target.role_name === "ADMIN" && (d.role_name !== "ADMIN" || !d.is_active)) {
        const admins = await c.query(`SELECT count(*)::int AS n FROM app_users u JOIN roles r USING (role_id) WHERE r.role_name = 'ADMIN' AND u.is_active`);
        if (admins.rows[0].n <= 1) throw new HttpError(409, "At least one active administrator is required", "BUSINESS_RULE");
      }
      await c.query("UPDATE app_users SET role_id = (SELECT role_id FROM roles WHERE role_name = $1), is_active = $2 WHERE user_id = $3", [
        d.role_name,
        d.is_active,
        d.user_id,
      ]);
      // Permissions changed: revoke every session so the new role applies immediately.
      await c.query("DELETE FROM sessions WHERE user_id = $1", [d.user_id]);
      return { updated: true };
    },
  },
  "user-password": {
    roles: ["ADMIN"],
    run: async (c, b, u) => {
      const d = userCreateSchema.pick({ password: true }).extend({ user_id: id }).strict().parse(b);
      if (String(d.user_id) === String(u.user_id)) throw new HttpError(409, "Use your own account settings to change your password", "BUSINESS_RULE");
      const r = await c.query("UPDATE app_users SET password_hash = $1 WHERE user_id = $2 RETURNING user_id", [await hash(d.password, 12), d.user_id]);
      if (!r.rowCount) throw new HttpError(404, "User not found", "NOT_FOUND");
      await c.query("DELETE FROM sessions WHERE user_id = $1", [d.user_id]);
      return { updated: true };
    },
  },
  "user-sessions-revoke": {
    roles: ["ADMIN"],
    run: async (c, b) => {
      const userId = id.parse(b.user_id);
      const r = await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      return { revoked: r.rowCount };
    },
  },
  inventory: {
    roles: managers,
    run: async (c, b) => {
      const d = inventoryAdjustSchema.parse(b);
      await c.query(`SELECT set_config('reliefflow.reason', $1, true)`, [d.reason]);
      if (!(await c.query(`SELECT 1 FROM warehouses WHERE warehouse_id = $1 AND status = 'ACTIVE' FOR SHARE`, [d.warehouse_id])).rowCount)
        throw new HttpError(409, "Warehouse is not active", "BUSINESS_RULE");
      if (!(await c.query(`SELECT 1 FROM resources WHERE resource_id = $1`, [d.resource_id])).rowCount)
        throw new HttpError(400, "Unknown resource", "INVALID_REFERENCE");
      await c.query("INSERT INTO inventory(warehouse_id, resource_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [d.warehouse_id, d.resource_id]);
      const cur = (await c.query("SELECT quantity_available FROM inventory WHERE warehouse_id = $1 AND resource_id = $2 FOR UPDATE", [d.warehouse_id, d.resource_id])).rows[0];
      if (d.expected_quantity !== undefined && Number(cur.quantity_available) !== d.expected_quantity)
        throw new HttpError(409, `Stock changed to ${Number(cur.quantity_available)} since you loaded it. Review and retry`, "STALE_RECORD");
      if (Number(cur.quantity_available) + d.delta < 0)
        throw new HttpError(409, `Adjustment would make stock negative (available ${Number(cur.quantity_available)})`, "BUSINESS_RULE");
      return (
        await c.query(
          `UPDATE inventory SET quantity_available = quantity_available + $3, minimum_threshold = $4, last_updated = now()
            WHERE warehouse_id = $1 AND resource_id = $2 RETURNING *`,
          [d.warehouse_id, d.resource_id, d.delta, d.minimum_threshold],
        )
      ).rows[0];
    },
  },
  allocations: {
    roles: managers,
    run: async (c, b, u) => {
      const d = allocationSchema.parse(b);
      // Lock order: request -> request lines -> inventory rows (sorted). Triggers follow the same order.
      const req = (await c.query(`SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE`, [d.request_id])).rows[0];
      if (!req) throw new HttpError(404, "Request not found", "NOT_FOUND");
      if (!["APPROVED", "PARTIALLY_FULFILLED"].includes(req.status))
        throw new HttpError(409, "Request must be approved with outstanding demand", "BUSINESS_RULE");
      const a = (
        await c.query("INSERT INTO allocations(request_id, allocated_by, remarks) VALUES ($1, $2, NULLIF($3, '')) RETURNING *", [
          d.request_id,
          u.user_id,
          d.remarks,
        ])
      ).rows[0];
      await c.query(`SELECT set_config('reliefflow.reason', $1, true)`, [`Allocation #${a.allocation_id}`]);
      const items = [...d.items].sort((x, y) => x.warehouse_id - y.warehouse_id || x.resource_id - y.resource_id);
      for (const i of items)
        await c.query(
          "INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated) VALUES ($1,$2,$3,$4,$5)",
          [a.allocation_id, d.request_id, i.resource_id, i.warehouse_id, i.quantity_allocated],
        );
      await c.query("CALL refresh_request_status($1)", [d.request_id]);
      return a;
    },
  },
  "allocation-cancel": {
    roles: managers,
    run: async (c, b) => {
      const allocationId = id.parse(b.allocation_id);
      const parent = (await c.query("SELECT request_id FROM allocations WHERE allocation_id = $1", [allocationId])).rows[0];
      if (!parent) throw new HttpError(404, "Allocation not found", "NOT_FOUND");
      await c.query("SELECT 1 FROM resource_requests WHERE request_id = $1 FOR UPDATE", [parent.request_id]);
      const cur = (await c.query("SELECT status FROM allocations WHERE allocation_id = $1 FOR UPDATE", [allocationId])).rows[0];
      if (cur.status === "CANCELLED") throw new HttpError(409, "Allocation is already cancelled", "INVALID_TRANSITION");
      if (!canTransition("allocation", cur.status, "CANCELLED"))
        throw new HttpError(409, "Allocation has already been dispatched and cannot be cancelled", "INVALID_TRANSITION");
      const cancelled = await c.query("UPDATE allocations SET status = 'CANCELLED' WHERE allocation_id = $1 RETURNING *", [allocationId]);
      await c.query("CALL refresh_request_status($1)", [parent.request_id]);
      return cancelled.rows[0];
    },
  },
  deliveries: {
    roles: managers,
    run: async (c, b) => {
      const d = deliverySchema.parse(b);
      const a = (
        await c.query(
          `SELECT a.allocation_id, a.status, a.request_id, rr.camp_id FROM allocations a JOIN resource_requests rr USING (request_id)
            WHERE allocation_id = $1`,
          [d.allocation_id],
        )
      ).rows[0];
      if (!a) throw new HttpError(404, "Allocation not found", "NOT_FOUND");
      await c.query("SELECT 1 FROM resource_requests WHERE request_id = $1 FOR UPDATE", [a.request_id]);
      await c.query("SELECT 1 FROM allocations WHERE allocation_id = $1 FOR UPDATE", [d.allocation_id]);
      if (a.status !== "ALLOCATED") throw new HttpError(409, "Allocation is not assignable", "BUSINESS_RULE");
      if ((await c.query(`SELECT 1 FROM deliveries WHERE allocation_id = $1 AND status <> 'CANCELLED'`, [d.allocation_id])).rowCount)
        throw new HttpError(409, "Allocation already has a delivery", "BUSINESS_RULE");
      const vehicle = (await c.query(`SELECT status FROM vehicles WHERE vehicle_id = $1 FOR UPDATE`, [d.vehicle_id])).rows[0];
      if (!vehicle) throw new HttpError(404, "Vehicle not found", "NOT_FOUND");
      if (vehicle.status !== "AVAILABLE") throw new HttpError(409, "Vehicle unavailable", "BUSINESS_RULE");
      if (!(await c.query(`SELECT 1 FROM app_users u JOIN roles r USING (role_id) WHERE user_id = $1 AND role_name = 'DRIVER' AND is_active`, [d.driver_id])).rowCount)
        throw new HttpError(409, "Select an active driver", "BUSINESS_RULE");
      if ((await c.query(`SELECT 1 FROM deliveries WHERE driver_id = $1 AND status IN ('PLANNED','IN_TRANSIT','DELAYED')`, [d.driver_id])).rowCount)
        throw new HttpError(409, "Driver unavailable", "BUSINESS_RULE");
      const sources = (
        await c.query("SELECT DISTINCT w.location_id FROM allocation_items ai JOIN warehouses w USING (warehouse_id) WHERE allocation_id = $1", [d.allocation_id])
      ).rows;
      if (sources.length !== 1) throw new HttpError(409, "Create separate allocations for separate pickup locations", "BUSINESS_RULE");
      const r = (
        await c.query(
          `INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id, expected_arrival)
           SELECT $1, $2, $3, $4, location_id, $5 FROM relief_camps WHERE camp_id = $6 RETURNING *`,
          [d.allocation_id, d.vehicle_id, d.driver_id, sources[0].location_id, d.expected_arrival, a.camp_id],
        )
      ).rows[0];
      for (const volunteerId of [...d.volunteer_ids].sort((x, y) => x - y)) {
        const ok = await c.query(
          `UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE' RETURNING volunteer_id`,
          [volunteerId],
        );
        if (!ok.rowCount) throw new HttpError(409, `Volunteer #${volunteerId} is unavailable`, "BUSINESS_RULE");
        await c.query(`INSERT INTO delivery_volunteers(delivery_id, volunteer_id, assigned_role) VALUES ($1, $2, 'RELIEF_SUPPORT')`, [r.delivery_id, volunteerId]);
      }
      await c.query(`UPDATE vehicles SET status = 'IN_USE' WHERE vehicle_id = $1`, [d.vehicle_id]);
      return r;
    },
  },
  "delivery-status": {
    run: async (c, b, u) => {
      const d = deliveryStatusSchema.parse(b);
      const head = (
        await c.query(
          "SELECT a.request_id, d.allocation_id FROM deliveries d JOIN allocations a USING (allocation_id) WHERE d.delivery_id = $1",
          [d.delivery_id],
        )
      ).rows[0];
      if (!head) throw new HttpError(404, "Delivery not found", "NOT_FOUND");
      // Parent lock first (same order as allocation writes), then the delivery row.
      await c.query("SELECT 1 FROM resource_requests WHERE request_id = $1 FOR UPDATE", [head.request_id]);
      const row = (await c.query("SELECT * FROM deliveries WHERE delivery_id = $1 FOR UPDATE", [d.delivery_id])).rows[0];
      const isOwner = u.role_name === "DRIVER" && String(row.driver_id) === String(u.user_id);
      if (!managers.includes(u.role_name) && !(isOwner && d.status !== "CANCELLED"))
        throw new HttpError(403, "You do not have permission for this action", "FORBIDDEN");
      if (!canTransition("delivery", row.status, d.status))
        throw new HttpError(409, `Invalid delivery transition ${row.status} → ${d.status}`, "INVALID_TRANSITION");
      await c.query(
        `UPDATE deliveries SET status = $1::text,
                departure_time = CASE WHEN $1 = 'IN_TRANSIT' THEN COALESCE(departure_time, now()) ELSE departure_time END,
                actual_arrival = CASE WHEN $1 = 'DELIVERED' THEN now() ELSE actual_arrival END
          WHERE delivery_id = $2`,
        [d.status, d.delivery_id],
      );
      if (d.status !== "CANCELLED")
        await c.query("UPDATE allocations SET status = $1 WHERE allocation_id = $2", [d.status === "DELIVERED" ? "DELIVERED" : "IN_TRANSIT", row.allocation_id]);
      if (d.status === "DELIVERED" || d.status === "CANCELLED") {
        await c.query(
          `UPDATE vehicles SET status = 'AVAILABLE',
                  current_location_id = CASE WHEN $2 = 'DELIVERED' THEN $3 ELSE current_location_id END
            WHERE vehicle_id = $1`,
          [row.vehicle_id, d.status, row.destination_location_id],
        );
        await c.query(
          `UPDATE volunteers SET availability_status = 'AVAILABLE'
            WHERE volunteer_id IN (SELECT volunteer_id FROM delivery_volunteers WHERE delivery_id = $1) AND availability_status = 'ASSIGNED'`,
          [d.delivery_id],
        );
      }
      await c.query("CALL refresh_request_status($1)", [head.request_id]);
      return { updated: true, delivery_id: d.delivery_id, status: d.status };
    },
  },
  "camp-occupancy": {
    roles: staff,
    run: async (c, b) => {
      const d = campOccupancySchema.parse(b);
      // Atomic relative update: concurrent admissions cannot overwrite each other (no lost update).
      const r = await c.query(
        `UPDATE relief_camps
            SET current_population = current_population + $2,
                status = CASE WHEN current_population + $2 >= capacity THEN 'FULL' ELSE 'OPEN' END
          WHERE camp_id = $1 AND status <> 'CLOSED'
            AND current_population + $2 BETWEEN 0 AND capacity
          RETURNING camp_id, camp_name, capacity, current_population, status`,
        [d.camp_id, d.delta],
      );
      if (!r.rowCount) {
        const camp = (await c.query("SELECT status, capacity, current_population FROM relief_camps WHERE camp_id = $1", [d.camp_id])).rows[0];
        if (!camp) throw new HttpError(404, "Camp not found", "NOT_FOUND");
        if (camp.status === "CLOSED") throw new HttpError(409, "Camp is closed", "BUSINESS_RULE");
        throw new HttpError(
          409,
          `Occupancy must stay between 0 and ${camp.capacity} (currently ${camp.current_population})`,
          "CAPACITY_EXCEEDED",
        );
      }
      return r.rows[0];
    },
  },
  "disaster-locations": {
    roles: managers,
    run: async (c, b) => {
      const d = disasterLocationSchema.parse(b);
      return (
        await c.query(
          `INSERT INTO disaster_locations(disaster_id, location_id, impact_level, affected_population)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (disaster_id, location_id) DO UPDATE
             SET impact_level = EXCLUDED.impact_level, affected_population = EXCLUDED.affected_population, reported_at = now()
           RETURNING *`,
          [d.disaster_id, d.location_id, d.impact_level, d.affected_population],
        )
      ).rows[0];
    },
  },
};

export const POST = endpoint(async (req) => {
  const k = kindOf(req);
  if (!Object.hasOwn(entities, k) && !Object.hasOwn(writers, k)) {
    await actor(req);
    throw new HttpError(404, "Unknown operation", "NOT_FOUND");
  }
  const writer = writers[k];
  const u = await actor(req, Object.hasOwn(entities, k) ? managers : writer.roles);
  const b = await body(req);
  return transaction(async (c) => {
    const result = Object.hasOwn(entities, k) ? await saveEntity(k, c, b) : await writer.run(c, b, u);
    const redacted = { ...b };
    delete redacted.password;
    await audit(c, u, k.toUpperCase().replaceAll("-", "_"), { input: redacted, result });
    return result;
  }, u);
});

export const DELETE = endpoint(async (req) => {
  const k = kindOf(req);
  const cfg = Object.hasOwn(entities, k) ? entities[k] : undefined;
  const u = await actor(req, managers);
  if (!cfg?.deletable) throw new HttpError(405, "Records of this type cannot be deleted", "NOT_ALLOWED");
  const key = id.parse(req.nextUrl.searchParams.get("id"));
  return transaction(async (c) => {
    if (k === "volunteers" && (await c.query("SELECT 1 FROM delivery_volunteers WHERE volunteer_id = $1 LIMIT 1", [key])).rowCount)
      throw new HttpError(409, "Volunteer has delivery history; mark as unavailable instead", "REFERENCE_VIOLATION");
    const r = await c.query(`DELETE FROM ${cfg.table} WHERE ${cfg.key} = $1 RETURNING ${cfg.key}`, [key]);
    if (!r.rowCount) throw new HttpError(404, "Record not found", "NOT_FOUND");
    await audit(c, u, `${k.toUpperCase()}_DELETED`, { id: key });
    return { deleted: true };
  }, u);
});
