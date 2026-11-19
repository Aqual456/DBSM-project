import { endpoint, actor, allRoles, body } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { runStep, type StepResult } from "@/lib/lab/sandbox";

/**
 * Database-level RBAC demonstration on the REAL schema. Fixed statements only, each wrapped in a
 * savepoint inside one transaction that is ALWAYS rolled back, so nothing is ever changed.
 * Each step runs as a PostgreSQL role (SET LOCAL ROLE) and shows whether PostgreSQL allows it.
 */
type Scenario = { id: string; title: string; explain: string; steps: { as: string; userFromDriver?: boolean; sql: string; expect: "allowed" | "denied" | "filtered" }[] };

const scenarios: Scenario[] = [
  {
    id: "rls-driver",
    title: "Row-level security: a driver sees only their own deliveries",
    explain: "Policy deliveries_driver_own: USING (driver_id = current_setting('reliefflow.user_id')). The same query returns different rows depending on who runs it.",
    steps: [
      { as: "postgres (table owner)", sql: "SELECT count(*) AS total_deliveries FROM deliveries", expect: "allowed" },
      { as: "rf_driver", userFromDriver: true, sql: "SELECT count(*) AS visible_to_driver, count(*) FILTER (WHERE driver_id <> NULLIF(current_setting('reliefflow.user_id', true), '')::bigint) AS other_drivers_rows FROM deliveries", expect: "filtered" },
      { as: "rf_driver", userFromDriver: true, sql: "UPDATE deliveries SET status = status WHERE driver_id <> NULLIF(current_setting('reliefflow.user_id', true), '')::bigint", expect: "filtered" },
      { as: "rf_coordinator", sql: "SELECT count(*) AS visible_to_coordinator FROM deliveries", expect: "allowed" },
    ],
  },
  {
    id: "column-privileges",
    title: "Column-level privileges: password hashes are invisible to non-admins",
    explain: "GRANT SELECT (user_id, role_id, full_name, is_active, created_at) ON app_users. Selecting any other column is refused by PostgreSQL.",
    steps: [
      { as: "rf_coordinator", sql: "SELECT user_id, full_name FROM app_users ORDER BY user_id LIMIT 3", expect: "allowed" },
      { as: "rf_coordinator", sql: "SELECT email, password_hash FROM app_users LIMIT 1", expect: "denied" },
      { as: "rf_admin", sql: "SELECT count(password_hash) AS hashes_visible_to_admin FROM app_users", expect: "allowed" },
    ],
  },
  {
    id: "table-privileges",
    title: "Table privileges: each role can change only what its job needs",
    explain: "Field officers raise requests and record camp occupancy; drivers progress deliveries; only coordinators change stock; only admins manage users.",
    steps: [
      { as: "rf_field_officer", sql: "UPDATE relief_camps SET current_population = current_population WHERE camp_id = (SELECT min(camp_id) FROM relief_camps)", expect: "allowed" },
      { as: "rf_field_officer", sql: "UPDATE inventory SET quantity_available = quantity_available + 0", expect: "denied" },
      { as: "rf_driver", sql: "DELETE FROM vehicles", expect: "denied" },
      { as: "rf_coordinator", sql: "UPDATE inventory SET quantity_available = quantity_available WHERE false", expect: "allowed" },
      { as: "rf_coordinator", sql: "UPDATE app_users SET is_active = is_active WHERE false", expect: "denied" },
      { as: "rf_admin", sql: "UPDATE app_users SET is_active = is_active WHERE false", expect: "allowed" },
    ],
  },
  {
    id: "audit-forgery",
    title: "History cannot be forged",
    explain: "data_change_log and inventory_movements are written only by SECURITY DEFINER triggers; application roles have no INSERT privilege on them.",
    steps: [
      { as: "rf_coordinator", sql: "INSERT INTO data_change_log(table_name, operation) VALUES ('fake', 'DELETE')", expect: "denied" },
      { as: "rf_coordinator", sql: "SELECT prosecdef AS security_definer, proname FROM pg_proc WHERE proname IN ('log_row_change','record_inventory_movement','lock_request_parents') ORDER BY proname", expect: "allowed" },
    ],
  },
  {
    id: "catalog",
    title: "The policy and grant catalogue",
    explain: "Everything above is ordinary PostgreSQL metadata: pg_roles, pg_policies and information_schema.role_table_grants.",
    steps: [
      { as: "postgres (table owner)", sql: "SELECT policyname, roles::text, cmd, qual FROM pg_policies WHERE tablename = 'deliveries' ORDER BY policyname", expect: "allowed" },
      { as: "postgres (table owner)", sql: "SELECT grantee, string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS privileges, count(DISTINCT table_name) AS tables FROM information_schema.role_table_grants WHERE grantee LIKE 'rf\\_%' AND grantee <> 'rf_lab' GROUP BY grantee ORDER BY grantee", expect: "allowed" },
    ],
  },
];

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  return scenarios.map(({ id, title, explain, steps }) => ({ id, title, explain, steps: steps.map((s) => ({ as: s.as, sql: s.sql, expect: s.expect })) }));
});

export const POST = endpoint(async (req) => {
  await actor(req, allRoles);
  const { id } = (await body(req)) as { id?: string };
  const sc = scenarios.find((s) => s.id === id);
  if (!sc) return { error: "Unknown scenario" };
  const c = await pool.connect();
  const results: (StepResult & { as: string; expect: string; outcome: string })[] = [];
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL statement_timeout = '4s'");
    const driver = (await c.query("SELECT driver_id FROM deliveries GROUP BY driver_id ORDER BY count(*) DESC LIMIT 1")).rows[0]?.driver_id;
    for (const s of sc.steps) {
      await c.query("SAVEPOINT step");
      await c.query("RESET ROLE");
      if (s.userFromDriver) await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(driver ?? 0)]);
      if (s.as.startsWith("rf_")) await c.query(`SET LOCAL ROLE ${s.as}`);
      const r = await runStep(c, s.sql);
      const outcome = r.error ? (r.error.code === "42501" ? "DENIED by PostgreSQL" : "error") : s.expect === "filtered" ? "ALLOWED, rows filtered by RLS" : "ALLOWED";
      results.push({ ...r, as: s.as + (s.userFromDriver ? ` (user ${driver})` : ""), expect: s.expect, outcome });
      await c.query("ROLLBACK TO SAVEPOINT step");
    }
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
  return { id, title: sc.title, results };
});
