"use client";
import { useState } from "react";
import { Play, RotateCcw, XCircle, CheckCircle2 } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Demo = { id: string; title: string; explain: string };
type Step = { label: string; op: string; result?: unknown; error?: { code?: number | string; message: string; details?: unknown }; ms: number };

const compare = [
  ["Data model", "Tables of rows; fixed columns; relationships via foreign keys", "Documents (BSON) in collections; nested sub-documents and arrays"],
  ["Schema", "Schema-on-write, enforced by DDL", "Flexible; optional $jsonSchema validation per collection"],
  ["Relationships", "Joins across normalised tables", "Embed related data, or reference + $lookup"],
  ["Transactions", "Full multi-statement ACID", "Atomic per document; multi-document transactions on replica sets"],
  ["Consistency", "Strong; constraints and triggers", "Tunable read/write concerns; application-level integrity"],
  ["Scalability", "Primarily vertical; read replicas, partitioning", "Horizontal sharding built in"],
  ["Best for in ReliefFlow", "Stock, requests, allocations, deliveries, users", "Free-form field incident reports with evolving fields"],
];
const ownership = [
  ["PostgreSQL", "Source of truth for all structured operations", "ACID transactions, constraints, triggers"],
  ["MongoDB", "Owns incident documents", "disasterId is validated against PostgreSQL before insert (no cross-database FK)"],
  ["Redis", "Derived cache only", "TTL 30 s + invalidation on every write; losing it is harmless"],
  ["Neo4j", "Read projection of PostgreSQL", "Explicit full-refresh sync, 3 retries, status recorded; stale until next sync"],
  ["pgvector", "Derived embeddings of incidents, requests, disasters", "Explicit sync; rebuilt from sources; never authoritative"],
];

function MongoDemo({ d }: { d: Demo }) {
  const [res, setRes] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      setRes((await api<{ steps: Step[] }>("/api/lab/mongo", { body: { id: d.id } })).steps);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={d.title} subtitle={d.explain} actions={<Button size="sm" variant="primary" icon={<Play size={13} />} loading={busy} onClick={run}>{res ? "Run again" : "Run"}</Button>}>
      {err && <Alert kind="error">{err}</Alert>}
      {res && (
        <div className="stack" style={{ gap: 10 }}>
          {res.map((s, i) => (
            <div className="step-result" key={i}>
              <div className="step-result-head">
                {s.error ? <XCircle size={14} color="var(--danger)" /> : <CheckCircle2 size={14} color="var(--success)" />}
                <b style={{ color: "var(--text)" }}>{s.label}</b>
                <code>{s.op}</code>
                <span className="num">{s.ms} ms</span>
              </div>
              {s.error ? (
                <div className="result-error">
                  <b>Error {s.error.code}:</b> {s.error.message}
                  {s.error.details != null && <pre className="code" style={{ marginTop: 8, whiteSpace: "pre-wrap", maxHeight: 220 }}>{JSON.stringify(s.error.details, null, 2)}</pre>}
                </div>
              ) : (
                <pre className="code" style={{ borderRadius: 0, maxHeight: 300, whiteSpace: "pre-wrap" }}>{JSON.stringify(s.result, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function NoSql() {
  const { data } = useApi<Demo[]>("/api/lab/mongo");
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      const r = await api<{ incidents: number }>("/api/lab/mongo", { body: { id: "reset" } });
      toast("success", `Lab collection reset from ${r.incidents} incident documents`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 4"
        title="NoSQL & MongoDB"
        lead="Relational vs document databases, and live MongoDB operations on a lab copy of ReliefFlow's incident reports (the real collection is never modified here)."
        actions={isManager(me) ? <Button icon={<RotateCcw size={15} />} loading={busy} onClick={reset}>Reset lab collection</Button> : undefined}
      />
      <div className="stack">
        <Card title="Relational vs NoSQL">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Aspect</th><th>Relational (PostgreSQL)</th><th>Document (MongoDB)</th></tr></thead>
              <tbody>{compare.map(([a, b, c]) => <tr key={a}><td className="cell-main">{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Other NoSQL families used here: <b>key-value</b> (Redis), <b>graph</b> (Neo4j) and <b>vector</b> similarity search (pgvector).</p>
        </Card>
        <Card title="Polyglot persistence: who owns what" subtitle="No distributed ACID transaction spans these stores; ownership and sync rules keep them honest">
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Store</th><th>Responsibility</th><th>Consistency rule</th></tr></thead>
              <tbody>{ownership.map(([a, b, c]) => <tr key={a}><td><Badge value="x" color="blue" label={a} /></td><td>{b}</td><td className="small">{c}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        {!data ? <div className="card"><SkeletonRows /></div> : data.map((d) => <MongoDemo key={d.id} d={d} />)}
      </div>
    </>
  );
}
