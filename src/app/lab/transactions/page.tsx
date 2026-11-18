"use client";
import { useState } from "react";
import { Play, Clock, XCircle, Eye, Hourglass } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, PageHeader, SkeletonRows, Tabs } from "@/components/ui/primitives";
import { DemoSections, ResultTable } from "@/components/lab/LabKit";

type Scenario = { id: string; title: string; level: string; explain: string; outcome: string };
type Event = { at: number; session: "T1" | "T2" | "Observer"; sql: string; rows?: Record<string, unknown>[]; command?: string; rowCount?: number | null; error?: { code?: string; message: string }; waitedMs?: number; note?: string };

const acid = [
  ["Atomicity", "All statements of a transaction commit, or none do.", "An allocation inserts the header, every line, deducts stock and writes history in one transaction — any failure rolls it all back."],
  ["Consistency", "Every commit leaves all constraints satisfied.", "CHECK (quantity_available >= 0), FKs and validation triggers make an inconsistent state impossible to commit."],
  ["Isolation", "Concurrent transactions do not see each other's partial work.", "Row locks (FOR UPDATE) in a fixed order + MVCC snapshots; see the scenarios below."],
  ["Durability", "Once COMMIT returns, the change survives a crash.", "PostgreSQL flushes the write-ahead log before acknowledging COMMIT."],
];
const levels = [
  ["READ UNCOMMITTED*", "prevented", "possible", "possible", "possible"],
  ["READ COMMITTED (default)", "prevented", "possible", "possible", "possible†"],
  ["REPEATABLE READ", "prevented", "prevented", "prevented‡", "prevented (40001)"],
  ["SERIALIZABLE", "prevented", "prevented", "prevented", "prevented"],
];

function Timeline({ events }: { events: Event[] }) {
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead><tr><th style={{ width: 70 }}>t (ms)</th><th style={{ width: "40%" }}>Session T1</th><th style={{ width: "40%" }}>Session T2</th></tr></thead>
        <tbody>
          {events.map((e, i) => {
            const body = (
              <div>
                {e.sql && <code className="small" style={{ whiteSpace: "pre-wrap" }}>{e.sql}</code>}
                {e.note && <div className="cell-sub">{e.note}</div>}
                {e.waitedMs && <div className="small" style={{ color: "var(--warning)" }}><Hourglass size={11} /> blocked {e.waitedMs} ms waiting for a lock</div>}
                {e.error && <div className="small" style={{ color: "var(--danger)" }}><XCircle size={11} /> {e.error.code}: {e.error.message}</div>}
                {e.rows && e.rows.length > 0 && e.session !== "Observer" && <div className="small"><b>→ {Object.entries(e.rows[0]).map(([k, v]) => `${k} = ${v}`).join(", ")}</b></div>}
              </div>
            );
            if (e.session === "Observer")
              return (
                <tr key={i} style={{ background: "var(--violet-50)" }}>
                  <td className="num small">{e.at}</td>
                  <td colSpan={2}>
                    <div className="small"><Eye size={12} /> <b>Observer (pg_locks):</b> {e.note}</div>
                    {e.rows && <ResultTable fields={Object.keys(e.rows[0] ?? {})} rows={e.rows} />}
                  </td>
                </tr>
              );
            return (
              <tr key={i}>
                <td className="num small">{e.at}</td>
                <td>{e.session === "T1" ? body : null}</td>
                <td>{e.session === "T2" ? body : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Scenarios() {
  const { data } = useApi<Scenario[]>("/api/lab/concurrency");
  const [sel, setSel] = useState("lost-update");
  const [res, setRes] = useState<{ timeline: Event[]; totalMs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!data) return <div className="card"><SkeletonRows /></div>;
  const s = data.find((x) => x.id === sel)!;
  return (
    <Card title="Concurrency lab" subtitle="Two real database sessions (T1, T2) interleaved step by step on a scratch table in the lab database, with a third session observing locks">
      <div className="chip-row" style={{ marginBottom: 14 }}>
        {data.map((x) => (
          <button key={x.id} className="chip" aria-pressed={sel === x.id} onClick={() => { setSel(x.id); setRes(null); }}>{x.title}</button>
        ))}
      </div>
      <div className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="row"><h3>{s.title}</h3><Badge value="x" color="blue" label={s.level} /></div>
          <p className="small muted" style={{ marginTop: 4 }}>{s.explain}</p>
          <p className="small" style={{ marginTop: 4 }}><b>Expected:</b> {s.outcome}</p>
        </div>
        <Button
          variant="primary"
          icon={<Play size={14} />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              setRes(await api("/api/lab/concurrency", { body: { id: sel } }));
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Run failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          Run scenario
        </Button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {res && (
        <>
          <p className="small muted" style={{ marginBottom: 8 }}><Clock size={12} /> {res.totalMs} ms total, measured. Scratch rows are reset after every run.</p>
          <Timeline events={res.timeline} />
        </>
      )}
    </Card>
  );
}

export default function Transactions() {
  const [tab, setTab] = useState<"acid" | "concurrency">("acid");
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 4" title="Transactions & Concurrency Control" lead="ACID properties with the allocation workflow, savepoints, isolation levels, row-level locking and deadlock detection — all executed on PostgreSQL." />
      <Tabs label="Transaction topics" value={tab} onChange={setTab} tabs={[{ id: "acid", label: "ACID & savepoints" }, { id: "concurrency", label: "Concurrency & locking" }]} />
      {tab === "acid" ? (
        <div className="stack">
          <div className="grid g-4">
            {acid.map(([t, d, ex]) => (
              <Card key={t} title={t}>
                <p className="small">{d}</p>
                <p className="small muted" style={{ marginTop: 6 }}>{ex}</p>
              </Card>
            ))}
          </div>
          <DemoSections ids={["transactions"]} />
        </div>
      ) : (
        <div className="stack">
          <Card title="Isolation levels and anomalies (PostgreSQL)">
            <div className="table-wrap">
              <table className="data compact">
                <thead><tr><th>Level</th><th>Dirty read</th><th>Non-repeatable read</th><th>Phantom read</th><th>Lost update</th></tr></thead>
                <tbody>{levels.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i === 0 ? "cell-main" : ""}>{i === 0 ? c : <Badge value={c.startsWith("prevented") ? "OK" : "HIGH"} label={c} />}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              * PostgreSQL runs READ UNCOMMITTED as READ COMMITTED. † with read-modify-write in application code; avoided with atomic UPDATEs or SELECT … FOR UPDATE. ‡ the SQL standard allows phantoms at REPEATABLE READ; PostgreSQL&apos;s snapshot isolation does not.
              Locks: <b>FOR SHARE</b> (shared, compatible with other shares) and <b>FOR UPDATE</b> (exclusive). ReliefFlow always locks request → request lines → inventory rows sorted by (warehouse, resource) to avoid deadlocks.
            </p>
          </Card>
          <Scenarios />
        </div>
      )}
    </>
  );
}
