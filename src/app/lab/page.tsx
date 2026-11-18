"use client";
import Link from "next/link";
import { useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { api, useApi, fmtDate } from "@/lib/client";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { useToast, useConfirm } from "@/components/ui/overlays";
import { useMe } from "@/components/shell/AppShell";

const units = [
  { unit: "Unit 1", title: "Introduction to DBMS & SQL", items: [["DBMS concepts & three-schema architecture", "/lab/concepts"], ["Live ER diagram explorer", "/lab/er"], ["Relational algebra playground", "/lab/algebra"], ["SQL explorer & sandbox playground", "/lab/sql"]] },
  { unit: "Unit 2", title: "Advanced SQL", items: [["Set ops, NULLs, subqueries, joins", "/lab/advanced"], ["Views, triggers, functions, procedures", "/lab/advanced"], ["CTEs, recursion, window functions", "/lab/advanced"], ["Full-text & trigram search", "/lab/advanced"]] },
  { unit: "Unit 3", title: "Design & Implementation", items: [["Query processing & EXPLAIN ANALYZE", "/lab/optimization"], ["Index strategies, measured", "/lab/optimization"], ["Functional dependencies & closure", "/lab/normalization"], ["1NF → 5NF with verified decompositions", "/lab/normalization"]] },
  { unit: "Unit 4", title: "Next-Gen Data Management", items: [["ACID, savepoints, isolation levels", "/lab/transactions"], ["Locks, deadlocks, lost updates", "/lab/transactions"], ["MongoDB documents & aggregation", "/lab/nosql"], ["Redis · Neo4j · pgvector", "/lab/keyvalue"]] },
];
type Health = { services: Record<string, { ok: boolean; configured?: boolean; latencyMs?: number; required: boolean }> };
type Setup = { ok: boolean; snapshotAt?: string; counts?: Record<string, number> };

export default function LabHome() {
  const me = useMe();
  const { data: health } = useApi<Health>("/api/health");
  const { data: setup, reload } = useApi<Setup>("/api/lab/setup");
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const svc = [
    ["postgres", "PostgreSQL 16", "Operational source of truth (ACID)"],
    ["mongodb", "MongoDB 7", "Incident documents"],
    ["lab", "Lab sandbox DB", "Isolated, rolled-back experiments"],
    ["redis", "Redis 7", "Key-value cache & rate limits"],
    ["neo4j", "Neo4j 5", "Graph projection (Cypher)"],
    ["vector", "pgvector", "Embeddings & similarity search"],
  ];
  return (
    <>
      <section className="lab-hero">
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark"><Database size={18} /></div>
          <span className="eyebrow" style={{ color: "#5eead4", margin: 0 }}>Database Engineering Lab</span>
        </div>
        <h1 style={{ marginTop: 14 }}>Every DBMS concept, executed on ReliefFlow&apos;s own data</h1>
        <p>
          Demonstrations run real SQL against a sanitised snapshot of the operational database in a separate sandbox database, as a
          least-privilege role, inside transactions that are always rolled back. Timings and plans are measured live — nothing is canned.
        </p>
      </section>
      <div className="grid g-4" style={{ marginBottom: 16 }}>
        {units.map((u) => (
          <div className="card unit-card" key={u.unit}>
            <div className="tag">{u.unit}</div>
            <h2 style={{ marginTop: 4 }}>{u.title}</h2>
            <ul>
              {u.items.map(([t, href]) => (
                <li key={t}><Link href={href}>{t}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="grid g-main">
        <Card title="Data platform status" subtitle="Live health checks. Optional services degrade gracefully when absent.">
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Service</th><th>Role</th><th>Status</th><th className="num">Latency</th></tr></thead>
              <tbody>
                {svc.map(([k, name, role]) => {
                  const s = health?.services[k];
                  return (
                    <tr key={k}>
                      <td className="cell-main">{name}</td>
                      <td className="small muted">{role}</td>
                      <td>{!s ? <Badge value="PENDING" label="Checking" /> : s.ok ? <Badge value="AVAILABLE" label="Online" /> : s.configured === false ? <Badge value="CLOSED" label="Not configured" /> : <Badge value="CRITICAL" label="Unreachable" />}</td>
                      <td className="num small">{s?.latencyMs != null ? `${s.latencyMs} ms` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card
          title="Lab snapshot"
          subtitle="reliefflow_lab — e-mails, phones and password hashes are removed during the copy"
          actions={
            me?.role_name === "ADMIN" ? (
              <Button
                size="sm"
                icon={<RefreshCw size={13} />}
                loading={busy}
                onClick={async () => {
                  if (!(await confirm({ title: "Rebuild the lab snapshot?", text: "The sandbox database is recreated from the current operational data (read-only on production). Takes a few seconds." }))) return;
                  setBusy(true);
                  try {
                    await api("/api/lab/setup", { body: {} });
                    toast("success", "Lab snapshot rebuilt");
                    await reload();
                  } catch (e) {
                    toast("error", e instanceof Error ? e.message : "Rebuild failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Rebuild
              </Button>
            ) : undefined
          }
        >
          {!setup ? <p className="muted small">Checking…</p> : !setup.ok ? (
            <p className="small">The lab database is not set up yet. Run <code>npm run lab:setup</code>.</p>
          ) : (
            <>
              <p className="small">Snapshot taken {fmtDate(setup.snapshotAt)}</p>
              <div className="chip-row" style={{ marginTop: 10 }}>
                {Object.entries(setup.counts ?? {}).filter(([, n]) => n > 0).map(([t, n]) => <span key={t} className="badge plain gray">{t}: {n}</span>)}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
