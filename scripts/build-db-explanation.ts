import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Client } from "pg";

/**
 * Writes docs/report/ReliefFlow-Database-Explained.md — a complete, plain-English walkthrough of
 * the PostgreSQL database: every table, how the tables are related, the DDL that creates them,
 * the DML the application runs, and every trigger, view, function and procedure.
 * Structure (columns, constraints, indexes, trigger and function source) is read from the LIVE
 * catalog (metadata only, no data rows), so the document always matches the real database.
 * Render to PDF with: npm run report:build database
 */

// ---------------------------------------------------------------------------------------------
// Hand-written explanations (the "why"); everything structural is read from the catalog.
// ---------------------------------------------------------------------------------------------
const GROUPS: { name: string; about: string; tables: string[] }[] = [
  { name: "Users and security", about: "Who can sign in, with which role, and how sign-in is protected.", tables: ["roles", "app_users", "sessions", "login_attempts"] },
  { name: "Disasters and places", about: "The events being responded to and the places they affect.", tables: ["locations", "disasters", "disaster_locations"] },
  { name: "Shelters", about: "Relief camps that house affected people and raise requests.", tables: ["relief_camps"] },
  { name: "Stock", about: "What relief items exist, where they are stored and how much is left.", tables: ["resource_categories", "resources", "warehouses", "inventory", "inventory_movements"] },
  { name: "Requests", about: "What a camp asks for: one header row and one line per resource.", tables: ["resource_requests", "request_items"] },
  { name: "Allocation", about: "Stock committed from warehouses to a request.", tables: ["allocations", "allocation_items"] },
  { name: "Logistics", about: "Getting allocated stock to the camp: vehicles, drivers, volunteer crews.", tables: ["vehicles", "volunteers", "deliveries", "delivery_volunteers"] },
  { name: "History and system", about: "Audit trails and bookkeeping tables.", tables: ["audit_logs", "data_change_log", "integration_sync_runs", "schema_migrations"] },
];

type Note = { why: string; dml: string[]; notes?: string[] };
const TABLES: Record<string, Note> = {
  roles: {
    why: "Lists the four application roles. Every user points to exactly one role, so permissions can be decided from a single join.",
    dml: ["INSERT: the four rows are created once by the seed script (002_seed.sql).", "SELECT: joined to app_users on every request to know the signed-in user's role.", "No UPDATE or DELETE: roles are fixed; deleting one is blocked by the FK from app_users (RESTRICT)."],
  },
  app_users: {
    why: "Everyone who can sign in. The password is never stored, only a bcrypt hash. Users are deactivated, never deleted, so the history of who did what stays intact.",
    dml: [
      "INSERT: an administrator creates a user (Administration → Users).",
      "UPDATE: change role, deactivate/reactivate, reset password. Each of these also DELETEs that user's sessions so the change takes effect immediately.",
      "No DELETE in the application (deactivate instead); RESTRICT FKs from requests, allocations, deliveries and logs would block it anyway.",
      "Trigger row_change_log records every change (without the password hash) in data_change_log.",
    ],
    notes: ["Column privilege: only rf_admin may read password_hash; other database roles can read only user_id, role_id, full_name, is_active, created_at."],
  },
  sessions: {
    why: "Server-side sessions. The browser cookie holds a random 256-bit token; the table holds only its SHA-256 hash, so a stolen database copy cannot be used to log in.",
    dml: ["INSERT: on successful sign-in (expires_at = now() + 8 hours).", "DELETE: on sign-out, on role change, deactivation and password reset (all of the user's sessions), and expired sessions are cleaned up at sign-in.", "SELECT: on every API call to authenticate the cookie (sessions ⋈ app_users ⋈ roles)."],
  },
  login_attempts: {
    why: "Brute-force protection: counts failed sign-ins per e-mail inside a 15-minute window.",
    dml: ["INSERT … ON CONFLICT DO NOTHING: creates the counter row for an e-mail.", "SELECT … FOR UPDATE: locks the counter so parallel guesses are counted correctly.", "UPDATE: attempts = attempts + 1 on failure, or reset when the window has expired.", "DELETE: on successful sign-in."],
  },
  locations: {
    why: "Every place in the system (districts, camp sites, depots) with optional coordinates. Camps, warehouses, disasters, deliveries and vehicles all point here, so a place is stored once.",
    dml: ["INSERT / UPDATE: management screen (Locations).", "DELETE: allowed only while nothing refers to the location — every FK to locations is RESTRICT or SET NULL."],
  },
  disasters: {
    why: "The events being responded to. Severity and status drive the dashboard; search_vector is a generated full-text column for searching.",
    dml: ["INSERT: Disasters → New, in the same transaction as its disaster_locations rows.", "UPDATE: edit details or close the disaster (with optimistic locking on xmin).", "No DELETE: requests and incident reports refer to disasters (RESTRICT).", "Triggers: operational_duplicate rejects the same event entered twice; row_change_log keeps field-level history."],
  },
  disaster_locations: {
    why: "Resolves the many-to-many relationship Disaster AFFECTS Location. The relationship has its own attributes (impact level, affected population, reported time), which is why it is a table.",
    dml: ["INSERT: when a disaster is created, and later via 'add affected location'.", "Deleted automatically with its disaster (ON DELETE CASCADE)."],
  },
  relief_camps: {
    why: "Shelters. CHECK constraints keep occupancy between 0 and capacity and keep status consistent with occupancy (FULL only when full, CLOSED only when empty).",
    dml: [
      "INSERT / UPDATE: management screen (with xmin optimistic locking).",
      "UPDATE (admit / discharge): an atomic relative update — SET current_population = current_population + $n, status recomputed in the same statement — so 12 simultaneous admissions are all counted.",
      "No DELETE: camps are closed (status = CLOSED); requests refer to them (RESTRICT).",
      "Trigger row_change_log records changes.",
    ],
    notes: ["Column privilege: a field officer (rf_field_officer) may UPDATE only current_population and status."],
  },
  resource_categories: { why: "Groups resources (FOOD, WATER, MEDICAL, SHELTER, HYGIENE, ENERGY) for filtering and analytics.", dml: ["INSERT / UPDATE / DELETE: management screen. DELETE is refused while resources use the category (RESTRICT)."] },
  resources: { why: "The catalogue of relief items, each with a unit of measure (litre, packet, kit…). A resource exists once; stock of it lives in inventory.", dml: ["INSERT / UPDATE / DELETE: management screen. DELETE is refused once the resource is stocked or requested (RESTRICT)."] },
  warehouses: {
    why: "Storage sites. A warehouse must be ACTIVE to supply stock (checked by the allocation trigger).",
    dml: ["INSERT / UPDATE: management screen; status INACTIVE instead of delete.", "Triggers: operational_duplicate (same name at the same location → rejected), row_change_log."],
  },
  inventory: {
    why: "A stock line: how much of one resource one warehouse holds. It is a weak entity — identified by (warehouse_id, resource_id) — and the quantity can never go negative (CHECK).",
    dml: [
      "INSERT … ON CONFLICT DO NOTHING: creates the stock line the first time a resource is stocked in a warehouse.",
      "UPDATE (adjust stock): locks the line FOR UPDATE, checks the expected quantity (optimistic concurrency), sets the new quantity with a reason.",
      "UPDATE by triggers: allocation lines deduct stock (trg_adjust_inventory); a cancelled allocation restores it (allocation_status_guard).",
      "Trigger inventory_history writes every change to inventory_movements.",
    ],
  },
  inventory_movements: {
    why: "Every stock change with its delta and reason — the full stock ledger.",
    dml: ["INSERT: only by the trigger record_inventory_movement. No database role may write it directly (no INSERT grant), so the ledger cannot be forged.", "SELECT: Stock movements screen and analytics."],
  },
  resource_requests: {
    why: "The header of a camp's request: who raised it, when it is needed, priority and status. Status follows a state machine and is recomputed by the procedure refresh_request_status.",
    dml: [
      "INSERT: New request (with its request_items in the same transaction). Before inserting, lock_request_parents() checks with FOR SHARE that the camp is open and the disaster active.",
      "UPDATE: approve / reject / cancel (only legal transitions), and CALL refresh_request_status() after allocations and deliveries.",
      "No DELETE (cancel instead).",
      "Trigger row_change_log records changes.",
    ],
  },
  request_items: {
    why: "The lines of a request (weak entity): which resource and how much. PK (request_id, resource_id) means a resource can appear only once per request.",
    dml: ["INSERT: together with the request header, via INSERT … SELECT FROM unnest($ids, $quantities).", "Deleted automatically with the request (ON DELETE CASCADE)."],
  },
  allocations: {
    why: "A commitment of stock to a request. Status: ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED.",
    dml: [
      "INSERT: Plan allocation (with its allocation_items in the same transaction).",
      "UPDATE status: by the delivery flow (IN_TRANSIT, DELIVERED) or a cancellation (CANCELLED). The trigger allocation_status_guard enforces the state machine and restores stock on cancellation.",
      "No DELETE: the FK from allocation_items and the immutability rules keep allocation history.",
    ],
  },
  allocation_items: {
    why: "The lines of an allocation: how much of which resource from which warehouse. Three composite foreign keys guarantee that you can only allocate a resource the request asked for, from a warehouse that stocks it.",
    dml: ["INSERT only. The BEFORE trigger validate_allocation_item checks stock and outstanding demand; the AFTER trigger trg_adjust_inventory deducts the stock.", "No UPDATE or DELETE: both are rejected by the trigger ('Allocation lines are immutable'), so allocation history cannot be rewritten."],
  },
  vehicles: {
    why: "The fleet. A vehicle has one current status and an optional last known location.",
    dml: ["INSERT / UPDATE / DELETE: management screen (DELETE refused once used in a delivery).", "UPDATE status: set to IN_USE when a delivery is planned, back to AVAILABLE when it is delivered or cancelled.", "Trigger row_change_log records changes."],
    notes: ["Column privilege: a driver may UPDATE only status and current_location_id."],
  },
  volunteers: {
    why: "People who can crew deliveries. availability_status prevents assigning the same volunteer twice.",
    dml: ["INSERT / UPDATE / DELETE: management screen.", "UPDATE availability: ASSIGNED when added to a delivery (only if currently AVAILABLE — a conditional UPDATE), AVAILABLE again when the delivery ends.", "Trigger row_change_log records changes."],
  },
  deliveries: {
    why: "The transport of one allocation with a vehicle, a driver and a crew. Partial unique indexes allow only one active delivery per vehicle, per driver and per allocation. Row-level security lets a driver see only their own deliveries.",
    dml: [
      "INSERT: Plan delivery (with delivery_volunteers). Trigger delivery_vehicle_guard refuses a vehicle under maintenance.",
      "UPDATE status / departure_time / actual_arrival: dispatch, delay, deliver, cancel. Trigger delivery_status_guard allows only legal transitions.",
      "Trigger row_change_log records changes.",
    ],
    notes: ["Row-level security: policies deliveries_driver_own / deliveries_driver_update_own (driver_id = current user), deliveries_officer_read, deliveries_staff_all."],
  },
  delivery_volunteers: {
    why: "Resolves the many-to-many relationship Delivery CREWED BY Volunteer, with the volunteer's role on that trip.",
    dml: ["INSERT: when a delivery is planned.", "Deleted with the delivery or the volunteer (ON DELETE CASCADE)."],
  },
  audit_logs: {
    why: "Business-level audit trail: who performed which action (approve, allocate, reset password…) with details as JSON, written in the same transaction as the change itself.",
    dml: ["INSERT: by the API in the same transaction as each change. Never updated or deleted."],
  },
  data_change_log: {
    why: "Field-level change history (old → new value of every changed column), written automatically by the trigger log_row_change on eight operational tables.",
    dml: ["INSERT: only by the SECURITY DEFINER trigger log_row_change. No role may insert directly, so history cannot be forged.", "SELECT: Change history screen."],
  },
  integration_sync_runs: {
    why: "One row per synchronisation run to Neo4j or the vector database: status, attempts, records synced, error detail.",
    dml: ["INSERT when a run starts; UPDATE when it succeeds or fails (with retry count)."],
  },
  schema_migrations: {
    why: "Which migration files have been applied, so each runs exactly once and existing data is never re-processed.",
    dml: ["INSERT: by scripts/migrate.ts after a file has run successfully."],
  },
};

