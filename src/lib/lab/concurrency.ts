import type { PoolClient } from "pg";
import { labPool } from "./sandbox";

/**
 * Scripted multi-session demonstrations. Two real PostgreSQL sessions (T1, T2) run
 * interleaved statements against sandbox.demo_stock in the lab database; a third
 * observer session reads pg_locks / pg_stat_activity. Runs are serialised by an
 * advisory lock so concurrent viewers cannot interfere with each other's timeline.
 */
export type TimelineEvent = {
  at: number;
  session: "T1" | "T2" | "Observer";
  sql: string;
  rows?: Record<string, unknown>[];
  command?: string;
  rowCount?: number | null;
  error?: { code?: string; message: string };
  waitedMs?: number;
  note?: string;
};

type Ctx = {
  run: (s: "T1" | "T2", sql: string, note?: string) => Promise<TimelineEvent>;
  start: (s: "T1" | "T2", sql: string, note?: string) => Promise<TimelineEvent>;
  observe: (note: string) => Promise<void>;
  note: (s: "T1" | "T2" | "Observer", text: string) => void;
  pause: (ms: number) => Promise<void>;
};

export const scenarios: Record<string, { title: string; level: string; explain: string; outcome: string; script: (c: Ctx) => Promise<void> }> = {
  "dirty-read": {
    title: "Dirty read (prevented)",
    level: "READ UNCOMMITTED",
    explain: "T1 changes stock but has not committed. T2 asks for READ UNCOMMITTED and reads the row. PostgreSQL treats READ UNCOMMITTED as READ COMMITTED, so uncommitted data is never visible.",
    outcome: "T2 sees 100, not T1's uncommitted 40: no dirty read.",
    script: async ({ run }) => {
      await run("T1", "BEGIN");
      await run("T1", "UPDATE demo_stock SET qty = 40 WHERE item = 'Drinking Water' RETURNING qty", "uncommitted change");
      await run("T2", "BEGIN ISOLATION LEVEL READ UNCOMMITTED");
      await run("T2", "SELECT qty FROM demo_stock WHERE item = 'Drinking Water'", "reads committed value only");
      await run("T1", "ROLLBACK");
      await run("T2", "COMMIT");
    },
  },
  "non-repeatable-read": {
    title: "Non-repeatable read",
    level: "READ COMMITTED vs REPEATABLE READ",
    explain: "Under READ COMMITTED every statement sees a fresh snapshot, so reading the same row twice can return different values if another transaction commits in between. REPEATABLE READ uses one snapshot for the whole transaction.",
    outcome: "READ COMMITTED: 100 then 70. REPEATABLE READ: 70 then 70.",
    script: async ({ run, note }) => {
      note("T1", "Round 1 — READ COMMITTED");
      await run("T1", "BEGIN ISOLATION LEVEL READ COMMITTED");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Drinking Water'", "first read");
      await run("T2", "UPDATE demo_stock SET qty = qty - 30 WHERE item = 'Drinking Water' RETURNING qty", "T2 autocommits");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Drinking Water'", "second read differs → non-repeatable read");
      await run("T1", "COMMIT");
      note("T1", "Round 2 — REPEATABLE READ");
      await run("T1", "BEGIN ISOLATION LEVEL REPEATABLE READ");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Drinking Water'", "first read (snapshot taken)");
      await run("T2", "UPDATE demo_stock SET qty = qty - 30 WHERE item = 'Drinking Water' RETURNING qty", "T2 autocommits");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Drinking Water'", "same value: snapshot is stable");
      await run("T1", "COMMIT");
    },
  },
  "phantom-read": {
    title: "Phantom read",
    level: "READ COMMITTED vs REPEATABLE READ",
    explain: "A phantom is a new row that appears in a repeated range query. PostgreSQL's REPEATABLE READ (snapshot isolation) also prevents phantoms.",
    outcome: "READ COMMITTED: count 3 then 4. REPEATABLE READ: count stays the same.",
    script: async ({ run, note }) => {
      note("T1", "Round 1 — READ COMMITTED");
      await run("T1", "BEGIN ISOLATION LEVEL READ COMMITTED");
      await run("T1", "SELECT count(*) AS items_in_stock FROM demo_stock WHERE qty > 0");
      await run("T2", "INSERT INTO demo_stock(item, qty) VALUES ('Hygiene Kit', 50)", "T2 inserts and autocommits");
      await run("T1", "SELECT count(*) AS items_in_stock FROM demo_stock WHERE qty > 0", "a phantom row appeared");
      await run("T1", "COMMIT");
      note("T1", "Round 2 — REPEATABLE READ");
      await run("T1", "BEGIN ISOLATION LEVEL REPEATABLE READ");
      await run("T1", "SELECT count(*) AS items_in_stock FROM demo_stock WHERE qty > 0");
      await run("T2", "INSERT INTO demo_stock(item, qty) VALUES ('Solar Lantern', 20)", "T2 inserts and autocommits");
      await run("T1", "SELECT count(*) AS items_in_stock FROM demo_stock WHERE qty > 0", "no phantom");
      await run("T1", "COMMIT");
    },
  },
  "lost-update": {
    title: "Lost update (application read-modify-write)",
    level: "READ COMMITTED",
    explain: "Two coordinators read stock (100), compute 100 − 30 and 100 − 20 in application code, and write the result back. The second write overwrites the first.",
    outcome: "Final stock is 80 instead of 50: 30 units of allocation were silently lost.",
    script: async ({ run }) => {
      await run("T1", "BEGIN");
      await run("T2", "BEGIN");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Food Packet'", "T1 reads 100");
      await run("T2", "SELECT qty FROM demo_stock WHERE item = 'Food Packet'", "T2 reads 100");
      await run("T1", "UPDATE demo_stock SET qty = 70 WHERE item = 'Food Packet'", "writes 100 − 30");
      await run("T1", "COMMIT");
      await run("T2", "UPDATE demo_stock SET qty = 80 WHERE item = 'Food Packet'", "writes 100 − 20, overwriting T1");
      await run("T2", "COMMIT");
      await run("T1", "SELECT qty AS final_qty FROM demo_stock WHERE item = 'Food Packet'", "expected 50");
    },
  },
  "lost-update-prevented": {
    title: "Lost update prevented with SELECT … FOR UPDATE",
    level: "READ COMMITTED + row lock",
    explain: "This is how ReliefFlow allocates: the stock row is locked with FOR UPDATE (exclusive row lock). T2's read waits until T1 commits and then sees the new value.",
    outcome: "T2 blocks on the row lock, then reads 70; final stock is 50.",
    script: async ({ run, start, observe }) => {
      await run("T1", "BEGIN");
      await run("T1", "SELECT qty FROM demo_stock WHERE item = 'Food Packet' FOR UPDATE", "exclusive row lock acquired");
      await run("T2", "BEGIN");
      const waiting = start("T2", "SELECT qty FROM demo_stock WHERE item = 'Food Packet' FOR UPDATE", "must wait for T1");
      await observe("T2 is blocked waiting for T1's row lock");
      await run("T1", "UPDATE demo_stock SET qty = qty - 30 WHERE item = 'Food Packet'");
      await run("T1", "COMMIT", "releases the lock");
      await waiting;
      await run("T2", "UPDATE demo_stock SET qty = qty - 20 WHERE item = 'Food Packet' RETURNING qty");
      await run("T2", "COMMIT");
    },
  },
  "serialization-failure": {
    title: "Write conflict under REPEATABLE READ",
    level: "REPEATABLE READ",
    explain: "With snapshot isolation, if T2 tries to update a row changed by a transaction that committed after T2's snapshot, PostgreSQL aborts T2 with a serialization failure (SQLSTATE 40001); the application must retry.",
    outcome: "T2 fails with 40001 instead of overwriting T1's change.",
    script: async ({ run, start }) => {
      await run("T1", "BEGIN ISOLATION LEVEL REPEATABLE READ");
      await run("T2", "BEGIN ISOLATION LEVEL REPEATABLE READ");
      await run("T2", "SELECT qty FROM demo_stock WHERE item = 'Blanket'", "T2 snapshot taken");
      await run("T1", "UPDATE demo_stock SET qty = qty - 10 WHERE item = 'Blanket'");
      const t2 = start("T2", "UPDATE demo_stock SET qty = qty - 25 WHERE item = 'Blanket'", "waits for T1");
      await run("T1", "COMMIT");
      await t2;
      await run("T2", "ROLLBACK", "application would retry the whole transaction");
    },
  },
  deadlock: {
    title: "Deadlock detection",
    level: "READ COMMITTED",
    explain: "T1 locks Water then wants Food; T2 locks Food then wants Water. Each waits for the other. After deadlock_timeout PostgreSQL detects the cycle and aborts one transaction (SQLSTATE 40P01). ReliefFlow avoids this by always locking rows in a fixed order (request → lines → inventory sorted by warehouse, resource).",
    outcome: "One session is aborted with 40P01; the other completes.",
    script: async ({ run, start, observe }) => {
      await run("T1", "BEGIN");
      await run("T2", "BEGIN");
      await run("T1", "UPDATE demo_stock SET qty = qty - 1 WHERE item = 'Drinking Water'", "T1 locks Water");
      await run("T2", "UPDATE demo_stock SET qty = qty - 1 WHERE item = 'Food Packet'", "T2 locks Food");
      const a = start("T1", "UPDATE demo_stock SET qty = qty - 1 WHERE item = 'Food Packet'", "T1 waits for T2");
      await observe("T1 waits for T2");
      const b = start("T2", "UPDATE demo_stock SET qty = qty - 1 WHERE item = 'Drinking Water'", "T2 waits for T1 → cycle");
      await Promise.all([a, b]);
      await run("T1", "ROLLBACK");
      await run("T2", "ROLLBACK");
    },
  },
  "shared-exclusive": {
    title: "Shared vs exclusive row locks",
    level: "READ COMMITTED",
    explain: "FOR SHARE locks are compatible with each other (many readers may protect a row from change). FOR UPDATE is exclusive: it conflicts with FOR SHARE. NOWAIT fails immediately instead of queueing.",
    outcome: "Two FOR SHARE locks coexist; FOR UPDATE NOWAIT fails with 55P03.",
    script: async ({ run, observe }) => {
      await run("T1", "BEGIN");
      await run("T2", "BEGIN");
      await run("T1", "SELECT item FROM demo_stock WHERE item = 'Blanket' FOR SHARE", "shared lock");
      await run("T2", "SELECT item FROM demo_stock WHERE item = 'Blanket' FOR SHARE", "second shared lock: compatible");
      await observe("both sessions hold a share lock on the same row");
      await run("T2", "COMMIT");
      await run("T2", "BEGIN");
      await run("T2", "SELECT item FROM demo_stock WHERE item = 'Blanket' FOR UPDATE NOWAIT", "exclusive request conflicts");
      await run("T2", "ROLLBACK");
      await run("T1", "COMMIT");
    },
  },
  "concurrent-allocation": {
    title: "Two coordinators allocate the same stock",
    level: "READ COMMITTED + row lock + CHECK",
    explain: "Both try to take 70 of the 100 units at the same moment. The atomic UPDATE takes an exclusive row lock; T2 waits, re-reads the committed value (30) and the CHECK (qty >= 0) rejects the oversell. ReliefFlow's allocation trigger uses the same row-lock pattern on inventory.",
    outcome: "T1 succeeds (100 → 30); T2 waits, then fails: stock never goes negative.",
    script: async ({ run, start, observe }) => {
      await run("T1", "BEGIN");
      await run("T2", "BEGIN");
      await run("T1", "UPDATE demo_stock SET qty = qty - 70 WHERE item = 'Drinking Water' RETURNING qty", "T1 allocates 70");
      const t2 = start("T2", "UPDATE demo_stock SET qty = qty - 70 WHERE item = 'Drinking Water' RETURNING qty", "T2 allocates 70 at the same time");
      await observe("T2 waits on T1's exclusive row lock");
      await run("T1", "COMMIT");
      await t2;
      await run("T2", "ROLLBACK");
      await run("T1", "SELECT qty AS final_qty FROM demo_stock WHERE item = 'Drinking Water'");
    },
  },
};

