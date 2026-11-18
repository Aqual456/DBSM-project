"use client";
import { useState } from "react";
import { Play, RefreshCw, Share2 } from "lucide-react";
import { api, useApi, fmtDate } from "@/lib/client";
import { Alert, Badge, Button, Card, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { ResultTable } from "@/components/lab/LabKit";
import ForceGraph, { LABEL_COLORS, type GEdge, type GNode } from "@/components/lab/ForceGraph";
import { useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Status = {
  configured: boolean; ok: boolean; latencyMs?: number;
  runs: { run_id: string; status: string; attempts: number; records_synced: number; detail: string; started_at: string }[];
  queries: { id: string; title: string; cypher: string; params: string[] }[];
};
type QRes = { title: string; cypher: string; ms: number; rows: Record<string, unknown>[]; graph: { nodes: GNode[]; edges: GEdge[] } };
type Opts = { disasters: { disaster_id: string; disaster_name: string }[]; warehouses: { warehouse_id: string; warehouse_name: string }[] };

export default function GraphLab() {
  const { data, reload } = useApi<Status>("/api/graph");
  const { data: opts } = useApi<Opts>("/api/request-options");
  const me = useMe();
  const toast = useToast();
  const [q, setQ] = useState("overview");
  const [p, setP] = useState({ disasterId: "", warehouseId: "" });
  const [res, setRes] = useState<QRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState("");
  const def = data?.queries.find((x) => x.id === q);
  const missing = def?.params.some((x) => !p[x as keyof typeof p]) ?? false;

  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const qs = new URLSearchParams({ query: q });
      if (p.disasterId) qs.set("disasterId", p.disasterId);
      if (p.warehouseId) qs.set("warehouseId", p.warehouseId);
      setRes(await api<QRes>(`/api/graph?${qs}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ status: string; records: number; attempts: number }>("/api/graph", { body: {} });
      toast(r.status === "SUCCEEDED" ? "success" : "error", r.status === "SUCCEEDED" ? `Synced ${r.records} records from PostgreSQL (${r.attempts} attempt)` : "Sync failed — previous graph kept");
      await reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 4"
        title="Graph Database (Neo4j)"
        lead="ReliefFlow's response network as a property graph: Disaster–AFFECTS→Location–CONTAINS→Camp–RAISED→Request–NEEDS→Resource←STORES–Warehouse, Camp–REQUESTS→Resource, Allocation–SUPPLIES→Camp, Delivery–TRANSPORTS→Allocation. Queried with fixed, parameterised Cypher."
        actions={isManager(me) && data?.configured ? <Button variant="primary" icon={<RefreshCw size={15} />} loading={syncing} onClick={sync}>Sync from PostgreSQL</Button> : undefined}
      />
      <div className="stack">
        {!data ? (
          <div className="card"><SkeletonRows /></div>
        ) : !data.configured ? (
          <Alert kind="warn">Neo4j is not configured. Set NEO4J_URI, NEO4J_USER and NEO4J_PASSWORD and start it with <code>docker compose --profile optional up -d neo4j</code>. The rest of ReliefFlow is unaffected.</Alert>
        ) : !data.ok ? (
          <Alert kind="error">Neo4j is configured but unreachable. Graph features are paused; operations continue normally.</Alert>
        ) : null}
        <div className="grid g-main">
          <Card title="Cypher queries" subtitle="Read-only session; parameters are bound, never interpolated">
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {data?.queries.map((x) => (
                <button key={x.id} className="chip" aria-pressed={q === x.id} onClick={() => { setQ(x.id); setRes(null); }}>{x.title}</button>
              ))}
            </div>
            {def && <pre className="code" style={{ whiteSpace: "pre-wrap" }}>{def.cypher.replace(/\n\s+/g, "\n")}</pre>}
            <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              {def?.params.includes("disasterId") && (
                <div className="field" style={{ minWidth: 220 }}>
                  <label className="field-label" htmlFor="g-d">$disasterId</label>
                  <select id="g-d" className="input" value={p.disasterId} onChange={(e) => setP({ ...p, disasterId: e.target.value })}>
                    <option value="">Select disaster…</option>
                    {opts?.disasters.map((d) => <option key={d.disaster_id} value={d.disaster_id}>{d.disaster_name}</option>)}
                  </select>
                </div>
              )}
              {def?.params.includes("warehouseId") && (
                <div className="field" style={{ minWidth: 220 }}>
                  <label className="field-label" htmlFor="g-w">$warehouseId</label>
                  <select id="g-w" className="input" value={p.warehouseId} onChange={(e) => setP({ ...p, warehouseId: e.target.value })}>
                    <option value="">Select warehouse…</option>
                    {opts?.warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
                  </select>
                </div>
              )}
              <Button variant="primary" icon={<Play size={14} />} loading={busy} disabled={!data?.ok || missing} onClick={run}>Run query</Button>
            </div>
          </Card>
          <Card title="Synchronisation" subtitle="PostgreSQL → Neo4j: full refresh in one Neo4j transaction, up to 3 attempts">
            {!data?.runs.length ? (
              <p className="small muted">No sync runs yet.</p>
            ) : (
              data.runs.map((r) => (
                <div className="list-item" key={r.run_id}>
                  <div style={{ flex: 1 }}>
                    <div className="small cell-main">Run #{r.run_id} · {r.records_synced} records · {r.attempts} attempt(s)</div>
                    <div className="cell-sub">{fmtDate(r.started_at)} · {r.detail}</div>
                  </div>
                  <Badge value={r.status} />
                </div>
              ))
            )}
            <p className="small muted" style={{ marginTop: 8 }}>The graph is a projection: it can lag PostgreSQL until the next sync, and a failed sync keeps the previous complete snapshot.</p>
          </Card>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {res && (
          <Card
            title={res.title}
            subtitle={`${res.ms} ms · ${res.graph.nodes.length} nodes · ${res.graph.edges.length} relationships · ${res.rows.length} rows`}
            actions={<div className="graph-legend">{Object.entries(LABEL_COLORS).map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>}
          >
            {res.graph.nodes.length > 0 && <ForceGraph nodes={res.graph.nodes} edges={res.graph.edges} />}
            {res.rows.length > 0 && (
              <ResultTable
                fields={Object.keys(res.rows[0]).filter((k) => res.rows[0][k] !== undefined)}
                rows={res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v])))}
              />
            )}
            {!res.graph.nodes.length && !res.rows.length && <p className="small muted"><Share2 size={13} /> No matching paths. Try another disaster or warehouse, or re-sync.</p>}
          </Card>
        )}
      </div>
    </>
  );
}
