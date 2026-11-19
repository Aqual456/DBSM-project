"use client";
import { useState } from "react";
import { FileWarning, MessageSquarePlus, Plus, RefreshCw, Search, Sparkles, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { api, useApi, fmtDate, fmtRelative, titleCase } from "@/lib/client";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { Modal, useConfirm, useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Incident = {
  _id: string; disasterId: number; disasterName: string | null; reportType: string; severity: string; status: string; description: string;
  location: { label: string; latitude?: number; longitude?: number }; tags: string[]; reporterName?: string; createdAt: string; score?: number;
  updates?: { note: string; byName?: string; at: string }[];
};
type List = { items: Incident[]; total: number; page: number; pageSize: number; search: string | null };
type Facets = { bySeverity: { _id: string; count: number }[]; byType: { _id: string; count: number }[]; topTags: { _id: string; count: number }[]; total: { n: number }[] };

export default function IncidentsPage() {
  const [q, setQ] = useState("");
  const [f, setF] = useState({ q: "", severity: "", reportType: "", status: "", page: 1 });
  const params = new URLSearchParams(Object.entries({ q: f.q, severity: f.severity, reportType: f.reportType, status: f.status, page: String(f.page) }).filter(([, v]) => v));
  const { data, error, loading, reload } = useApi<List>(`/api/incidents?${params}`, [params.toString()]);
  const facetParams = new URLSearchParams(params);
  facetParams.delete("page");
  facetParams.set("stats", "1");
  const { data: facets } = useApi<Facets>(`/api/incidents?${facetParams}`, [facetParams.toString()]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Incident | null>(null);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="Disaster operations · MongoDB"
        title="Incident Reports"
        lead="Flexible field reports stored as documents (embedded location and update history, references to PostgreSQL disasters). Search uses MongoDB's weighted text index."
        actions={
          <>
            <Link href="/lab/vector" className="btn"><Sparkles size={15} /> Similarity search</Link>
            <Button icon={<RefreshCw size={15} />} onClick={reload}>Refresh</Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>Report incident</Button>
          </>
        }
      />
      <div className="grid g-main">
        <div className="stack">
          <div className="card" style={{ overflow: "hidden" }}>
            <form
              className="table-tools"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setF({ ...f, q: q.trim(), page: 1 });
              }}
            >
              <div className="search" style={{ flex: 1 }}>
                <Search size={15} aria-hidden />
                <input className="input" type="search" placeholder="Text search: water contamination, road closure…" aria-label="Search incident text" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {(["severity", "reportType", "status"] as const).map((k) => (
                <select key={k} className="input" style={{ width: "auto" }} aria-label={`Filter by ${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value, page: 1 })}>
                  <option value="">{k === "reportType" ? "All types" : k === "severity" ? "All severities" : "All statuses"}</option>
                  {(k === "severity" ? ["CRITICAL", "HIGH", "MODERATE", "LOW"] : k === "reportType" ? ["DAMAGE", "MEDICAL", "SUPPLY", "SAFETY", "GENERAL"] : ["OPEN", "MONITORING", "RESOLVED"]).map((o) => (
                    <option key={o} value={o}>{titleCase(o)}</option>
                  ))}
                </select>
              ))}
              <Button type="submit">Search</Button>
            </form>
            {error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : !data || loading ? (
              <SkeletonRows rows={8} />
            ) : !data.items.length ? (
              <EmptyState title="No incidents match" text="Change the search or filters." icon={<FileWarning size={22} />} />
            ) : (
              <>
                {data.search && <p className="small muted" style={{ padding: "10px 16px 0" }}>Ranked by MongoDB textScore (description × 5, tags × 3, location × 1)</p>}
                <div>
                  {data.items.map((i) => (
                    <button key={i._id} className="list-item" style={{ width: "100%", textAlign: "left", background: "none", border: 0, borderBottom: "1px solid var(--border)", padding: "14px 16px", cursor: "pointer", font: "inherit", alignItems: "flex-start" }} onClick={() => setOpen(i)}>
                      <Badge value={i.severity} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontWeight: 560 }}>{i.description}</div>
                        <div className="cell-sub" style={{ marginTop: 3 }}>
                          {titleCase(i.reportType)} · {i.location?.label} · {i.disasterName ?? `Disaster #${i.disasterId}`} · {fmtRelative(i.createdAt)}
                          {i.score != null && ` · score ${i.score.toFixed(2)}`}
                        </div>
                        {i.tags?.length > 0 && (
                          <div className="chip-row" style={{ marginTop: 6 }}>
                            {i.tags.map((t) => <span key={t} className="badge plain gray">#{t}</span>)}
                          </div>
                        )}
                      </div>
                      <Badge value={i.status} />
                    </button>
                  ))}
                </div>
                <div className="pager">
                  <span>{data.total} reports</span>
                  <div className="row">
                    <Button size="sm" iconOnly aria-label="Previous page" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })} icon={<ChevronLeft size={14} />} />
                    <span>Page {f.page} of {pages}</span>
                    <Button size="sm" iconOnly aria-label="Next page" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })} icon={<ChevronRight size={14} />} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="stack">
          <Card title="Aggregation facets" subtitle="One $facet pipeline over the current filter">
            {!facets ? (
              <SkeletonRows rows={5} />
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                <div>
                  <div className="field-label" style={{ marginBottom: 6 }}>By severity</div>
                  <div className="chip-row">{["CRITICAL", "HIGH", "MODERATE", "LOW"].map((s) => <Badge key={s} value={s} label={`${titleCase(s)} · ${facets.bySeverity.find((x) => x._id === s)?.count ?? 0}`} />)}</div>
                </div>
                <div>
                  <div className="field-label" style={{ marginBottom: 6 }}>By type</div>
                  {facets.byType.sort((a, b) => b.count - a.count).map((t) => (
                    <div key={t._id} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="small">{titleCase(t._id)}</span>
                      <span className="small num">{t.count}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="field-label" style={{ marginBottom: 6 }}>Top tags ($unwind → $group)</div>
                  <div className="chip-row">
                    {facets.topTags.map((t) => (
                      <button key={t._id} className="chip" onClick={() => { setQ(t._id); setF({ ...f, q: t._id, page: 1 }); }}>
                        #{t._id} <span className="muted">{t.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Report an incident" description="Stored in MongoDB; the disaster reference is validated against PostgreSQL first.">
        {creating && <CreateIncident onDone={() => { setCreating(false); void reload(); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Incident report" drawer>
        {open && <IncidentDetail incident={open} onChanged={(i) => { setOpen(i); void reload(); }} onDeleted={() => { setOpen(null); void reload(); }} />}
      </Modal>
    </>
  );
}

function CreateIncident({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { data: opts } = useApi<{ disasters: { disaster_id: string; disaster_name: string }[] }>("/api/request-options");
  const toast = useToast();
  const [v, setV] = useState({ disasterId: "", reportType: "DAMAGE", severity: "HIGH", description: "", label: "", latitude: "", longitude: "", tags: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        if (!v.disasterId) return setErr("Choose the related disaster");
        if (v.description.trim().length < 10) return setErr("Describe the incident in at least 10 characters");
        if (v.label.trim().length < 2) return setErr("Enter where it happened");
        if ((v.latitude === "") !== (v.longitude === "")) return setErr("Provide both coordinates or neither");
        setBusy(true);
        try {
          await api("/api/incidents", {
            body: {
              disasterId: Number(v.disasterId), reportType: v.reportType, severity: v.severity, description: v.description.trim(),
              location: { label: v.label.trim(), ...(v.latitude !== "" ? { latitude: Number(v.latitude), longitude: Number(v.longitude) } : {}) },
              tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
            },
          });
          toast("success", "Incident reported");
          onDone();
        } catch (e2) {
          setErr(e2 instanceof Error ? e2.message : "Save failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <div className="field full">
          <label className="field-label" htmlFor="i-d">Disaster *</label>
          <select id="i-d" className="input" value={v.disasterId} onChange={(e) => setV({ ...v, disasterId: e.target.value })}>
            <option value="">Select…</option>
            {opts?.disasters.map((d) => <option key={d.disaster_id} value={d.disaster_id}>{d.disaster_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="i-t">Type</label>
          <select id="i-t" className="input" value={v.reportType} onChange={(e) => setV({ ...v, reportType: e.target.value })}>{["DAMAGE", "MEDICAL", "SUPPLY", "SAFETY", "GENERAL"].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="i-s">Severity</label>
          <select id="i-s" className="input" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>{["LOW", "MODERATE", "HIGH", "CRITICAL"].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select>
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="i-desc">What happened? *</label>
          <textarea id="i-desc" className="input" maxLength={10000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="i-l">Location label *</label>
          <input id="i-l" className="input" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Ward 4 near the river bridge" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="i-lat">Latitude</label>
          <input id="i-lat" className="input" type="number" step="any" min={-90} max={90} value={v.latitude} onChange={(e) => setV({ ...v, latitude: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="i-lon">Longitude</label>
          <input id="i-lon" className="input" type="number" step="any" min={-180} max={180} value={v.longitude} onChange={(e) => setV({ ...v, longitude: e.target.value })} />
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="i-tags">Tags</label>
          <input id="i-tags" className="input" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="comma separated: water, children" />
        </div>
      </div>
      {err && <div style={{ marginTop: 14 }}><Alert kind="error">{err}</Alert></div>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Submit report</Button>
      </div>
    </form>
  );
}

function IncidentDetail({ incident, onChanged, onDeleted }: { incident: Incident; onChanged: (i: Incident) => void; onDeleted: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useMe();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      const r = await api<Incident>("/api/incidents", { method: "PATCH", body: { id: incident._id, ...body } });
      toast("success", msg);
      onChanged({ ...incident, ...r, disasterName: incident.disasterName });
      setNote("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="row">
        <Badge value={incident.severity} />
        <Badge value={incident.status ?? "OPEN"} />
        <span className="small muted">{titleCase(incident.reportType)}</span>
      </div>
      <p style={{ fontSize: 15 }}>{incident.description}</p>
      <dl className="kv">
        <dt>Disaster</dt><dd>{incident.disasterName ?? `#${incident.disasterId}`}</dd>
        <dt>Location</dt><dd>{incident.location?.label}{incident.location?.latitude != null ? ` (${incident.location.latitude}, ${incident.location.longitude})` : ""}</dd>
        <dt>Reported</dt><dd>{fmtDate(incident.createdAt)}{incident.reporterName ? ` by ${incident.reporterName}` : ""}</dd>
        <dt>Document id</dt><dd><code>{incident._id}</code></dd>
      </dl>
      <div className="row">
        <span className="field-label">Set status:</span>
        {["OPEN", "MONITORING", "RESOLVED"].map((s) => (
          <Button key={s} size="sm" variant={incident.status === s ? "primary" : "default"} disabled={busy || incident.status === s} onClick={() => patch({ status: s }, `Marked ${titleCase(s).toLowerCase()}`)}>{titleCase(s)}</Button>
        ))}
      </div>
      <Card title="Field updates" subtitle="Embedded array — appended with $push in a single atomic document update">
        {(incident.updates ?? []).length ? (
          <div className="timeline">
            {incident.updates!.map((u, i) => (
              <div className="tl-item" key={i}>
                <div className="small">{u.note}</div>
                <div className="cell-sub">{u.byName ?? "Unknown"} · {fmtDate(u.at)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No updates yet.</p>
        )}
        <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) void patch({ note: note.trim() }, "Update added"); }}>
          <input className="input" style={{ flex: 1 }} aria-label="New field update" placeholder="Add a field update…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <Button type="submit" icon={<MessageSquarePlus size={14} />} disabled={note.trim().length < 3} loading={busy}>Add</Button>
        </form>
      </Card>
      {isManager(me) && (
        <div>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            disabled={busy}
            onClick={async () => {
              if (!(await confirm({ title: "Delete this incident report?", text: "The MongoDB document is removed permanently (deleteOne). This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
              try {
                await api(`/api/incidents?id=${incident._id}`, { method: "DELETE" });
                toast("success", "Incident deleted");
                onDeleted();
              } catch (e) {
                toast("error", e instanceof Error ? e.message : "Delete failed");
              }
            }}
          >
            Delete report
          </Button>
        </div>
      )}
      <details>
        <summary className="small muted" style={{ cursor: "pointer" }}>Raw document</summary>
        <pre className="code" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{JSON.stringify(incident, null, 2)}</pre>
      </details>
    </div>
  );
}
