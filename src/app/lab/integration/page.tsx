"use client";
import { useState } from "react";
import { Play, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/client";
import { Alert, Button, Card, PageHeader } from "@/components/ui/primitives";
import { SqlCode } from "@/components/lab/LabKit";

type Trace = { stages: { stage: string; detail: string; ms: number; ok: boolean }[]; totalMs?: number; sample?: unknown };

const layers = [
  ["Browser (React)", "fetch('/api/requests', { method: 'POST', body: JSON })", "Never talks to a database. Shows server error messages verbatim; never computes stock or permissions."],
  ["Route handler", "src/app/api/requests/route.ts → endpoint()", "Request id, structured log line, error → status-code mapping, cache invalidation after writes."],
  ["Auth", "actor(req, roles)", "Opaque cookie → SHA-256 → sessions ⋈ app_users ⋈ roles; same-origin check on writes."],
  ["Validation", "requestSchema.parse(body)", "Zod strict objects: types, ranges, unexpected fields, duplicate items, future dates."],
  ["Transaction", "transaction(async c => …, user)", "BEGIN; SET LOCAL lock_timeout; set_config('reliefflow.user_id'); parameterised SQL; COMMIT or ROLLBACK."],
  ["Database", "constraints + triggers + procedures", "Final guard: CHECK/FK/UNIQUE, validation triggers, refresh_request_status()."],
];

export default function Integration() {
  const [res, setRes] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qty, setQty] = useState("25");
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      setRes(await api<Trace>("/api/lab/trace", { body: { quantity: Number(qty) } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Trace failed");
    } finally {
      setBusy(false);
    }
  };
  const max = Math.max(1, ...(res?.stages.map((s) => s.ms) ?? [1]));
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 4" title="Next.js ↔ SQL Integration" lead="How a button click becomes a committed PostgreSQL transaction, with a live, timed trace of every layer." />
      <div className="stack">
        <Card title="Request path">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Layer</th><th>Code</th><th>Responsibility</th></tr></thead>
              <tbody>{layers.map(([a, b, c]) => <tr key={a}><td className="cell-main">{a}</td><td><code>{b}</code></td><td className="small">{c}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card
          title="Live trace"
          subtitle="Creates a resource request through the real validation and SQL, then ROLLS BACK. Try a negative quantity to see validation stop the pipeline."
          actions={
            <div className="row">
              <label className="small field-label" htmlFor="tr-q">Quantity</label>
              <input id="tr-q" className="input" type="number" style={{ width: 100 }} value={qty} onChange={(e) => setQty(e.target.value)} />
              <Button variant="primary" icon={<Play size={14} />} loading={busy} onClick={run}>Run trace</Button>
            </div>
          }
        >
          {err && <Alert kind="error">{err}</Alert>}
          {!res ? <p className="small muted">Press Run trace.</p> : (
            <div className="stack" style={{ gap: 8 }}>
              {res.stages.map((s) => (
                <div key={s.stage}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="small cell-main row" style={{ gap: 6 }}>{s.ok ? <CheckCircle2 size={14} color="var(--success)" /> : <XCircle size={14} color="var(--danger)" />}{s.stage}</span>
                    <span className="small num">{s.ms} ms</span>
                  </div>
                  <div className="meter"><span style={{ width: `${Math.max(2, (100 * s.ms) / max)}%`, background: s.ok ? "var(--primary)" : "var(--danger)" }} /></div>
                  <div className="cell-sub"><code>{s.detail}</code></div>
                </div>
              ))}
              {res.totalMs !== undefined && <p className="small muted">Total {res.totalMs} ms (server-side, measured). Nothing was committed.</p>}
            </div>
          )}
        </Card>
        <div className="grid g-2">
          <Card title="Parameterised SQL (never string concatenation)">
            <SqlCode sql={`-- values travel separately from the SQL text ($1, $2 …)\nINSERT INTO resource_requests(camp_id, disaster_id, requested_by, need_by)\nVALUES ($1, $2, $3, $4)\nRETURNING request_id;\n\n-- many lines in one statement\nINSERT INTO request_items(request_id, resource_id, quantity_requested)\nSELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) AS x(r, q);`} />
          </Card>
          <Card title="Error handling contract">
            <table className="data compact">
              <tbody>
                {[
                  ["400", "VALIDATION_ERROR / MALFORMED_JSON", "Zod or JSON parse failure"],
                  ["401 / 403", "UNAUTHENTICATED / FORBIDDEN", "No session or wrong role"],
                  ["404", "NOT_FOUND", "Unknown record"],
                  ["409", "BUSINESS_RULE / DUPLICATE / STALE_RECORD / DEADLOCK", "Trigger RAISE, constraint, optimistic lock, 40P01"],
                  ["429", "RATE_LIMITED", "Login throttling, lab limits"],
                  ["503", "SERVICE_UNAVAILABLE", "Database unreachable"],
                ].map(([a, b, c]) => <tr key={a}><td className="num">{a}</td><td><code>{b}</code></td><td className="small">{c}</td></tr>)}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>Raw database messages, stack traces and SQL never reach the client; each response carries an <code>x-request-id</code> that matches the server log line.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
