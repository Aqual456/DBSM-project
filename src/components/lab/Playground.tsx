"use client";
import { useState } from "react";
import { Play, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import { Alert, Button, Card } from "@/components/ui/primitives";
import { StepResult, type Step } from "./LabKit";

const examples: [string, string][] = [
  ["Open requests by camp", "SELECT c.camp_name, count(*) AS open_requests\nFROM resource_requests rr JOIN relief_camps c USING (camp_id)\nWHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')\nGROUP BY c.camp_name\nORDER BY open_requests DESC;"],
  ["Low stock", "SELECT * FROM v_low_stock ORDER BY quantity_available;"],
  ["Try an UPDATE (rolled back)", "UPDATE inventory SET quantity_available = quantity_available + 100\nWHERE resource_id = 1\nRETURNING warehouse_id, resource_id, quantity_available;"],
  ["CREATE TABLE AS", "CREATE TABLE my_summary AS\nSELECT disaster_type, count(*) AS n FROM disasters GROUP BY disaster_type;"],
  ["EXPLAIN ANALYZE", "EXPLAIN (ANALYZE, FORMAT JSON)\nSELECT * FROM bench_movements WHERE warehouse_id = 7 ORDER BY created_at DESC LIMIT 20;"],
  ["Blocked: multiple statements", "SELECT 1; DROP TABLE disasters;"],
];

export default function Playground() {
  const [sql, setSql] = useState(examples[0][1]);
  const [res, setRes] = useState<(Step & { kind?: string }) | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      const r = await api<{ results: Step[]; kind: string }>("/api/lab/sql", { body: { sql } });
      setRes({ ...r.results[0], kind: r.kind });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Execution failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="SQL playground"
      subtitle="Write one statement against the lab snapshot. Ctrl+Enter runs it."
      actions={<span className="small muted row" style={{ gap: 6 }}><ShieldCheck size={14} /> sandbox DB · restricted role · 4 s timeout · always rolled back</span>}
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="chip-row">
          {examples.map(([label, q]) => (
            <button key={label} className="chip" aria-pressed={sql === q} onClick={() => setSql(q)}>{label}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="sql-input">SQL statement</label>
        <textarea
          id="sql-input"
          className="input mono"
          spellCheck={false}
          style={{ minHeight: 150, fontFamily: "var(--mono)", fontSize: 13, background: "#0e1726", color: "#dbe5f3", borderColor: "#1e2a3d" }}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="row">
          <Button variant="primary" icon={<Play size={14} />} loading={busy} onClick={run}>Run statement</Button>
          <span className="small muted">Tables: disasters, locations, relief_camps, warehouses, inventory, resources, resource_requests, request_items, allocations, deliveries … and benchmark tables bench_movements (300k rows), bench_requests, bench_warehouses.</span>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {res && <StepResult s={res} />}
      </div>
    </Card>
  );
}
