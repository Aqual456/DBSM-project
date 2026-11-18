"use client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DemoSections } from "@/components/lab/LabKit";
import Playground from "@/components/lab/Playground";

const groups = [
  ["DDL — define structure", "CREATE, ALTER, DROP, TRUNCATE"],
  ["DML — change data", "INSERT, UPDATE, DELETE (+ RETURNING, ON CONFLICT)"],
  ["DQL — query", "SELECT with WHERE, ORDER BY, GROUP BY, HAVING, DISTINCT, LIMIT"],
  ["DCL — control access", "GRANT, REVOKE (used by lab setup: the rf_lab role gets table privileges only)"],
  ["TCL — transactions", "BEGIN, COMMIT, ROLLBACK, SAVEPOINT (see Transactions lab)"],
];

export default function SqlExplorer() {
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 1" title="SQL Explorer" lead="Curated, runnable examples of every SQL statement class and clause, plus a guarded playground for your own queries." />
      <div className="stack">
        <Card title="SQL sub-languages">
          <div className="grid g-3" style={{ gap: 10 }}>
            {groups.map(([t, d]) => (
              <div key={t} className="card card-pad" style={{ boxShadow: "none" }}>
                <div className="cell-main">{t}</div>
                <div className="small muted">{d}</div>
              </div>
            ))}
          </div>
        </Card>
        <Playground />
        <DemoSections ids={["sql-basics", "constraints", "aggregation"]} />
      </div>
    </>
  );
}
