"use client";
import { useState } from "react";
import { Play, ShieldCheck, ShieldX, Filter } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { ResultTable, SqlCode, type Step } from "@/components/lab/LabKit";

type Scenario = { id: string; title: string; explain: string; steps: { as: string; sql: string; expect: string }[] };
type Result = Step & { as: string; expect: string; outcome: string };

const matrix = [
  ["Read operational data", "✔", "✔", "✔", "✔ (own deliveries only, RLS)"],
  ["Read password hashes / e-mails", "✔", "✘", "✘", "✘"],
  ["Raise requests", "✔", "✔", "✔", "✘"],
  ["Admit / discharge at camps", "✔", "✔", "✔ (2 columns only)", "✘"],
  ["Change stock, allocate, plan deliveries", "✔", "✔", "✘", "✘"],
  ["Progress a delivery", "✔", "✔", "✘", "✔ (own, 3 columns)"],
  ["Manage users and roles", "✔", "✘", "✘", "✘"],
  ["Write history tables directly", "✘ (triggers only)", "✘", "✘", "✘"],
];

function ScenarioCard({ s }: { s: Scenario }) {
  const [res, setRes] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Card
      title={s.title}
      subtitle={s.explain}
      actions={
        <Button size="sm" variant="primary" icon={<Play size={13} />} loading={busy} onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            setRes((await api<{ results: Result[] }>("/api/lab/rbac", { body: { id: s.id } })).results);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Run failed");
          } finally {
            setBusy(false);
          }
        }}>{res ? "Run again" : "Run"}</Button>
      }
    >
      {err && <Alert kind="error">{err}</Alert>}
      <div className="stack" style={{ gap: 10 }}>
        {(res ?? s.steps.map((x) => ({ ...x, outcome: "", ms: 0 }) as unknown as Result)).map((r, i) => (
          <div className="step-result" key={i}>
            <div className="step-result-head">
              {r.outcome.startsWith("DENIED") ? <ShieldX size={14} color="var(--danger)" /> : r.outcome.includes("RLS") ? <Filter size={14} color="var(--violet)" /> : <ShieldCheck size={14} color={r.outcome ? "var(--success)" : "var(--subtle)"} />}
              <Badge value="x" color={r.as.startsWith("rf_admin") ? "violet" : r.as.startsWith("rf_coordinator") ? "blue" : r.as.startsWith("rf_field") ? "teal" : r.as.startsWith("rf_driver") ? "amber" : "gray"} label={r.as} />
              <span style={{ flex: 1 }} />
              {r.outcome && <b style={{ color: r.outcome.startsWith("DENIED") ? "var(--danger)" : "var(--success)" }}>{r.outcome}</b>}
            </div>
            <SqlCode sql={r.sql} />
            {r.error && <div className="result-error">SQLSTATE {r.error.code}: {r.error.message}</div>}
            {!r.error && r.fields?.length ? <ResultTable fields={r.fields} rows={r.rows ?? []} /> : null}
            {!r.error && r.outcome && !r.fields?.length && <p className="small muted" style={{ padding: "6px 12px" }}>{r.command} · {r.rowCount} row(s) affected</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function SecurityLab() {
  const { data } = useApi<Scenario[]>("/api/lab/rbac");
  return (
    <>
      <PageHeader
        eyebrow="Lab · Security"
        title="Role-Based Access Control in the Database"
        lead="Authorisation is enforced twice: by the API, and by PostgreSQL itself. Every API transaction runs SET LOCAL ROLE rf_<role>, so GRANTs, column privileges and row-level security apply even if application code had a bug. These scenarios run on the real schema and are always rolled back."
      />
      <div className="stack">
        <Card title="Role → privilege matrix" subtitle="Defined in db/postgres/008_rbac_dictionary.sql">
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Action</th><th>rf_admin</th><th>rf_coordinator</th><th>rf_field_officer</th><th>rf_driver</th></tr></thead>
              <tbody>{matrix.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i === 0 ? "cell-main" : ""} style={i ? { color: c.startsWith("✘") ? "var(--danger)" : "var(--success)", fontWeight: 600 } : undefined}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Flow: sign-in → session → API knows the role → <code>BEGIN; SET LOCAL ROLE rf_driver; SELECT set_config(&apos;reliefflow.user_id&apos;, …)</code> → PostgreSQL checks privileges and policies → <code>COMMIT</code>.
          </p>
        </Card>
        {!data ? <div className="card"><SkeletonRows /></div> : data.map((s) => <ScenarioCard key={s.id} s={s} />)}
      </div>
    </>
  );
}
