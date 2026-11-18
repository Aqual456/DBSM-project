"use client";
import { Fragment, useState, type ReactNode } from "react";
import { Play, CheckCircle2, XCircle, Clock, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { Alert, Badge, Button, Card, ErrorState, SkeletonRows } from "@/components/ui/primitives";

const KW = new Set(
  "select from where group by having order limit offset insert into values update set delete create table alter add drop truncate join inner left right full outer cross on using as and or not null is in exists between like ilike distinct union all intersect except with recursive case when then else end primary key foreign references unique check constraint default index view returning conflict do nothing explain analyze buffers format json verbose costs off over partition window rows range preceding following current row unbounded any some savepoint rollback release to begin commit filter asc desc nulls first last lateral natural generated always identity cascade restrict call procedure function trigger language plpgsql declare if elsif loop return for each execute before after of local isolation level read committed repeatable serializable share nowait skip locked deferrable initially deferred immediate constraints true false interval timestamptz numeric integer bigint text varchar boolean"
    .split(" "),
);
/** Tiny SQL highlighter (keywords, strings, numbers, comments, function calls). */
export function SqlCode({ sql }: { sql: string }) {
  const parts: ReactNode[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\$\$[\s\S]*?\$\$)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(\s+|[^\sA-Za-z0-9_'-]+|-)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(sql))) {
    const k = i++;
    if (m[1]) parts.push(<span key={k} className="cm">{m[1]}</span>);
    else if (m[2] || m[3]) parts.push(<span key={k} className="str">{m[2] ?? m[3]}</span>);
    else if (m[4]) parts.push(<span key={k} className="num">{m[4]}</span>);
    else if (m[5]) {
      const w = m[5];
      if (KW.has(w.toLowerCase())) parts.push(<Fragment key={k}><span className="kw">{w}</span>{m[6]}</Fragment>);
      else if (m[6]) parts.push(<Fragment key={k}><span className="fn">{w}</span>{m[6]}</Fragment>);
      else parts.push(w);
    } else parts.push(m[7] ?? m[0]);
  }
  return <pre className="code">{parts}</pre>;
}

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="muted">NULL</span>;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return <code className="small">{JSON.stringify(v).slice(0, 160)}</code>;
  const s = String(v);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

export function ResultTable({ fields, rows, max = 50 }: { fields: string[]; rows: Record<string, unknown>[]; max?: number }) {
  if (!rows.length) return <p className="small muted" style={{ padding: "10px 12px" }}>0 rows</p>;
  return (
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table className="data compact">
        <thead><tr>{fields.map((f, i) => <th key={i}>{f}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>{fields.map((f, j) => <td key={j}>{cell(r[f])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="small muted" style={{ padding: "6px 12px" }}>Showing {max} of {rows.length} rows</p>}
    </div>
  );
}

type PlanNode = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Join Type"?: string; "Startup Cost"?: number; "Total Cost"?: number; "Plan Rows"?: number; "Actual Total Time"?: number; "Actual Rows"?: number; "Actual Loops"?: number; "Heap Fetches"?: number; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; "Index Cond"?: string; Filter?: string; "Rows Removed by Filter"?: number; "Hash Cond"?: string; "Merge Cond"?: string; "Join Filter"?: string; Plans?: PlanNode[] };
const scanTone = (t: string) => (/Index Only/.test(t) ? "green" : /Index|Bitmap/.test(t) ? "blue" : /Seq Scan/.test(t) ? "amber" : /Join|Loop/.test(t) ? "violet" : "gray");

function Node({ n, depth = 0 }: { n: PlanNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="plan-node" style={{ marginLeft: depth ? 10 : 0 }}>
      <div className="plan-node-head">
        {n.Plans?.length ? (
          <button className="btn ghost sm icon" style={{ width: 20, height: 20 }} aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : null}
        <Badge value="x" color={scanTone(n["Node Type"])} label={n["Node Type"] + (n["Join Type"] && n["Join Type"] !== "Inner" ? ` (${n["Join Type"]})` : "")} />
        {n["Relation Name"] && <b>{n["Relation Name"]}</b>}
        {n["Index Name"] && <span className="small">using <code>{n["Index Name"]}</code></span>}
        <span className="plan-metric">cost {n["Startup Cost"]?.toFixed(2)}..{n["Total Cost"]?.toFixed(2)}</span>
        <span className="plan-metric">est. rows {n["Plan Rows"]}</span>
        {n["Actual Total Time"] !== undefined && <span className="plan-metric" style={{ color: "var(--text)" }}>actual {n["Actual Total Time"].toFixed(3)} ms × {n["Actual Loops"]} · rows {n["Actual Rows"]}</span>}
        {n["Heap Fetches"] !== undefined && <span className="plan-metric">heap fetches {n["Heap Fetches"]}</span>}
        {(n["Shared Hit Blocks"] !== undefined || n["Shared Read Blocks"] !== undefined) && <span className="plan-metric">buffers hit {n["Shared Hit Blocks"] ?? 0} read {n["Shared Read Blocks"] ?? 0}</span>}
      </div>
      {(n["Index Cond"] || n.Filter || n["Hash Cond"] || n["Merge Cond"] || n["Join Filter"]) && (
        <div className="small muted" style={{ margin: "3px 0 0 4px" }}>
          {n["Index Cond"] && <div>Index cond: <code>{n["Index Cond"]}</code></div>}
          {n["Hash Cond"] && <div>Hash cond: <code>{n["Hash Cond"]}</code></div>}
          {n["Merge Cond"] && <div>Merge cond: <code>{n["Merge Cond"]}</code></div>}
          {n["Join Filter"] && <div>Join filter: <code>{n["Join Filter"]}</code></div>}
          {n.Filter && <div>Filter: <code>{n.Filter}</code>{n["Rows Removed by Filter"] !== undefined && ` (removed ${n["Rows Removed by Filter"]} rows)`}</div>}
        </div>
      )}
      {open && n.Plans?.map((c, i) => <Node key={i} n={c} depth={depth + 1} />)}
    </div>
  );
}

/** Renders EXPLAIN (FORMAT JSON) output: plan tree with measured times. */
export function PlanView({ value }: { value: unknown }) {
  let parsed: { Plan: PlanNode; "Planning Time"?: number; "Execution Time"?: number }[] | null = null;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : (value as typeof parsed);
  } catch {
    parsed = null;
  }
  if (!parsed?.[0]?.Plan) return <pre className="code">{String(value)}</pre>;
  const p = parsed[0];
  return (
    <div style={{ padding: 12 }}>
      <div className="row small" style={{ marginBottom: 8, gap: 14 }}>
        <span><b>Total cost</b> <span className="num">{p.Plan["Total Cost"]?.toFixed(2)}</span></span>
        {p["Planning Time"] !== undefined && <span><b>Planning</b> <span className="num">{p["Planning Time"].toFixed(3)} ms</span></span>}
        {p["Execution Time"] !== undefined && <span><b>Execution</b> <span className="num">{p["Execution Time"].toFixed(3)} ms</span> <span className="muted">(measured)</span></span>}
      </div>
      <Node n={p.Plan} />
    </div>
  );
}

export type Step = { sql: string; command?: string; rowCount?: number | null; fields?: string[]; rows?: Record<string, unknown>[]; truncated?: boolean; ms: number; notices?: string[]; error?: { code?: string; message: string; detail?: string; hint?: string } };

export function StepResult({ s, index }: { s: Step; index?: number }) {
  const isPlan = s.fields?.length === 1 && s.fields[0] === "QUERY PLAN" && s.rows?.length === 1 && typeof s.rows[0]["QUERY PLAN"] === "object";
  const textPlan = s.fields?.length === 1 && s.fields[0] === "QUERY PLAN" && !isPlan;
  return (
    <div className="step-result">
      <div className="step-result-head">
        {s.error ? <XCircle size={14} color="var(--danger)" /> : <CheckCircle2 size={14} color="var(--success)" />}
        {index !== undefined && <span className="num">#{index + 1}</span>}
        <code title={s.sql}>{s.sql.replace(/\s+/g, " ").slice(0, 110)}</code>
        <span className="num"><Clock size={11} /> {s.ms} ms</span>
        {!s.error && s.command && <span>{s.command}{s.rowCount != null && s.command !== "SELECT" ? ` ${s.rowCount}` : ""}</span>}
      </div>
      {s.error ? (
        <div className="result-error">
          <b>{s.error.code ? `SQLSTATE ${s.error.code}: ` : ""}</b>
          {s.error.message}
          {s.error.detail && <div className="small">Detail: {s.error.detail}</div>}
          {s.error.hint && <div className="small">Hint: {s.error.hint}</div>}
        </div>
      ) : isPlan ? (
        <PlanView value={s.rows![0]["QUERY PLAN"]} />
      ) : textPlan ? (
        <pre className="code" style={{ borderRadius: 0 }}>{s.rows?.map((r) => String(r["QUERY PLAN"])).join("\n")}</pre>
      ) : s.fields?.length ? (
        <ResultTable fields={s.fields} rows={s.rows ?? []} />
      ) : (
        <p className="small muted" style={{ padding: "8px 12px" }}>{s.command ?? "OK"}{s.rowCount != null ? ` · ${s.rowCount} row(s) affected` : ""}</p>
      )}
      {s.notices?.length ? <div className="small muted" style={{ padding: "6px 12px" }}>NOTICE: {s.notices.join(" · ")}</div> : null}
    </div>
  );
}

export type DemoMeta = { id: string; unit: number; section: string; title: string; explain: string; algebra?: string; steps: string[]; plan: boolean };
export type Catalog = { sections: Record<string, { unit: number; title: string; blurb: string }>; demos: DemoMeta[] };

export function DemoCard({ d }: { d: DemoMeta }) {
  const [res, setRes] = useState<{ results: Step[]; totalMs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showSql, setShowSql] = useState(true);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      setRes(await api<{ results: Step[]; totalMs: number }>("/api/lab/demos", { body: { id: d.id } }));
      setShowSql(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={d.title}
      subtitle={d.explain}
      actions={
        <>
          {res && <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setShowSql(!showSql)}>{showSql ? "Hide SQL" : "Show SQL"}</Button>}
          <Button size="sm" variant="primary" icon={<Play size={13} />} loading={busy} onClick={run}>{res ? "Run again" : "Run"}</Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        {d.algebra && <div className="algebra" aria-label="Relational algebra expression">{d.algebra}</div>}
        {showSql && <SqlCode sql={d.steps.join("\n\n")} />}
        {err && <Alert kind="error">{err}</Alert>}
        {res && (
          <>
            <p className="small muted">
              {res.results.length} statement(s) · {res.totalMs} ms · executed in the lab sandbox, then <b>rolled back</b>
            </p>
            {res.results.map((s, i) => (
              <StepResult key={i} s={s} index={res.results.length > 1 ? i : undefined} />
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

/** Shows all demos of the given catalog sections, grouped. */
export function DemoSections({ ids }: { ids: string[] }) {
  const { data, error, reload } = useApi<Catalog>("/api/lab/demos");
  const [active, setActive] = useState(ids[0]);
  if (error) return <div className="card"><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className="card"><SkeletonRows rows={8} /></div>;
  const sec = data.sections[active];
  return (
    <>
      {ids.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Topics">
          {ids.map((id) => (
            <button key={id} role="tab" className="tab" aria-selected={active === id} onClick={() => setActive(id)}>
              {data.sections[id]?.title ?? id}
            </button>
          ))}
        </div>
      )}
      {sec && <p className="muted" style={{ marginBottom: 14 }}>{sec.blurb}</p>}
      <div className="stack">
        {data.demos.filter((d) => d.section === active).map((d) => (
          <DemoCard key={d.id} d={d} />
        ))}
      </div>
    </>
  );
}

export function Concept({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="small" style={{ color: "var(--text-2)", lineHeight: 1.65 }}>{children}</div>
    </Card>
  );
}
