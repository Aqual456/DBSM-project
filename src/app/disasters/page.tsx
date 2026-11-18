"use client";
import Link from "next/link";
import { useState } from "react";
import { MapPin, Pencil, Plus, RefreshCw, Siren, Tent, ClipboardList, Users } from "lucide-react";
import { api, useApi, fmtDate, fmtNumber, titleCase, toLocalInput } from "@/lib/client";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Meter, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/DataTable";
import { Modal, useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Disaster = {
  disaster_id: string; disaster_name: string; disaster_type: string; severity: string; status: string; started_at: string; ended_at: string | null;
  description: string | null; event_location_id: string | null; location_name: string | null; affected_population: string; affected_locations: string; open_requests: string; total_requests: string;
};
type Detail = Disaster & {
  units_allocated: string;
  locations: { location_id: string; location_name: string; location_type: string; impact_level: string; affected_population: number; reported_at: string }[];
  camps: { camp_id: string; camp_name: string; capacity: number; current_population: number; status: string; location_name: string }[];
  requests: { request_id: string; status: string; priority_level: string; camp_name: string; fulfillment_pct: string; need_by: string }[];
};
type Loc = { location_id: string; location_name: string };

export default function DisastersPage() {
  const me = useMe();
  const manager = isManager(me);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useApi<Disaster[]>(`/api/disasters${query ? `?q=${encodeURIComponent(query)}` : ""}`, [query]);
  const [edit, setEdit] = useState<Partial<Disaster> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Disaster operations"
        title="Disasters"
        lead="Registered events, the locations they affect and the response footprint. Search uses PostgreSQL full-text search over names and descriptions."
        actions={
          <>
            <Button icon={<RefreshCw size={15} />} onClick={reload} loading={loading && Boolean(data)}>Refresh</Button>
            {manager && <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEdit({})}>Register disaster</Button>}
          </>
        }
      />
      <form
        className="row"
        style={{ marginBottom: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
        role="search"
      >
        <input className="input" style={{ maxWidth: 420 }} placeholder='Full-text search, e.g. flood -drill or "storm surge"' aria-label="Full-text search disasters" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit">Search</Button>
        {query && <Button type="button" variant="ghost" onClick={() => { setQ(""); setQuery(""); }}>Clear</Button>}
        {query && <span className="small muted">Ranked with ts_rank over a weighted tsvector (GIN index)</span>}
      </form>
      <DataTable
        label="Disasters"
        rows={data as unknown as Record<string, unknown>[] | null}
        loading={loading}
        error={error}
        onRetry={reload}
        rowKey={(r) => String(r.disaster_id)}
        onRowClick={(r) => setOpenId(String(r.disaster_id))}
        filters={[
          { key: "status", label: "Statuses", options: ["ACTIVE", "CONTAINED", "CLOSED"], value: (r) => r.status },
          { key: "severity", label: "Severities", options: ["CRITICAL", "HIGH", "MODERATE", "LOW"], value: (r) => r.severity },
        ]}
        columns={[
          { key: "disaster_name", header: "Disaster", render: (r) => <div><div className="cell-main">{String(r.disaster_name)}</div><div className="cell-sub">{titleCase(r.disaster_type)} · {String(r.location_name ?? "location not set")}</div></div> },
          { key: "severity", header: "Severity", value: (r) => ["LOW", "MODERATE", "HIGH", "CRITICAL"].indexOf(String(r.severity)), render: (r) => <Badge value={r.severity} /> },
          { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
          { key: "affected_population", header: "Affected", align: "right", value: (r) => Number(r.affected_population), render: (r) => fmtNumber(r.affected_population) },
          { key: "open_requests", header: "Open requests", align: "right", value: (r) => Number(r.open_requests) },
          { key: "started_at", header: "Started", render: (r) => <span className="small">{fmtDate(r.started_at, false)}</span> },
        ]}
        actions={manager ? (r) => <Button size="sm" icon={<Pencil size={13} />} onClick={() => setEdit(r as unknown as Disaster)}>Edit</Button> : undefined}
        empty={<EmptyState title="No disasters registered" icon={<Siren size={22} />} />}
      />
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.disaster_id ? "Edit disaster" : "Register disaster"} description="Duplicates (same name, type, start date and location) are rejected by a database trigger.">
        {edit && <DisasterForm initial={edit} onDone={() => { setEdit(null); void reload(); }} onCancel={() => setEdit(null)} />}
      </Modal>
      <Modal open={Boolean(openId)} onClose={() => setOpenId(null)} title="Disaster overview" drawer>
        {openId && <DisasterDetail id={openId} manager={manager} onChanged={reload} />}
      </Modal>
    </>
  );
}

function DisasterForm({ initial, onDone, onCancel }: { initial: Partial<Disaster>; onDone: () => void; onCancel: () => void }) {
  const { data: locs } = useApi<Loc[]>("/api/operations?kind=locations");
  const toast = useToast();
  const [v, setV] = useState({
    disaster_name: initial.disaster_name ?? "",
    disaster_type: initial.disaster_type ?? "FLOOD",
    severity: initial.severity ?? "HIGH",
    status: initial.status ?? "ACTIVE",
    started_at: toLocalInput(initial.started_at ? new Date(initial.started_at) : new Date()),
    event_location_id: String(initial.event_location_id ?? ""),
    description: initial.description ?? "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (v.disaster_name.trim().length < 2) return setErr("Name must have at least 2 characters");
    if (!v.event_location_id) return setErr("Choose the event location");
    const started = new Date(v.started_at);
    if (Number.isNaN(started.getTime())) return setErr("Enter a valid start date");
    setBusy(true);
    try {
      await api("/api/disasters", {
        method: initial.disaster_id ? "PATCH" : "POST",
        body: { ...(initial.disaster_id ? { disaster_id: Number(initial.disaster_id) } : {}), ...v, disaster_name: v.disaster_name.trim(), started_at: started.toISOString(), event_location_id: Number(v.event_location_id) },
      });
      toast("success", initial.disaster_id ? "Disaster updated" : "Disaster registered");
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="field full">
          <label className="field-label" htmlFor="d-name">Disaster name *</label>
          <input id="d-name" className="input" maxLength={160} value={v.disaster_name} onChange={(e) => setV({ ...v, disaster_name: e.target.value })} placeholder="e.g. Kerala Monsoon Floods" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-type">Type</label>
          <select id="d-type" className="input" value={v.disaster_type} onChange={(e) => setV({ ...v, disaster_type: e.target.value })}>
            {["FLOOD", "CYCLONE", "EARTHQUAKE", "LANDSLIDE", "DROUGHT", "HEATWAVE", "FIRE", "OTHER"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-sev">Severity</label>
          <select id="d-sev" className="input" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>
            {["LOW", "MODERATE", "HIGH", "CRITICAL"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-loc">Event location *</label>
          <select id="d-loc" className="input" value={v.event_location_id} onChange={(e) => setV({ ...v, event_location_id: e.target.value })}>
            <option value="">{locs ? "Select…" : "Loading…"}</option>
            {locs?.map((l) => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-start">Started *</label>
          <input id="d-start" className="input" type="datetime-local" value={v.started_at} onChange={(e) => setV({ ...v, started_at: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="d-status">Status</label>
          <select id="d-status" className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {["ACTIVE", "CONTAINED", "CLOSED"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
          <small>Closing records an end time; closed disasters accept no new requests.</small>
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="d-desc">Description</label>
          <textarea id="d-desc" className="input" maxLength={5000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
      </div>
      {err && <div style={{ marginTop: 14 }}><Alert kind="error">{err}</Alert></div>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Save</Button>
      </div>
    </form>
  );
}

function DisasterDetail({ id, manager, onChanged }: { id: string; manager: boolean; onChanged: () => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/disasters?id=${id}`, [id]);
  const { data: locs } = useApi<Loc[]>(manager ? "/api/operations?kind=locations" : null);
  const toast = useToast();
  const [link, setLink] = useState({ location_id: "", impact_level: "HIGH", affected_population: "" });
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={10} />;
  return (
    <div className="stack">
      <div>
        <h2 style={{ fontSize: 20 }}>{data.disaster_name}</h2>
        <div className="row" style={{ marginTop: 8 }}>
          <Badge value={data.severity} />
          <Badge value={data.status} />
          <span className="small muted">{titleCase(data.disaster_type)} · started {fmtDate(data.started_at)}</span>
        </div>
        {data.description && <p className="muted" style={{ marginTop: 10 }}>{data.description}</p>}
      </div>
      <div className="grid g-3">
        <div className="card kpi"><span className="kpi-label">Affected</span><div className="kpi-value">{fmtNumber(data.affected_population)}</div><div className="kpi-foot">{data.affected_locations} locations</div></div>
        <div className="card kpi"><span className="kpi-label">Requests</span><div className="kpi-value">{data.total_requests}</div><div className="kpi-foot">{data.open_requests} open</div></div>
        <div className="card kpi"><span className="kpi-label">Units allocated</span><div className="kpi-value">{fmtNumber(data.units_allocated)}</div><div className="kpi-foot">mixed units</div></div>
      </div>
      <Card title="Affected locations" subtitle="disaster_locations — an M:N relationship with impact attributes">
        {data.locations.map((l) => (
          <div className="list-item" key={l.location_id}>
            <MapPin size={16} color="var(--danger)" />
            <div style={{ flex: 1 }}>
              <div className="cell-main">{l.location_name}</div>
              <div className="cell-sub">{fmtNumber(l.affected_population)} people · reported {fmtDate(l.reported_at, false)}</div>
            </div>
            <Badge value={l.impact_level} />
          </div>
        ))}
        {!data.locations.length && <p className="small muted">No affected locations recorded.</p>}
        {manager && (
          <form
            className="row"
            style={{ marginTop: 12, alignItems: "flex-end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!link.location_id || link.affected_population === "" || Number(link.affected_population) < 0) return toast("error", "Choose a location and a non-negative population");
              setBusy(true);
              try {
                await api("/api/operations?kind=disaster-locations", { body: { disaster_id: Number(id), location_id: Number(link.location_id), impact_level: link.impact_level, affected_population: Math.round(Number(link.affected_population)) } });
                toast("success", "Affected location saved");
                setLink({ location_id: "", impact_level: "HIGH", affected_population: "" });
                await reload();
                onChanged();
              } catch (e2) {
                toast("error", e2 instanceof Error ? e2.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field" style={{ flex: 2, minWidth: 160 }}>
              <label className="field-label" htmlFor="dl-loc">Add / update location</label>
              <select id="dl-loc" className="input" value={link.location_id} onChange={(e) => setLink({ ...link, location_id: e.target.value })}>
                <option value="">Select…</option>
                {locs?.map((l) => <option key={l.location_id} value={l.location_id}>{l.location_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 110 }}>
              <label className="field-label" htmlFor="dl-imp">Impact</label>
              <select id="dl-imp" className="input" value={link.impact_level} onChange={(e) => setLink({ ...link, impact_level: e.target.value })}>
                {["LOW", "MODERATE", "HIGH", "SEVERE"].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 110 }}>
              <label className="field-label" htmlFor="dl-pop">Population</label>
              <input id="dl-pop" className="input" type="number" min={0} step={1} value={link.affected_population} onChange={(e) => setLink({ ...link, affected_population: e.target.value })} />
            </div>
            <Button type="submit" loading={busy} icon={<Plus size={14} />}>Save</Button>
          </form>
        )}
      </Card>
      <Card title="Relief camps in affected areas" actions={<Link className="small" href="/manage/camps">All camps</Link>}>
        {data.camps.map((c) => (
          <div className="list-item" key={c.camp_id}>
            <Tent size={16} color="var(--teal)" />
            <div style={{ flex: 1 }}>
              <div className="cell-main">{c.camp_name}</div>
              <Meter value={c.current_population} max={c.capacity} tone={c.current_population >= c.capacity ? "danger" : "teal"} />
              <div className="cell-sub"><Users size={11} /> {fmtNumber(c.current_population)} / {fmtNumber(c.capacity)}</div>
            </div>
            <Badge value={c.status} />
          </div>
        ))}
        {!data.camps.length && <p className="small muted">No camps at the affected locations.</p>}
      </Card>
      <Card title="Resource requests" actions={<Link className="small" href="/requests">Requests queue</Link>}>
        {data.requests.map((r) => (
          <Link href={`/requests?id=${r.request_id}`} className="list-item" key={r.request_id} style={{ color: "inherit", textDecoration: "none" }}>
            <ClipboardList size={16} color="var(--primary)" />
            <div style={{ flex: 1 }}>
              <div className="cell-main">#{r.request_id} · {r.camp_name}</div>
              <div className="cell-sub">{fmtNumber(r.fulfillment_pct, 1)}% allocated · need by {fmtDate(r.need_by, false)}</div>
            </div>
            <Badge value={r.status} />
          </Link>
        ))}
        {!data.requests.length && <p className="small muted">No requests raised for this disaster.</p>}
      </Card>
    </div>
  );
}