function summarise(r: { rows?: unknown[]; fields?: { name: string }[]; command?: string; rowCount?: number | null }) {
  return { rows: (r.rows as Record<string, unknown>[] | undefined)?.slice(0, 5), command: r.command, rowCount: r.rowCount };
}

export async function runScenario(id: string) {
  const sc = scenarios[id];
  if (!sc) throw Object.assign(new Error("Unknown scenario"), { status: 404 });
  const pool = labPool();
  const obs = await pool.connect();
  const sessions: Record<"T1" | "T2", PoolClient> = { T1: await pool.connect(), T2: await pool.connect() };
  const timeline: TimelineEvent[] = [];
  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);
  try {
    // Serialise demo runs; reset scratch table to a known state.
    await obs.query("SET lock_timeout = '10s'");
    await obs.query("SELECT pg_advisory_lock(424242)");
    await obs.query(`DELETE FROM sandbox.demo_stock WHERE item NOT IN ('Drinking Water','Food Packet','Blanket')`);
    await obs.query(`UPDATE sandbox.demo_stock SET qty = 100, version = 1`);
    for (const s of Object.values(sessions)) {
      await s.query("SET lock_timeout = '6s'");
      await s.query("SET statement_timeout = '8s'");
      await s.query("SET deadlock_timeout = '400ms'").catch(() => undefined);
    }
    const pids = { T1: (await sessions.T1.query("SELECT pg_backend_pid() AS p")).rows[0].p, T2: (await sessions.T2.query("SELECT pg_backend_pid() AS p")).rows[0].p };
    const exec = async (s: "T1" | "T2", sql: string, note?: string) => {
      const started = performance.now();
      const ev: TimelineEvent = { at: at(), session: s, sql, note };
      try {
        Object.assign(ev, summarise(await sessions[s].query(sql)));
      } catch (e) {
        const err = e as { code?: string; message: string };
        ev.error = { code: err.code, message: err.message };
      }
      const waited = performance.now() - started;
      if (waited > 150) ev.waitedMs = +waited.toFixed(0);
      timeline.push(ev);
      return ev;
    };
    const ctx: Ctx = {
      run: exec,
      start: (s, sql, note) => {
        timeline.push({ at: at(), session: s, sql: "▶ " + sql.split("\n")[0], note: (note ? note + " — " : "") + "statement issued" });
        return exec(s, sql, note);
      },
      observe: async (note) => {
        await new Promise((r) => setTimeout(r, 350));
        const r = await obs.query(
          `SELECT CASE a.pid WHEN $1 THEN 'T1' WHEN $2 THEN 'T2' END AS session, l.locktype, l.mode, l.granted,
                  CASE WHEN l.relation IS NOT NULL THEN l.relation::regclass::text END AS relation,
                  a.wait_event_type, a.state
             FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE l.pid IN ($1, $2) AND (l.locktype IN ('tuple','transactionid') OR l.relation = 'sandbox.demo_stock'::regclass)
            ORDER BY session, l.granted DESC, l.locktype`,
          [pids.T1, pids.T2],
        );
        timeline.push({ at: at(), session: "Observer", sql: "SELECT … FROM pg_locks JOIN pg_stat_activity", rows: r.rows, note });
      },
      note: (s, text) => timeline.push({ at: at(), session: s, sql: "", note: text }),
      pause: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    await sc.script(ctx);
    return { id, ...sc, script: undefined, timeline, totalMs: at() };
  } finally {
    for (const s of Object.values(sessions)) {
      await s.query("ROLLBACK").catch(() => undefined);
      await s.query("DISCARD ALL").catch(() => undefined);
      s.release();
    }
    await obs.query(`DELETE FROM sandbox.demo_stock WHERE item NOT IN ('Drinking Water','Food Packet','Blanket')`).catch(() => undefined);
    await obs.query(`UPDATE sandbox.demo_stock SET qty = 100, version = 1`).catch(() => undefined);
    await obs.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
    await obs.query("RESET ALL").catch(() => undefined);
    obs.release();
  }
}