const TRIGGER_FN: Record<string, { purpose: string; steps: string[]; example?: string }> = {
  validate_allocation_item: {
    purpose: "Guards every allocation line before it is written: the request must be approved, the allocation active, the warehouse active, and the quantity must not exceed the stock or the outstanding demand.",
    steps: [
      "If the operation is UPDATE or DELETE → error 'Allocation lines are immutable' (history cannot be rewritten).",
      "Locks the request row (FOR UPDATE) and checks status is APPROVED or PARTIALLY_FULFILLED.",
      "Checks the parent allocation is still ALLOCATED.",
      "Locks the request line and the stock line (FOR UPDATE) — so two coordinators cannot both take the last units.",
      "Checks the warehouse is ACTIVE.",
      "Adds up what is already allocated for this request line (ignoring cancelled allocations).",
      "If quantity > stock, or already allocated + quantity > requested → error 'Insufficient stock or allocation exceeds outstanding quantity'. The whole transaction rolls back.",
    ],
    example: "Allocating 500 litres when only 350 are outstanding → 409 Conflict, nothing is written.",
  },
  adjust_inventory_for_allocation: {
    purpose: "Keeps stock in step with allocation lines automatically, in the same transaction.",
    steps: ["INSERT of a line → inventory.quantity_available − quantity_allocated.", "DELETE → adds the quantity back. UPDATE → adds back the old and deducts the new (in practice lines are immutable).", "Because the stock CHECK (quantity_available >= 0) is evaluated on this UPDATE, stock can never go negative even under concurrency."],
  },
  allocation_status_guard: {
    purpose: "State machine for allocations, and exact-once stock restoration on cancellation.",
    steps: [
      "request_id, allocated_by and allocated_at can never change ('Allocation identity is immutable').",
      "Only ALLOCATED → IN_TRANSIT / CANCELLED and IN_TRANSIT → DELIVERED are allowed.",
      "On CANCELLED: refuses if a non-cancelled delivery still exists; locks the affected stock lines in a fixed order; adds the allocated quantities back to inventory with the reason 'Allocation cancellation #id'.",
      "Because the status can change to CANCELLED only once, stock is restored exactly once.",
    ],
  },
  delivery_status_guard: {
    purpose: "State machine for deliveries.",
    steps: ["Allowed: PLANNED → IN_TRANSIT / CANCELLED; IN_TRANSIT → DELAYED / DELIVERED; DELAYED → IN_TRANSIT / DELIVERED.", "Anything else (e.g. DELIVERED → PLANNED) → error 'Invalid delivery transition X -> Y'."],
  },
  delivery_vehicle_guard: {
    purpose: "Refuses to plan a delivery with a vehicle that is under maintenance.",
    steps: ["Locks the vehicle row (FOR UPDATE) and reads its status.", "If MAINTENANCE → error 'Vehicle is under maintenance'."],
  },
  prevent_operational_duplicate: {
    purpose: "Stops the same disaster or warehouse being entered twice with slightly different spelling.",
    steps: [
      "Compares names case-insensitively and ignoring surrounding spaces (lower(btrim(...))).",
      "Disasters: same name + type + start date + location = duplicate. Warehouses: same name at the same location = duplicate.",
      "Takes a transaction-level advisory lock first, so two simultaneous inserts of the same event cannot both pass the check.",
    ],
  },
  record_inventory_movement: {
    purpose: "Writes the stock ledger: every change of inventory.quantity_available becomes a row in inventory_movements.",
    steps: ["delta = new quantity − old quantity (or the full quantity for a new line).", "reason comes from the transaction setting reliefflow.reason (set by the API or by a cancellation), default 'Stock adjustment'.", "SECURITY DEFINER: runs with the owner's rights, because no application role may write the ledger directly."],
  },
  log_row_change: {
    purpose: "Generic field-level audit trigger attached to eight tables.",
    steps: [
      "Converts the OLD and NEW rows to JSONB (dropping password_hash and search_vector).",
      "For UPDATE, builds { column: { from, to } } for changed columns only; an UPDATE that changed nothing is not logged.",
      "Inserts table name, operation, row data, changed fields and the acting user (from reliefflow.user_id, set by the API in each transaction).",
      "SECURITY DEFINER, so history is written even though no role can write data_change_log directly.",
    ],
  },
};

