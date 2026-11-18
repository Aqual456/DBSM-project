import { Pool, type PoolClient, type Notification } from "pg";
import { createHash } from "crypto";

/**
 * The DBMS Lab never touches operational data. It runs against a separate database
 * (reliefflow_lab) holding a sanitised snapshot, as a least-privilege login role
 * (rf_lab: no superuser, no createdb/createrole, statement_timeout, temp_file_limit).
 * Every lab transaction is ROLLED BACK, so even DML/DDL demonstrations leave no trace.
 */
export const LAB_DB = "reliefflow_lab";
export const LAB_ROLE = "rf_lab";

export function labPassword() {
  return createHash("sha256").update(`${process.env.DATABASE_URL ?? ""}|reliefflow-lab-role`).digest("hex").slice(0, 32);
}
export function labUrl() {
  if (process.env.LAB_DATABASE_URL) return process.env.LAB_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const u = new URL(process.env.DATABASE_URL);
  u.username = LAB_ROLE;
  u.password = labPassword();
  u.pathname = "/" + LAB_DB;
  return u.toString();
}
/** Superuser connection string pointed at the lab database (setup only). */
export function labAdminUrl() {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = "/" + LAB_DB;
  return u.toString();
}

declare global {
  var rfLabPool: Pool | undefined;
}
export function labPool() {
  global.rfLabPool ??= new Pool({ connectionString: labUrl(), max: 6, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
  return global.rfLabPool;
}
export async function resetLabPool() {
  const p = global.rfLabPool;
  global.rfLabPool = undefined;
  await p?.end().catch(() => undefined);
}

export async function labPing() {
  const t = performance.now();
  try {
    const r = await labPool().query("SELECT taken_at FROM sandbox.lab_snapshot ORDER BY taken_at DESC LIMIT 1");
    return { ok: true, latencyMs: +(performance.now() - t).toFixed(2), snapshotAt: r.rows[0]?.taken_at ?? null };
  } catch {
    return { ok: false };
  }
}

export type StepResult = {
  sql: string;
  command?: string;
  rowCount?: number | null;
  fields?: string[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  ms: number;
  notices?: string[];
  error?: { code?: string; message: string; detail?: string; hint?: string };
};

const MAX_ROWS = 200;

function serialise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return `\\x${v.toString("hex").slice(0, 64)}`;
  return v;
}

export async function runStep(c: PoolClient, sql: string, params: unknown[] = [], notices: string[] = []): Promise<StepResult> {
  const before = notices.length;
  const t = performance.now();
  try {
    const raw = (await c.query({ text: sql, values: params, rowMode: "array" })) as unknown;
    const r = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as { rows: unknown[][]; fields?: { name: string }[]; command: string; rowCount: number | null };
    const fields = r.fields?.map((f) => f.name) ?? [];
    const rows = (r.rows ?? []).slice(0, MAX_ROWS).map((row) => Object.fromEntries(fields.map((f, i) => [f, serialise(row[i])])));
    return {
      sql,
      command: r.command,
      rowCount: r.rowCount,
      fields,
      rows,
      truncated: (r.rows?.length ?? 0) > MAX_ROWS,
      ms: +(performance.now() - t).toFixed(2),
      notices: notices.slice(before),
    };
  } catch (e) {
    const err = e as { code?: string; message: string; detail?: string; hint?: string };
    return {
      sql,
      ms: +(performance.now() - t).toFixed(2),
      notices: notices.slice(before),
      error: { code: err.code, message: err.message, detail: err.detail, hint: err.hint },
    };
  }
}

/** Run statements in ONE transaction that is always rolled back. */
export async function runSandboxed(steps: string[], opts: { readOnly?: boolean; timeoutMs?: number } = {}) {
  const c = await labPool().connect();
  const notices: string[] = [];
  const onNotice = (n: { message?: string }) => notices.push(n.message ?? "");
  c.on("notice", onNotice);
  const started = performance.now();
  try {
    await c.query("BEGIN");
    if (opts.readOnly) await c.query("SET TRANSACTION READ ONLY");
    await c.query(`SET LOCAL statement_timeout = ${Math.min(Math.max(opts.timeoutMs ?? 4000, 100), 8000)}`);
    await c.query("SET LOCAL lock_timeout = '2s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    const results: StepResult[] = [];
    for (const s of steps) results.push(await runStep(c, s, [], notices));
    return { results, totalMs: +(performance.now() - started).toFixed(2), rolledBack: true };
  } finally {
    c.off("notice", onNotice);
    await c.query("ROLLBACK").catch(() => undefined);
    // Clear any session state (temp tables, prepared statements, advisory locks).
    await c.query("DISCARD ALL").catch(() => undefined);
    c.release();
  }
}

export type { Notification };