const VIEWS: Record<string, string> = {
  v_low_stock: "Stock lines at or below their minimum threshold, with warehouse and resource names. Drives low-stock alerts.",
  v_request_fulfillment: "For every request line: requested, allocated (ignoring cancelled allocations) and remaining quantity. The basis of fulfilment progress and of the procedure refresh_request_status.",
  v_warehouse_inventory_summary: "One row per warehouse: number of stock lines, units available, low-stock lines and last stock change (LEFT JOIN so empty warehouses appear too).",
  v_resource_demand: "Outstanding demand vs available stock per resource, using two CTEs (demand, supply). net_position < 0 means a shortage.",
  v_disaster_response_summary: "One row per disaster with correlated subqueries: affected locations and population, total and open requests, units allocated.",
};
const FUNCTIONS: Record<string, string> = {
  refresh_request_status: "PROCEDURE (called with CALL). The single source of truth for a request's status: recomputes APPROVED / PARTIALLY_FULFILLED / ALLOCATED / IN_TRANSIT / DELIVERED from its allocations and v_request_fulfillment, and updates the row only if the status changed. Called by the API after every allocation, cancellation and delivery update.",
  resource_availability: "Total stock of one resource across ACTIVE warehouses.",
  remaining_request_quantity: "Outstanding quantity of one resource on one request (requested − allocated, never below 0).",
  request_fulfillment_pct: "Percentage of a request's total quantity that has been allocated.",
  operational_summary: "Set-returning function: the dashboard KPIs (active disasters, affected population, open camps, open requests, low-stock lines, active deliveries) in one call.",
  lock_request_parents: "SECURITY DEFINER. Locks the camp and disaster rows with FOR SHARE while a request is created and returns their status, so a camp cannot be closed (or a disaster closed) halfway through creating a request — even though a field officer has no UPDATE right on those tables.",
};

const MIGRATION_ABOUT: Record<string, string> = {
  "001_schema.sql": "Base schema: the 18 core tables with primary keys, foreign keys, CHECK constraints, the first indexes and the allocation triggers.",
  "002_seed.sql": "Reference data: the four roles and starter categories (INSERT).",
  "003_sql_demonstrations.sql": "Coursework examples of DDL/DML/queries (run manually; not part of the live schema).",
  "004_operational_demo.sql": "Optional demo data (INSERT only, safe to re-run).",
  "005_integrity_security.sql": "Hardening: sessions, login_attempts, audit_logs, inventory_movements; stricter CHECKs (NOT VALID), the reworked validation trigger and stock ledger trigger.",
  "006_allocation_history.sql": "Makes allocation history immutable and adds the allocation state-machine trigger with exact-once stock restoration.",
  "007_dbms_engineering.sql": "Foreign-key indexes, partial unique indexes against double booking, delivery triggers, the five views, functions and procedure, field-level audit (data_change_log), full-text search columns, integration_sync_runs and schema_migrations.",
  "008_rbac_dictionary.sql": "Database roles rf_admin / rf_coordinator / rf_field_officer / rf_driver with table and column GRANTs, row-level security on deliveries, SECURITY DEFINER history triggers, extra format CHECKs and COMMENT ON for every table and column.",
};

// ---------------------------------------------------------------------------------------------
const md: string[] = [];
const out = (...l: string[]) => md.push(...l);
const code = (lang: string, s: string) => out("```" + lang, s.trim(), "```", "");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const DEL: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
const DEL_MEANING: Record<string, string> = {
  RESTRICT: "the parent row cannot be deleted while child rows refer to it",
  "NO ACTION": "the parent row cannot be deleted while child rows refer to it (checked at the end of the statement)",
  CASCADE: "deleting the parent row deletes these child rows too",
  "SET NULL": "deleting the parent row sets this reference to NULL (the child row stays)",
};

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];
  try {
    const tables = await q<{ t: string; comment: string | null }>(
      `SELECT c.relname AS t, obj_description(c.oid) AS comment FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1`);
    const cols = await q<{ t: string; name: string; type: string; notnull: boolean; def: string | null; identity: string; generated: string; comment: string | null; pos: number }>(
      `SELECT c.relname AS t, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
              pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS identity, a.attgenerated AS generated,
              col_description(c.oid, a.attnum) AS comment, a.attnum AS pos
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1, a.attnum`);
    const cons = await q<{ t: string; name: string; type: string; def: string; parent: string | null; deltype: string; cols: string[]; refcols: string[] | null }>(
      `SELECT c.relname AS t, k.conname AS name, k.contype AS type, pg_get_constraintdef(k.oid) AS def, p.relname AS parent, k.confdeltype AS deltype,
              ARRAY(SELECT attname::text FROM unnest(k.conkey) WITH ORDINALITY u(n, o) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY o) AS cols,
              CASE WHEN k.contype = 'f' THEN ARRAY(SELECT attname::text FROM unnest(k.confkey) WITH ORDINALITY u(n, o) JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY o) END AS refcols
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid LEFT JOIN pg_class p ON p.oid = k.confrelid
        WHERE c.relnamespace = 'public'::regnamespace AND k.contype IN ('p','u','f','c') ORDER BY 1, CASE k.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, 2`);
    const idx = await q<{ t: string; name: string; def: string; constraint: boolean }>(
      `SELECT i.tablename AS t, i.indexname AS name, i.indexdef AS def, EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname = i.indexname) AS constraint
         FROM pg_indexes i WHERE i.schemaname = 'public' ORDER BY 1, 2`);
    const trg = await q<{ t: string; name: string; fn: string; def: string }>(
      `SELECT c.relname AS t, t.tgname AS name, p.proname AS fn, pg_get_triggerdef(t.oid) AS def
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace ORDER BY 1, 2`);
    const fns = await q<{ name: string; kind: string; src: string; secdef: boolean }>(
      `SELECT p.proname AS name, p.prokind AS kind, pg_get_functiondef(p.oid) AS src, p.prosecdef AS secdef FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1) ORDER BY 1`, [[...Object.keys(TRIGGER_FN), ...Object.keys(FUNCTIONS)]]);
    const views = await q<{ name: string; def: string }>(`SELECT viewname AS name, definition AS def FROM pg_views WHERE schemaname = 'public' ORDER BY 1`);
    const policies = await q<{ t: string; name: string; cmd: string; roles: string[]; qual: string | null; check: string | null }>(
      `SELECT tablename AS t, policyname AS name, cmd, roles::text[] AS roles, qual, with_check AS check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`);
    const grants = await q<{ t: string; role: string; privs: string }>(
      `SELECT table_name AS t, grantee AS role, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND grantee LIKE 'rf\\_%' AND grantee <> 'rf_lab' GROUP BY 1, 2 ORDER BY 1, 2`);
    const colGrants = await q<{ t: string; role: string; priv: string; cols: string }>(
      `SELECT cp.table_name AS t, cp.grantee AS role, cp.privilege_type AS priv, string_agg(cp.column_name, ', ' ORDER BY cp.column_name) AS cols
         FROM information_schema.column_privileges cp
        WHERE cp.table_schema = 'public' AND cp.grantee LIKE 'rf\\_%' AND cp.grantee <> 'rf_lab'
          AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.table_schema = 'public' AND g.table_name = cp.table_name AND g.grantee = cp.grantee AND g.privilege_type = cp.privilege_type)
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);

    const known = new Set(GROUPS.flatMap((g) => g.tables));
    const missing = tables.map((t) => t.t).filter((t) => !known.has(t) || !TABLES[t]);
    if (missing.length) throw new Error("Tables without an explanation: " + missing.join(", "));
    const files = readdirSync("db/postgres").filter((f) => f.endsWith(".sql")).sort();
    const createdIn = (t: string) => files.find((f) => new RegExp(`CREATE TABLE (IF NOT EXISTS )?${t}\\b`).test(readFileSync(resolve("db/postgres", f), "utf8"))) ?? "?";
    const fks = cons.filter((c) => c.type === "f");
    const colOf = (t: string, n: string) => cols.find((c) => c.t === t && c.name === n)!;
    const isUniqueSet = (t: string, set: string[]) => cons.some((c) => c.t === t && (c.type === "p" || c.type === "u") && c.cols.length === set.length && c.cols.every((x) => set.includes(x)));

    // ------------------------------------------------------------------ title + intro
    out(
      `<div class="titlepage">`,
      `<div class="tp-uni">PES University</div>`,
      `<div class="tp-dept">Department of Computer Science and Engineering · DBMS Experiential Learning, Level 3</div>`,
      `<div class="tp-title">ReliefFlow</div>`,
      `<div class="tp-subtitle">The Database, Explained<br/>Every table, every relationship, the DDL that creates them, the DML that changes them, and every trigger, view, function and procedure</div>`,
      `<table class="tp-team"><thead><tr><th>Member</th><th>SRN</th></tr></thead><tbody>`,
      `<tr><td>SUJAL Y</td><td>PES1UG24CS475</td></tr>`,
      `<tr><td>SUJAN H</td><td>PES1UG24CS477</td></tr>`,
      `</tbody></table>`,
      `<div class="tp-meta">Generated from the live PostgreSQL catalog on ${new Date().toLocaleDateString("en-IN", { dateStyle: "long" })}</div>`,
      `</div>`,
      "",
      "# ReliefFlow — The Database, Explained",
      "",
      "## 1. How to read this document",
      "",
      "This document explains the whole PostgreSQL database of ReliefFlow, one piece at a time.",
      "",
      "* **Section 2** gives the big picture: what the database stores and how the tables are grouped.",
      "* **Section 3** explains every **relationship** (foreign key): what it means in plain English, its cardinality, and what happens on delete.",
      "* **Section 4** is the **DDL**: which files create the database, in what order, and then every table with its exact `CREATE TABLE` statement, columns, constraints, indexes and triggers.",
      "* **Section 5** covers the other DDL objects: **views, functions, the procedure, indexes, roles and row-level security**.",
      "* **Section 6** explains every **trigger**: when it fires, what it does step by step, and its source code.",
      "* **Section 7** is the **DML**: which INSERT / UPDATE / DELETE / SELECT statements the application runs, table by table and as one complete workflow, including which triggers fire.",
      "",
      "> Everything structural here (columns, types, constraints, indexes, trigger and function source) is read directly from the running database, so it is exactly what is installed, not a copy that can go out of date.",
      "",
      `| What | Count |`,
      `|---|---|`,
      `| Tables | ${tables.length} |`,
      `| Columns | ${cols.length} |`,
      `| Primary keys / foreign keys | ${cons.filter((c) => c.type === "p").length} / ${fks.length} |`,
      `| UNIQUE / CHECK constraints | ${cons.filter((c) => c.type === "u").length} / ${cons.filter((c) => c.type === "c").length} |`,
      `| Indexes | ${idx.length} |`,
      `| Views / functions / procedures | ${views.length} / ${fns.filter((f) => f.kind === "f" && !TRIGGER_FN[f.name]).length} / ${fns.filter((f) => f.kind === "p").length} |`,
      `| Trigger functions / trigger attachments | ${Object.keys(TRIGGER_FN).length} / ${trg.length} |`,
      `| Database roles / row-level security policies | 4 / ${policies.length} |`,
      "",
    );

    // ------------------------------------------------------------------ 2. big picture
    out(
      "## 2. The big picture",
      "",
      "ReliefFlow coordinates disaster relief. The data follows the real workflow:",
      "",
      "```",
      "Disaster ──affects──▶ Locations ◀── Relief camp ──raises──▶ Resource request ──contains──▶ Request items",
      "                                                         │ PENDING → APPROVED",
      "                                                         ▼",
      "      Warehouse ──holds──▶ Inventory (stock line) ──▶ Allocation + allocation items   (stock deducted by trigger)",
      "                                                         ▼",
      "                    Vehicle + driver + volunteers ──▶ Delivery: PLANNED → IN_TRANSIT → DELIVERED",
      "                                                         ▼",
      "                         request status recomputed by the procedure refresh_request_status",
      "```",
      "",
      "The 25 tables fall into eight groups:",
      "",
      "| Group | Tables | What it is for |",
      "|---|---|---|",
      ...GROUPS.map((g) => `| **${g.name}** | ${g.tables.map((t) => "`" + t + "`").join(", ")} | ${g.about} |`),
      "",
      "Design rules used throughout:",
      "",
      "* Every table has a **primary key**; most use a surrogate key `GENERATED ALWAYS AS IDENTITY` (an auto-number the application cannot override).",
      "* Natural uniqueness is still enforced with **UNIQUE** (e-mail, vehicle number, category name, role name).",
      "* Rules the data must always obey are **CHECK constraints** inside the database (stock ≥ 0, occupancy ≤ capacity, status values, e-mail format), so no program can break them.",
      "* History is never deleted: users are deactivated, camps closed, requests cancelled. Foreign keys use **RESTRICT** to protect history and **CASCADE** only for detail rows owned by their parent.",
      "* The schema is in **3NF/BCNF**: each fact is stored once (a location's name lives only in `locations`, a resource's unit only in `resources`).",
      "",
    );

    // ------------------------------------------------------------------ 3. relationships
    out(
      "## 3. How the tables are related",
      "",
      `There are ${fks.length} foreign keys. Each one is a relationship between a **child** table (which holds the foreign key column) and a **parent** table (whose primary key it refers to).`,
      "",
      "How to read the cardinality:",
      "",
      "* **1 : N** — one parent row can have many child rows; each child row points to one parent.",
      "* **mandatory** — the FK column is NOT NULL, so every child row must have a parent (total participation in the ER diagram).",
      "* **optional** — the FK column is nullable (partial participation).",
      "",
      "### 3.1 Special relationship patterns",
      "",
      "* **Many-to-many (M:N)** relationships become their own table with a composite primary key:",
      "  * `disaster_locations` (Disaster AFFECTS Location) — also stores impact_level, affected_population, reported_at.",
      "  * `delivery_volunteers` (Delivery CREWED BY Volunteer) — also stores assigned_role.",
      "* **Weak entities** — rows identified through their owner:",
      "  * `request_items` (PK request_id + resource_id): a request line has no meaning without its request.",
      "  * `inventory` (PK warehouse_id + resource_id): a stock line is \"resource X in warehouse Y\".",
      "* **Composite foreign keys** in `allocation_items`:",
      "  * `(request_id, resource_id) → request_items`: you can only allocate a resource **that the request asked for**.",
      "  * `(warehouse_id, resource_id) → inventory`: you can only draw it **from a warehouse that stocks that resource**.",
      "  * `(allocation_id, request_id) → allocations`: the line's allocation must belong to the same request.",
      "  * A single-column FK could not express any of these rules.",
      "* **Several relationships to the same parent**: `deliveries` refers to `locations` twice (source and destination); `app_users` is referenced by eight tables (who created, requested, allocated, drove, managed…).",
      "",
      "### 3.2 Every foreign key",
      "",
    );
    const byChild = new Map<string, typeof fks>();
    for (const f of fks) byChild.set(f.t, [...(byChild.get(f.t) ?? []), f]);
    for (const g of GROUPS) {
      const rows = g.tables.flatMap((t) => byChild.get(t) ?? []);
      if (!rows.length) continue;
      out(`#### ${g.name}`, "", "| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |", "|---|---|---|---|---|");
      for (const f of rows) {
        const nullable = f.cols.some((c) => !colOf(f.t, c).notnull);
        const oneToOne = isUniqueSet(f.t, f.cols);
        const del = DEL[f.deltype] ?? f.deltype;
        const meaning = `${nullable ? "A" : "Every"} ${f.t} row ${nullable ? "may" : "must"} refer to one ${f.parent} row; one ${f.parent} row ${oneToOne ? "has at most one" : "can have many"} ${f.t} rows. ON DELETE ${del}: ${DEL_MEANING[del] ?? del}.`;
        out(`| \`${f.t}(${f.cols.join(", ")})\` | \`${f.parent}(${(f.refcols ?? []).join(", ")})\` | ${oneToOne ? "1 : 1" : "1 : N"}, ${nullable ? "optional" : "mandatory"} | ${del} | ${cell(meaning)} |`);
      }
      out("");
    }

    // ------------------------------------------------------------------ 4. DDL
    out(
      "---",
      "",
      "## 4. DDL — how the database is created",
      "",
      "DDL (Data Definition Language) is the part of SQL that defines structure: `CREATE`, `ALTER`, `DROP`, `COMMENT`, `GRANT`. ReliefFlow's DDL lives in `db/postgres/`. The base schema is run once on a new database; after that, **incremental migrations** are applied by `npm run db:migrate` (`scripts/migrate.ts`), each exactly once, recorded in `schema_migrations`. They only add things (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT … NOT VALID`), so existing data is never dropped or rewritten.",
      "",
      "| File | What it does |",
      "|---|---|",
      ...files.map((f) => `| \`${f}\` | ${MIGRATION_ABOUT[f] ?? ""} |`),
      "",
      "DDL techniques used, with an example of each:",
      "",
      "| Technique | Example in ReliefFlow |",
      "|---|---|",
      "| `CREATE TABLE` with PK, FK, CHECK, UNIQUE, DEFAULT | every table below |",
      "| Identity column | `allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |",
      "| Generated (computed) column | `search_vector tsvector GENERATED ALWAYS AS (to_tsvector(...)) STORED` on disasters and resource_requests |",
      "| `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | disasters.event_location_id, search_vector (migration 007) |",
      "| `ALTER TABLE … ADD CONSTRAINT … NOT VALID` | format and consistency checks added to a live database without rejecting old rows (005, 008) |",
      "| `DROP … IF EXISTS` then re-create | triggers and constraints are re-created idempotently (`DROP TRIGGER IF EXISTS …; CREATE TRIGGER …`) |",
      "| `CREATE INDEX` / `CREATE UNIQUE INDEX … WHERE` | FK indexes, GIN full-text and trigram indexes, partial unique indexes against double booking |",
      "| `CREATE VIEW`, `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE TRIGGER` | Sections 5 and 6 |",
      "| `CREATE ROLE`, `GRANT`, `REVOKE`, `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` | Section 5.5 (migration 008) |",
      "| `COMMENT ON TABLE / COLUMN` | the data dictionary: every description in this document comes from these comments |",
      "",
      "### 4.1 Every table",
      "",
      "For each table: why it exists, its exact `CREATE TABLE` statement as it is installed now (reconstructed from the catalog, including constraints added later by ALTER), the columns explained, its indexes and triggers, who may access it, and the DML the application performs on it.",
      "",
    );
    for (const g of GROUPS) {
      out(`### ${g.name}`, "", g.about, "");
      for (const t of g.tables) {
        const meta = tables.find((x) => x.t === t)!;
        const note = TABLES[t];
        const tc = cols.filter((c) => c.t === t);
        const tk = cons.filter((c) => c.t === t);
        const pk = tk.find((c) => c.type === "p");
        const fkCols = new Set(tk.filter((c) => c.type === "f").flatMap((c) => c.cols));
        const uqCols = new Set(tk.filter((c) => c.type === "u" && c.cols.length === 1).flatMap((c) => c.cols));
        out(`#### ${t}`, "", `**Purpose:** ${meta.comment ?? ""}`, "", `**Why it exists:** ${note.why}`, "", `Created in \`${createdIn(t)}\`.`, "");
        const lines = tc.map((c) => {
          let s = `  ${c.name} ${c.type}`;
          if (c.identity === "a") s += " GENERATED ALWAYS AS IDENTITY";
          else if (c.identity === "d") s += " GENERATED BY DEFAULT AS IDENTITY";
          if (c.generated === "s") s += ` GENERATED ALWAYS AS (${c.def}) STORED`;
          else if (c.def) s += ` DEFAULT ${c.def}`;
          if (c.notnull && !c.identity) s += " NOT NULL";
          return s;
        });
        for (const k of tk) lines.push(`  CONSTRAINT ${k.name} ${k.def}`);
        code("sql", `CREATE TABLE ${t} (\n${lines.join(",\n")}\n);`);
        out("| Column | Type | Key | Null | Meaning |", "|---|---|---|---|---|");
        for (const c of tc) {
          const key = [pk?.cols.includes(c.name) ? "PK" : "", fkCols.has(c.name) ? "FK" : "", uqCols.has(c.name) ? "UQ" : ""].filter(Boolean).join(", ");
          out(`| \`${c.name}\` | ${cell(c.type)}${c.generated === "s" ? " (generated)" : c.identity ? " (identity)" : ""} | ${key} | ${c.notnull ? "NOT NULL" : "nullable"} | ${cell(c.comment ?? "")} |`);
        }
        out("");
        const checks = tk.filter((k) => k.type === "c");
        if (checks.length) {
          out("**CHECK constraints** (rules the database itself enforces):", "");
          for (const k of checks) out(`* \`${k.name}\`: \`${k.def}\``);
          out("");
        }
        const ti = idx.filter((i) => i.t === t);
        if (ti.length) {
          out("**Indexes:**", "");
          for (const i of ti) {
            const kind = /USING gin/.test(i.def) ? "GIN" : /USING hnsw/.test(i.def) ? "HNSW" : "B-tree";
            const tag = i.constraint ? " — created automatically by a PRIMARY KEY / UNIQUE constraint" : / WHERE /.test(i.def) ? " — partial index (only rows matching the WHERE)" : "";
            out(`* \`${i.name}\` (${kind}${/UNIQUE/.test(i.def) ? ", unique" : ""})${tag}: \`${i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\./, "ON ")}\``);
          }
          out("");
        }
        const tt = trg.filter((x) => x.t === t);
        if (tt.length) {
          out("**Triggers on this table:**", "");
          for (const x of tt) out(`* \`${x.name}\` → function \`${x.fn}()\`: ${TRIGGER_FN[x.fn]?.purpose ?? ""} (\`${x.def.replace(/^CREATE TRIGGER \S+ /, "").replace(/ ON public\.\S+/, "").replace(/ EXECUTE FUNCTION.*/, "")}\`)`);
          out("");
        }
        const tg = grants.filter((x) => x.t === t);
        const tcg = colGrants.filter((x) => x.t === t);
        if (tg.length || tcg.length) {
          out("**Database access (GRANTs):**", "");
          for (const x of tg) out(`* \`${x.role}\`: ${x.privs}`);
          for (const x of tcg) out(`* \`${x.role}\`: ${x.priv} only on columns (${x.cols})`);
          for (const n of note.notes ?? []) out(`* ${n}`);
          out("");
        }
        out("**DML performed on this table:**", "");
        for (const d of note.dml) out(`* ${d}`);
        out("");
      }
    }

    // ------------------------------------------------------------------ 5. other objects
    out("---", "", "## 5. Views, functions, procedure, indexes and security", "", "### 5.1 Views", "",
      "A view is a stored SELECT with a name. It stores no data; every time it is queried, PostgreSQL runs the query on the current rows. Views hide join complexity and give the application a stable interface.", "");
    for (const v of views) { out(`#### ${v.name}`, "", VIEWS[v.name] ?? "", ""); code("sql", `CREATE VIEW ${v.name} AS\n${v.def}`); }
    out("### 5.2 Functions and the stored procedure", "",
      "* A **function** returns a value and is used inside SQL (`SELECT resource_availability(5)`).",
      "* A **procedure** is executed with `CALL` and performs an action (`CALL refresh_request_status(12)`).",
      "* `STABLE` means the function does not modify data and returns the same result within one statement, so the planner can optimise calls.",
      "* `SECURITY DEFINER` means the function runs with the rights of its owner rather than the caller — used where a restricted role must perform one specific, controlled action.", "");
    for (const name of Object.keys(FUNCTIONS)) {
      const f = fns.find((x) => x.name === name);
      if (!f) continue;
      out(`#### ${name}${f.kind === "p" ? " (procedure)" : ""}`, "", FUNCTIONS[name], "");
      code("sql", f.src);
    }
    const idxKinds = { btree: idx.filter((i) => !/USING (gin|hnsw)/.test(i.def)).length, gin: idx.filter((i) => /USING gin/.test(i.def)).length, partial: idx.filter((i) => / WHERE /.test(i.def)).length, pk: idx.filter((i) => i.constraint).length };
    out(
      "### 5.3 Indexes",
      "",
      `There are ${idx.length} indexes (${idxKinds.pk} created automatically by PRIMARY KEY / UNIQUE constraints). Each table's indexes are listed in Section 4.`,
      "",
      "| Kind | Count | Used for |",
      "|---|---|---|",
      `| B-tree | ${idxKinds.btree} | equality and range search, ORDER BY, joins on foreign keys |`,
      `| GIN | ${idxKinds.gin} | full-text search on tsvector columns, fuzzy name search (pg_trgm) |`,
      `| Partial (WHERE …) | ${idxKinds.partial} | e.g. only *active* deliveries must be unique per vehicle / driver / allocation — finished deliveries are ignored |`,
      "",
      "Why every foreign key has an index: joins use it, and when a parent row is deleted PostgreSQL must find child rows — without an index that is a full scan of the child table.",
      "",
      "### 5.4 Constraint summary",
      "",
      "| Constraint | Count | Example |",
      "|---|---|---|",
      `| PRIMARY KEY | ${cons.filter((c) => c.type === "p").length} | \`PRIMARY KEY (warehouse_id, resource_id)\` on inventory |`,
      `| FOREIGN KEY | ${fks.length} | \`FOREIGN KEY (request_id, resource_id) REFERENCES request_items\` |`,
      `| UNIQUE | ${cons.filter((c) => c.type === "u").length} | \`UNIQUE (email)\` on app_users |`,
      `| CHECK | ${cons.filter((c) => c.type === "c").length} | \`CHECK (quantity_available >= 0)\` on inventory |`,
      `| NOT NULL | ${cols.filter((c) => c.notnull).length} columns | every mandatory attribute |`,
      "",
      "### 5.5 Database roles, GRANTs and row-level security",
      "",
      "Authorisation is enforced by PostgreSQL itself, not only by the application:",
      "",
      "1. The application authenticates the user and knows their role.",
      "2. Every API transaction starts with `SET LOCAL ROLE rf_<role>` and `set_config('reliefflow.user_id', <id>, true)`.",
      "3. From then on PostgreSQL checks every statement against that role's GRANTs and the row-level-security policies.",
      "",
      "| Database role | Application role | In short |",
      "|---|---|---|",
      "| `rf_admin` | ADMIN | everything, including password hashes and user management |",
      "| `rf_coordinator` | RELIEF_COORDINATOR | read and change all operational data; read history |",
      "| `rf_field_officer` | FIELD_OFFICER | read operations, raise requests, update camp occupancy only |",
      "| `rf_driver` | DRIVER | read operations; progress only their own deliveries |",
      "",
      "Row-level security policies (a policy is a WHERE condition PostgreSQL adds to every query on the table for the given roles):",
      "",
      "| Table | Policy | Command | Roles | Condition |",
      "|---|---|---|---|---|",
      ...policies.map((p) => `| ${p.t} | \`${p.name}\` | ${p.cmd} | ${p.roles.join(", ")} | \`${cell(p.qual ?? p.check ?? "true")}\` |`),
      "",
      "Effect: the same `SELECT * FROM deliveries` returns all rows for a coordinator but only the driver's own rows for a driver, and an `UPDATE` of another driver's delivery affects 0 rows.",
      "",
      "```sql",
      "BEGIN;",
      "SELECT set_config('reliefflow.user_id', '11', true);",
      "SET LOCAL ROLE rf_driver;",
      "SELECT count(*) FROM deliveries;              -- only driver 11's deliveries",
      "SELECT password_hash FROM app_users;          -- ERROR: permission denied for table app_users",
      "UPDATE inventory SET quantity_available = 0;  -- ERROR: permission denied for table inventory",
      "ROLLBACK;",
      "```",
      "",
    );

    // ------------------------------------------------------------------ 6. triggers
    out("---", "", "## 6. Triggers — every one explained", "",
      "A trigger makes PostgreSQL run a function automatically when rows are inserted, updated or deleted. ReliefFlow uses triggers for rules that must hold **no matter which program changes the data**.",
      "",
      "* **BEFORE** triggers run before the row is written and can reject it (`RAISE EXCEPTION` → the whole transaction rolls back).",
      "* **AFTER** triggers run once the row is written and are used for side effects (deduct stock, write history).",
      "* **FOR EACH ROW** means the function runs once per affected row, with `OLD` (row before) and `NEW` (row after) available. `TG_OP` tells it whether this is INSERT, UPDATE or DELETE.",
      "* A trigger runs **inside the same transaction** as the statement that fired it: if anything fails, the change and all its side effects are undone together.",
      "",
      "| Trigger | Table | Timing | Events | Function |",
      "|---|---|---|---|---|",
      ...trg.map((x) => {
        const m = /CREATE TRIGGER \S+ (BEFORE|AFTER) (.*?) ON /.exec(x.def);
        return `| \`${x.name}\` | ${x.t} | ${m?.[1] ?? ""} | ${cell(m?.[2] ?? "")} | \`${x.fn}()\` |`;
      }),
      "",
    );
    for (const [name, t] of Object.entries(TRIGGER_FN)) {
      const f = fns.find((x) => x.name === name);
      const on = trg.filter((x) => x.fn === name);
      out(`### ${name}()`, "", `**Purpose:** ${t.purpose}`, "", `**Attached to:** ${on.map((x) => `\`${x.t}\``).join(", ")}${f?.secdef ? " · runs as SECURITY DEFINER" : ""}`, "", "**What it does, step by step:**", "");
      t.steps.forEach((s, i) => out(`${i + 1}. ${s}`));
      out("");
      if (t.example) out(`**Example:** ${t.example}`, "");
      if (f) code("sql", f.src);
    }

    // ------------------------------------------------------------------ 7. DML
    out(
      "---",
      "",
      "## 7. DML — how the data is changed and read",
      "",
      "DML (Data Manipulation Language) is the part of SQL that works with the rows: `INSERT`, `UPDATE`, `DELETE` and `SELECT`. In ReliefFlow every DML statement:",
      "",
      "* is **parameterised** (`$1, $2, …`) — user input is sent separately from the SQL text, so SQL injection is impossible;",
      "* runs inside a **transaction** (`BEGIN … COMMIT`, or `ROLLBACK` on any error) as the user's **database role**;",
      "* is checked by the database's constraints and triggers, in addition to the API's own validation.",
      "",
      "### 7.1 DML statement types used",
      "",
      "| Statement | How ReliefFlow uses it | Example |",
      "|---|---|---|",
      "| `INSERT … VALUES … RETURNING` | create a row and get its generated id back in one round trip | `INSERT INTO resource_requests(…) VALUES ($1, …) RETURNING request_id` |",
      "| `INSERT … SELECT FROM unnest(…)` | insert many request lines in one statement | `INSERT INTO request_items(request_id, resource_id, quantity_requested) SELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) x(r, q)` |",
      "| `INSERT … ON CONFLICT DO NOTHING` | create-if-missing (stock line, login counter) | `INSERT INTO inventory(warehouse_id, resource_id) VALUES ($1, $2) ON CONFLICT DO NOTHING` |",
      "| `UPDATE … SET col = col + $n` | atomic relative change, no lost updates | camp admissions |",
      "| `UPDATE … WHERE … AND condition RETURNING` | conditional update: succeeds only if the row is still in the expected state | `UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE'` |",
      "| `UPDATE … WHERE xmin = $version` | optimistic locking: fails (0 rows) if someone else edited the row first | management edit forms |",
      "| `DELETE … RETURNING` | delete reference data; refused by FK RESTRICT if still in use | `DELETE FROM resource_categories WHERE category_id = $1` |",
      "| `SELECT … FOR UPDATE` / `FOR SHARE` | lock rows read inside a transaction | stock lines before allocating |",
      "| `SELECT` with JOIN, GROUP BY, HAVING, subqueries, CTEs, window functions | every list, dashboard and report | see the Project Report §11 |",
      "| `CALL procedure()` | run the status procedure | `CALL refresh_request_status($1)` |",
      "",
      "### 7.2 DML by table",
      "",
      "| Table | INSERT | UPDATE | DELETE | Fires triggers |",
      "|---|---|---|---|---|",
    );
    const has = (t: string, w: string) => (TABLES[t].dml.some((d) => d.toUpperCase().includes(w)) && !TABLES[t].dml.some((d) => new RegExp(`^No ${w}\\b`, "i").test(d)) ? "✔" : "—");
    for (const g of GROUPS)
      for (const t of g.tables) {
        const ts = [...new Set(trg.filter((x) => x.t === t).map((x) => x.name))];
        const del = TABLES[t].dml.some((d) => /^No (UPDATE or )?DELETE/i.test(d) || /^No DELETE/i.test(d)) ? "—" : TABLES[t].dml.some((d) => /DELETE|CASCADE/.test(d)) ? "✔" : "—";
        out(`| \`${t}\` | ${has(t, "INSERT")} | ${TABLES[t].dml.some((d) => /UPDATE/.test(d) && !/^No UPDATE/.test(d)) ? "✔" : "—"} | ${del} | ${ts.map((x) => "`" + x + "`").join(", ") || "—"} |`);
      }
    out(
      "",
      "(Details for each table are in Section 4 under *DML performed on this table*.)",
      "",
      "### 7.3 One complete workflow, statement by statement",
      "",
      "This is what happens in the database when a camp's request goes from creation to delivery. Each step is one API call = one transaction. The statements are the ones in `src/app/api/requests/route.ts` and `src/app/api/operations/route.ts`, slightly simplified (column lists shortened, `$…` are the parameters).",
      "",
      "#### Step 1 — A field officer raises a request",
      "",
      "```sql",
      "BEGIN;",
      "SET LOCAL ROLE rf_field_officer;                       -- database checks this role's GRANTs from now on",
      "SELECT camp_status, disaster_status FROM lock_request_parents($camp, $disaster);  -- FOR SHARE: camp/disaster cannot close meanwhile",
      "INSERT INTO resource_requests(camp_id, disaster_id, requested_by, need_by, priority_score, priority_level, medical_emergency, remarks)",
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING request_id;      -- status defaults to PENDING",
      "INSERT INTO request_items(request_id, resource_id, quantity_requested)",
      "SELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) AS x(r, q);   -- PK stops the same resource twice",
      "INSERT INTO audit_logs(user_id, action, details) VALUES ($user, 'REQUEST_CREATED', $json);",
      "COMMIT;",
      "```",
      "",
      "Triggers fired: `row_change_log` (resource_requests INSERT → data_change_log).",
      "",
      "#### Step 2 — A coordinator approves it",
      "",
      "```sql",
      "BEGIN;  SET LOCAL ROLE rf_coordinator;",
      "SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE;      -- lock, check it is PENDING",
      "UPDATE resource_requests SET status = 'APPROVED' WHERE request_id = $1;",
      "INSERT INTO audit_logs(...) VALUES (...);",
      "COMMIT;",
      "```",
      "",
      "Triggers fired: `row_change_log` (records status PENDING → APPROVED).",
      "",
      "#### Step 3 — The coordinator allocates stock",
      "",
      "```sql",
      "BEGIN;  SET LOCAL ROLE rf_coordinator;",
      "SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE;      -- lock order: request → lines → stock",
      "INSERT INTO allocations(request_id, allocated_by, remarks) VALUES ($1, $2, $3) RETURNING allocation_id;",
      "INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)",
      "VALUES ($a, $1, $r, $w, $q);                                               -- one per line",
      "CALL refresh_request_status($1);                                           -- → PARTIALLY_FULFILLED or ALLOCATED",
      "COMMIT;",
      "```",
      "",
      "Triggers fired, in order, for each allocation line:",
      "",
      "1. `trg_validate_allocation_item` (BEFORE INSERT) — locks the request line and stock line, checks stock and outstanding demand; rejects the whole transaction if either is exceeded.",
      "2. The row is inserted.",
      "3. `trg_adjust_inventory` (AFTER INSERT) — `UPDATE inventory SET quantity_available = quantity_available − q`.",
      "4. That UPDATE fires `inventory_history` (AFTER UPDATE on inventory) — inserts the movement into inventory_movements.",
      "5. `CALL refresh_request_status` updates the request status, which fires `row_change_log`.",
      "",
      "If two coordinators allocate the last stock at the same moment, the second one waits on the row lock taken in step 1; when the first commits, the second re-reads the stock, the check fails, and only the first allocation exists.",
      "",
      "#### Step 4 — A delivery is planned",
      "",
      "```sql",
      "BEGIN;  SET LOCAL ROLE rf_coordinator;",
      "SELECT 1 FROM resource_requests WHERE request_id = $r FOR UPDATE;",
      "SELECT 1 FROM allocations WHERE allocation_id = $a FOR UPDATE;",
      "SELECT status FROM vehicles WHERE vehicle_id = $v FOR UPDATE;",
      "INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id, expected_arrival)",
      "VALUES (...) RETURNING delivery_id;                                -- status PLANNED",
      "UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE' RETURNING volunteer_id;",
      "INSERT INTO delivery_volunteers(delivery_id, volunteer_id, assigned_role) VALUES (...);",
      "UPDATE vehicles SET status = 'IN_USE' WHERE vehicle_id = $v;",
      "COMMIT;",
      "```",
      "",
      "Triggers fired: `delivery_vehicle_guard` (BEFORE INSERT — refuses a vehicle in maintenance), `row_change_log` on deliveries, volunteers and vehicles. The partial unique indexes reject a second active delivery for the same vehicle, driver or allocation.",
      "",
      "#### Step 5 — The driver dispatches and delivers",
      "",
      "```sql",
      "BEGIN;",
      "SELECT set_config('reliefflow.user_id', '11', true);  SET LOCAL ROLE rf_driver;   -- RLS: only driver 11's rows are visible",
      "UPDATE deliveries SET status = 'IN_TRANSIT', departure_time = now() WHERE delivery_id = $1;",
      "UPDATE allocations SET status = 'IN_TRANSIT' WHERE allocation_id = $a;",
      "CALL refresh_request_status($r);",
      "COMMIT;",
      "-- later: status = 'DELIVERED', actual_arrival = now(); vehicle and volunteers set back to AVAILABLE; request → DELIVERED",
      "```",
      "",
      "Triggers fired: `delivery_status_guard` (only legal transitions), `allocation_status_guard` (allocation state machine), `row_change_log`.",
      "",
      "#### Alternative — The allocation is cancelled before dispatch",
      "",
      "```sql",
      "UPDATE allocations SET status = 'CANCELLED' WHERE allocation_id = $1 RETURNING *;",
      "CALL refresh_request_status($r);",
      "```",
      "",
      "`allocation_status_guard` refuses if a delivery is still active, otherwise locks the stock lines and adds the quantities back (firing `inventory_history` with the reason 'Allocation cancellation #id'). A second cancellation is impossible (CANCELLED → CANCELLED is not a transition), so stock is restored exactly once.",
      "",
      "### 7.4 Important SELECT queries",
      "",
      "The application reads data with joins, aggregates and subqueries. Examples (all from the code or the lab):",
      "",
      "```sql",
      "-- authentication on every request: 3-table join",
      "SELECT u.user_id, u.full_name, r.role_name FROM sessions s JOIN app_users u USING (user_id) JOIN roles r USING (role_id)",
      " WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active;",
      "",
      "-- request list: join + aggregate per request + function call",
      "SELECT rr.request_id, c.camp_name, d.disaster_name, rr.priority_level, rr.status,",
      "       count(ri.resource_id) AS lines, request_fulfillment_pct(rr.request_id) AS fulfilled_pct",
      "  FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN disasters d USING (disaster_id)",
      "  JOIN request_items ri USING (request_id)",
      " GROUP BY rr.request_id, c.camp_name, d.disaster_name ORDER BY rr.priority_score DESC;",
      "",
      "-- shortages: from the view built on two CTEs",
      "SELECT resource_name, outstanding_demand, available_stock FROM v_resource_demand WHERE net_position < 0;",
      "",
      "-- camps with more than one request (GROUP BY + HAVING)",
      "SELECT c.camp_name, count(*) FROM relief_camps c JOIN resource_requests rr USING (camp_id) GROUP BY c.camp_name HAVING count(*) > 1;",
      "",
      "-- full-text search on disasters (GIN index on the generated tsvector column)",
      "SELECT disaster_name, ts_rank(search_vector, q) FROM disasters, websearch_to_tsquery('english', $1) q",
      " WHERE search_vector @@ q ORDER BY 2 DESC;",
      "```",
      "",
      "## 8. Quick glossary",
      "",
      "* **Primary key (PK):** the column(s) that identify a row; unique and not null.",
      "* **Foreign key (FK):** a column that must match a primary key in another table.",
      "* **Composite key:** a key made of more than one column.",
      "* **Weak entity:** a table whose rows are identified through their owner's key.",
      "* **CHECK constraint:** a condition every row must satisfy.",
      "* **NOT VALID:** a constraint checked for new and changed rows only, so it can be added to a table with old rows.",
      "* **Index:** a structure that finds rows quickly without scanning the table (B-tree, GIN, HNSW).",
      "* **Partial index:** an index on only the rows matching a WHERE condition.",
      "* **View:** a named, stored SELECT.",
      "* **Function / procedure:** stored code; a function returns a value, a procedure is CALLed.",
      "* **Trigger:** a function run automatically on INSERT / UPDATE / DELETE.",
      "* **Transaction:** a group of statements that succeed or fail together (ACID).",
      "* **FOR UPDATE / FOR SHARE:** row locks taken by a SELECT inside a transaction.",
      "* **xmin:** PostgreSQL's row version, used for optimistic locking.",
      "* **GRANT / REVOKE:** give or remove a role's privileges on tables or columns.",
      "* **Row-level security (RLS):** policies that filter which rows a role can see or change.",
      "* **SECURITY DEFINER:** a function that runs with its owner's privileges.",
      "",
    );

    writeFileSync(resolve("docs/report/ReliefFlow-Database-Explained.md"), md.join("\n"));
    console.log(`Wrote docs/report/ReliefFlow-Database-Explained.md (${md.length} lines, ${tables.length} tables, ${fks.length} FKs, ${trg.length} triggers)`);
  } finally {
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
