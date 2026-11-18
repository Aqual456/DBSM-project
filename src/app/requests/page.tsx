"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ClipboardList, Lightbulb, Plus, RefreshCw, Stethoscope, Trash2, Truck, X, PackageCheck, Clock, Ban, ArrowRight } from "lucide-react";
import { api, useApi, fmtDate, fmtNumber, fmtRelative, titleCase, toLocalInput } from "@/lib/client";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Meter, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/DataTable";
import { Modal, useConfirm, useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Item = { resource_id: string; resource_name: string; quantity_requested: string; quantity_allocated: string; quantity_remaining: string };
type Req = {
  request_id: string; camp_id: string; camp_name: string; disaster_name: string; status: string; priority_level: string; priority_score: string;
  medical_emergency: boolean; need_by: string; requested_at: string; remarks: string; fulfillment_pct: string; items: Item[] | null; requested_by_name: string;
};
type Detail = Req & {
  allocations: { allocation_id: string; status: string; allocated_at: string; allocated_by_name: string; items: { resource_name: string; unit: string; warehouse_name: string; quantity: string }[] }[];
  deliveries: { delivery_id: string; allocation_id: string; status: string; vehicle_number: string; driver_name: string; expected_arrival: string; actual_arrival: string | null }[];
  history: { changed_at: string; changed_fields: Record<string, { from: unknown; to: unknown }> | null; changed_by_name: string | null }[];
};
type Options = { camps: { camp_id: string; camp_name: string; capacity: number; current_population: number; location_name: string }[]; disasters: { disaster_id: string; disaster_name: string; severity: string }[]; resources: { resource_id: string; resource_name: string; unit: string; category_name: string }[] };

const PIPE = ["PENDING", "APPROVED", "ALLOCATED", "IN_TRANSIT", "DELIVERED"] as const;
function stage(status: string) {
  if (status === "PARTIALLY_FULFILLED") return 2;
  const i = PIPE.indexOf(status as (typeof PIPE)[number]);
  return i < 0 ? 0 : i;
}
function Pipeline({ status }: { status: string }) {
  const stopped = status === "REJECTED" || status === "CANCELLED";
  const at = stage(status);
  const labels = ["Requested", "Approved", status === "PARTIALLY_FULFILLED" ? "Partly allocated" : "Allocated", "In transit", "Delivered"];
  const icons = [<ClipboardList size={13} key="a" />, <Check size={13} key="b" />, <PackageCheck size={13} key="c" />, <Truck size={13} key="d" />, <Check size={13} key="e" />];
  return (
    <ol className="stepper" aria-label={`Request progress: ${titleCase(status)}`}>
      {labels.map((l, i) => {
        const cls = stopped ? (i === 0 ? "done" : i === 1 ? "stopped" : "") : i < at || (i === at && status === "DELIVERED") ? "done" : i === at ? "current" : "";
        return (
          <li key={l} className={`step ${cls}`} style={{ listStyle: "none" }} aria-current={cls === "current" ? "step" : undefined}>
            <div className="step-dot">{stopped && i === 1 ? <X size={13} /> : icons[i]}</div>
            {stopped && i === 1 ? titleCase(status) : l}
          </li>
        );
      })}
    </ol>
  );
}

export default function RequestsPage() {
  const me = useMe();
  const manager = isManager(me);
  const { data, error, loading, reload } = useApi<Req[]>("/api/requests");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("id");
    if (id && /^\d+$/.test(id)) setOpenId(id);
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Disaster operations"
        title="Resource Requests"
        lead="Field requests move through approval, allocation, dispatch and delivery. Stock, demand and permissions are enforced by the API and database at every step."
        actions={
          <>
            <Button icon={<RefreshCw size={15} />} onClick={reload} loading={loading && Boolean(data)}>
              Refresh
            </Button>
            {me && me.role_name !== "DRIVER" && (
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                New request
              </Button>
            )}
          </>
        }
      />
      <DataTable
        label="Resource requests"
        rows={data as unknown as Record<string, unknown>[] | null}
        loading={loading}
        error={error}
        onRetry={reload}
        rowKey={(r) => String(r.request_id)}
        onRowClick={(r) => setOpenId(String(r.request_id))}
        searchPlaceholder="Search camp, disaster, remarks…"
        filters={[
          { key: "status", label: "Statuses", options: ["PENDING", "APPROVED", "PARTIALLY_FULFILLED", "ALLOCATED", "IN_TRANSIT", "DELIVERED", "REJECTED", "CANCELLED"], value: (r) => r.status },
          { key: "priority", label: "Priorities", options: ["CRITICAL", "HIGH", "MEDIUM", "LOW"], value: (r) => r.priority_level },
        ]}
        columns={[
          { key: "request_id", header: "#", value: (r) => Number(r.request_id), render: (r) => <span className="cell-main">#{String(r.request_id)}</span> },
          {
            key: "camp_name",
            header: "Camp & disaster",
            render: (r) => (
              <div>
                <div className="cell-main row" style={{ gap: 6 }}>
                  {String(r.camp_name)} {r.medical_emergency ? <Stethoscope size={14} color="var(--danger)" aria-label="Medical emergency" /> : null}
                </div>
                <div className="cell-sub">{String(r.disaster_name)}</div>
              </div>
            ),
          },
          { key: "priority_level", header: "Priority", value: (r) => Number(r.priority_score), render: (r) => <span className="row" style={{ gap: 6 }}><Badge value={r.priority_level} /><span className="small muted num">{fmtNumber(r.priority_score)}</span></span> },
          { key: "items", header: "Items", sortable: false, value: (r) => ((r.items as Item[]) ?? []).map((i) => i.resource_name).join(" "), render: (r) => <span className="small">{((r.items as Item[]) ?? []).map((i) => i.resource_name).join(", ")}</span> },
          {
            key: "fulfillment_pct",
            header: "Allocated",
            value: (r) => Number(r.fulfillment_pct),
            render: (r) => (
              <div style={{ minWidth: 110 }}>
                <span className="small num">{fmtNumber(r.fulfillment_pct, 1)}%</span>
                <Meter value={Number(r.fulfillment_pct)} tone="teal" />
              </div>
            ),
          },
          { key: "need_by", header: "Need by", value: (r) => String(r.need_by), render: (r) => <span className="small">{fmtDate(r.need_by)}<div className="cell-sub">{fmtRelative(r.need_by)}</div></span> },
          { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
        ]}
        empty={<EmptyState title="No requests yet" text="Field officers raise requests for their camps." icon={<ClipboardList size={22} />} />}
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="New resource request" description="Requests start as PENDING until a coordinator approves them." size="wide">
        {creating && (
          <CreateRequest
            onDone={(id) => {
              setCreating(false);
              void reload();
              setOpenId(id);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </Modal>
      <Modal open={Boolean(openId)} onClose={() => setOpenId(null)} title={`Request #${openId ?? ""}`} drawer>
        {openId && <RequestDetail id={openId} manager={manager} onChanged={reload} />}
      </Modal>
    </>
  );
}

function CreateRequest({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { data: o, error: optErr } = useApi<Options>("/api/request-options");
  const toast = useToast();
  const [v, setV] = useState({ camp_id: "", disaster_id: "", need_by: toLocalInput(new Date(Date.now() + 2 * 86400000)), priority_level: "MEDIUM", priority_score: "50", medical_emergency: false, remarks: "" });
  const [items, setItems] = useState([{ resource_id: "", quantity: "" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (optErr) return <ErrorState message={optErr} />;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!v.camp_id || !v.disaster_id) return setError("Choose a camp and a disaster");
    const need = new Date(v.need_by);
    if (Number.isNaN(need.getTime()) || need.getTime() <= Date.now()) return setError("The required-by date must be in the future");
    if (items.some((i) => !i.resource_id || !(Number(i.quantity) > 0))) return setError("Every line needs a resource and a quantity greater than zero");
    if (new Set(items.map((i) => i.resource_id)).size !== items.length) return setError("Each resource can appear only once — combine the quantities");
    const score = Number(v.priority_score);
    if (!(score >= 0 && score <= 100)) return setError("Priority score must be between 0 and 100");
    setBusy(true);
    try {
      const r = await api<{ request_id: string }>("/api/requests", {
        body: {
          camp_id: Number(v.camp_id), disaster_id: Number(v.disaster_id), need_by: need.toISOString(), priority_level: v.priority_level, priority_score: score,
          medical_emergency: v.medical_emergency, remarks: v.remarks.trim(), items: items.map((i) => ({ resource_id: Number(i.resource_id), quantity_requested: Number(i.quantity) })),
        },
      });
      toast("success", `Request #${r.request_id} submitted`);
      onDone(String(r.request_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <div className="form-section">Where & why</div>
        <div className="field">
          <label className="field-label" htmlFor="rq-camp">Relief camp *</label>
          <select id="rq-camp" className="input" value={v.camp_id} onChange={(e) => setV({ ...v, camp_id: e.target.value })}>
            <option value="">{o ? "Select camp…" : "Loading…"}</option>
            {o?.camps.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name} — {c.current_population}/{c.capacity}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rq-dis">Disaster *</label>
          <select id="rq-dis" className="input" value={v.disaster_id} onChange={(e) => setV({ ...v, disaster_id: e.target.value })}>
            <option value="">{o ? "Select disaster…" : "Loading…"}</option>
            {o?.disasters.map((d) => <option key={d.disaster_id} value={d.disaster_id}>{d.disaster_name} ({titleCase(d.severity)})</option>)}
          </select>
        </div>
        <div className="form-section">Urgency</div>
        <div className="field">
          <label className="field-label" htmlFor="rq-need">Required by *</label>
          <input id="rq-need" className="input" type="datetime-local" value={v.need_by} onChange={(e) => setV({ ...v, need_by: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rq-pl">Priority</label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <select id="rq-pl" className="input" value={v.priority_level} onChange={(e) => setV({ ...v, priority_level: e.target.value })}>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </select>
            <input aria-label="Priority score (0–100)" className="input" type="number" min={0} max={100} style={{ width: 90 }} value={v.priority_score} onChange={(e) => setV({ ...v, priority_score: e.target.value })} />
          </div>
        </div>
        <label className="check full">
          <input type="checkbox" checked={v.medical_emergency} onChange={(e) => setV({ ...v, medical_emergency: e.target.checked })} /> Medical emergency
        </label>
        <div className="form-section">Items</div>
        {items.map((it, i) => {
          const unit = o?.resources.find((r) => r.resource_id === it.resource_id)?.unit;
          return (
            <div key={i} className="full row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 2 }}>
                <label className="field-label" htmlFor={`rq-r${i}`}>Resource {i + 1}</label>
                <select id={`rq-r${i}`} className="input" value={it.resource_id} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, resource_id: e.target.value } : x)))}>
                  <option value="">Select…</option>
                  {o?.resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_name} · {titleCase(r.category_name)}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label" htmlFor={`rq-q${i}`}>Quantity{unit ? ` (${unit})` : ""}</label>
                <input id={`rq-q${i}`} className="input" type="number" min={0.001} step="0.001" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              </div>
              <Button type="button" variant="ghost" iconOnly aria-label={`Remove line ${i + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} icon={<Trash2 size={15} />} />
            </div>
          );
        })}
        <div className="full">
          <Button type="button" size="sm" icon={<Plus size={14} />} onClick={() => setItems([...items, { resource_id: "", quantity: "" }])}>
            Add item
          </Button>
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="rq-rem">Situation notes</label>
          <textarea id="rq-rem" className="input" maxLength={5000} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} placeholder="What is happening and why these items are needed" />
        </div>
      </div>
      {error && <div style={{ marginTop: 14 }}><Alert kind="error">{error}</Alert></div>}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Submit request</Button>
      </div>
    </form>
  );
}

type Rec = {
  request: { camp_name: string; location_name: string };
  lines: { resource_id: number; resource_name: string; unit: string; requested: number; remaining: number; status: string; candidates: { warehouse_id: number; warehouse_name: string; location_name: string; location_id: number; available: number; suggested_quantity: number; score: number; reasons: string[]; full: boolean }[] }[];
  bestSingleSource: { location_id: number; location_name: string; lines: { resource_id: number; warehouse_id: number; quantity: number }[]; distance: number | null } | null;
  note: string;
};

function RequestDetail({ id, manager, onChanged }: { id: string; manager: boolean; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/api/requests?id=${id}`, [id]);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || loading) return <SkeletonRows rows={10} />;
  const refresh = async () => {
    await reload();
    onChanged();
  };
  const setStatus = async (status: string) => {
    const words: Record<string, string> = { APPROVED: "Approve", REJECTED: "Reject", CANCELLED: "Cancel" };
    if (!(await confirm({ title: `${words[status]} request #${id}?`, text: status === "APPROVED" ? "Approved requests can receive allocations." : "This closes the request without supplying it.", danger: status !== "APPROVED", confirmLabel: words[status] }))) return;
    setBusy(true);
    try {
      await api("/api/requests", { method: "PATCH", body: { request_id: Number(id), status } });
      toast("success", `Request #${id} ${titleCase(status).toLowerCase()}`);
      await refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };
  const open = ["APPROVED", "PARTIALLY_FULFILLED"].includes(data.status);
  return (
    <div className="stack">
      <Pipeline status={data.status} />
      <div className="row">
        <Badge value={data.status} />
        <Badge value={data.priority_level} label={`${titleCase(data.priority_level)} · ${fmtNumber(data.priority_score)}`} />
        {data.medical_emergency && <Badge value="CRITICAL" label="Medical emergency" />}
      </div>
      <dl className="kv">
        <dt>Camp</dt>
        <dd>{data.camp_name}</dd>
        <dt>Disaster</dt>
        <dd>{data.disaster_name}</dd>
        <dt>Raised</dt>
        <dd>{fmtDate(data.requested_at)} by {data.requested_by_name}</dd>
        <dt>Required by</dt>
        <dd>{fmtDate(data.need_by)} ({fmtRelative(data.need_by)})</dd>
        {data.remarks && (
          <>
            <dt>Notes</dt>
            <dd>{data.remarks}</dd>
          </>
        )}
      </dl>
      {manager && (data.status === "PENDING" || data.status === "APPROVED") && (
        <div className="row">
          {data.status === "PENDING" && (
            <>
              <Button variant="primary" icon={<Check size={15} />} loading={busy} onClick={() => setStatus("APPROVED")}>Approve</Button>
              <Button variant="danger" icon={<X size={15} />} disabled={busy} onClick={() => setStatus("REJECTED")}>Reject</Button>
            </>
          )}
          <Button variant="ghost" icon={<Ban size={15} />} disabled={busy} onClick={() => setStatus("CANCELLED")}>Cancel request</Button>
        </div>
      )}
      <Card title="Items & fulfilment" subtitle={`${fmtNumber(data.fulfillment_pct, 1)}% of requested quantity allocated`} pad>
        {(data.items ?? []).map((i) => {
          const req = Number(i.quantity_requested), alloc = Number(i.quantity_allocated);
          return (
            <div key={i.resource_id} style={{ marginBottom: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="cell-main small">{i.resource_name}</span>
                <span className="small num muted">{fmtNumber(alloc, 3)} / {fmtNumber(req, 3)} · {fmtNumber(i.quantity_remaining, 3)} outstanding</span>
              </div>
              <Meter value={alloc} max={req} tone="teal" />
            </div>
          );
        })}
        {manager && open && (
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" icon={<Lightbulb size={15} />} onClick={() => setPlanning(true)}>Plan allocation</Button>
          </div>
        )}
      </Card>
      <Card title="Allocations" subtitle="Stock committed to this request">
        {!data.allocations.length ? (
          <p className="muted small">{open ? "No allocations yet." : data.status === "PENDING" ? "Approve the request to allocate stock." : "None."}</p>
        ) : (
          data.allocations.map((a) => (
            <div className="list-item" key={a.allocation_id} style={{ alignItems: "flex-start" }}>
              <PackageCheck size={16} color="var(--violet)" style={{ marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="cell-main">Allocation #{a.allocation_id}</span>
                  <Badge value={a.status} />
                </div>
                {a.items.map((x, n) => (
                  <div className="cell-sub" key={n}>{fmtNumber(x.quantity, 3)} {x.unit} {x.resource_name} from {x.warehouse_name}</div>
                ))}
                <div className="cell-sub">{a.allocated_by_name} · {fmtRelative(a.allocated_at)}</div>
              </div>
            </div>
          ))
        )}
        {data.allocations.some((a) => a.status === "ALLOCATED") && manager && (
          <Link href="/manage/allocations" className="btn sm" style={{ marginTop: 10 }}>Plan deliveries <ArrowRight size={13} /></Link>
        )}
      </Card>
      <Card title="Deliveries">
        {!data.deliveries.length ? (
          <p className="muted small">No deliveries planned.</p>
        ) : (
          data.deliveries.map((d) => (
            <div className="list-item" key={d.delivery_id}>
              <Truck size={16} color="var(--primary)" />
              <div style={{ flex: 1 }}>
                <div className="cell-main">Delivery #{d.delivery_id} · {d.vehicle_number}</div>
                <div className="cell-sub">{d.driver_name} · {d.actual_arrival ? `arrived ${fmtDate(d.actual_arrival)}` : `ETA ${fmtDate(d.expected_arrival)}`}</div>
              </div>
              <Badge value={d.status} />
            </div>
          ))
        )}
      </Card>
      <Card title="Status history" subtitle="From the row-level change log trigger">
        {!data.history.length ? (
          <p className="muted small">No recorded changes.</p>
        ) : (
          <div className="timeline">
            {data.history.map((h, i) => (
              <div className="tl-item" key={i}>
                <div className="small cell-main">
                  {h.changed_fields?.status ? `${titleCase(h.changed_fields.status.from)} → ${titleCase(h.changed_fields.status.to)}` : h.changed_fields ? Object.keys(h.changed_fields).join(", ") + " changed" : "Created"}
                </div>
                <div className="cell-sub"><Clock size={11} /> {fmtDate(h.changed_at)} · {h.changed_by_name ?? "system"}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal open={planning} onClose={() => setPlanning(false)} title={`Plan allocation for request #${id}`} description="Recommendations are explained and editable. Nothing is allocated until you submit." size="wide">
        {planning && <AllocationPlanner id={id} onDone={async () => { setPlanning(false); await refresh(); }} />}
      </Modal>
    </div>
  );
}

function AllocationPlanner({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, error } = useApi<Rec>(`/api/intelligence?requestId=${id}`, [id]);
  const toast = useToast();
  const [pick, setPick] = useState<Record<number, { warehouse_id: number; quantity: string }>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data?.bestSingleSource) return;
    setPick(Object.fromEntries(data.bestSingleSource.lines.map((l) => [l.resource_id, { warehouse_id: l.warehouse_id, quantity: String(l.quantity) }])));
  }, [data]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <SkeletonRows rows={8} />;
  async function submit() {
    setErr("");
    const items = Object.entries(pick)
      .filter(([, p]) => p.warehouse_id && Number(p.quantity) > 0)
      .map(([rid, p]) => ({ resource_id: Number(rid), warehouse_id: p.warehouse_id, quantity_allocated: Number(p.quantity) }));
    if (!items.length) return setErr("Select at least one line with a quantity");
    setBusy(true);
    try {
      const a = await api<{ allocation_id: string }>("/api/operations?kind=allocations", { body: { request_id: Number(id), items } });
      toast("success", `Allocation #${a.allocation_id} created — stock deducted atomically`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Allocation failed");
    } finally {
      setBusy(false);
    }
  }
  const open = data.lines.filter((l) => l.remaining > 0);
  return (
    <div className="stack">
      {data.bestSingleSource && (
        <Alert kind="info">
          <Lightbulb size={16} />
          <span>
            Suggested single pickup point: <b>{data.bestSingleSource.location_name}</b>
            {data.bestSingleSource.distance != null ? ` (${data.bestSingleSource.distance} km from ${data.request.camp_name})` : ""} — it can supply {data.bestSingleSource.lines.length} of {open.length} open line(s). One delivery needs one pickup location. {data.note}
          </span>
        </Alert>
      )}
      {!open.length && <EmptyState title="Fully allocated" text="Every line already has stock committed." />}
      {open.map((l) => {
        const p = pick[l.resource_id];
        return (
          <div className="card card-pad" key={l.resource_id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="cell-main">{l.resource_name}</div>
                <div className="cell-sub">{fmtNumber(l.remaining, 3)} {l.unit} outstanding of {fmtNumber(l.requested, 3)}</div>
              </div>
              <Badge value={l.status} label={l.status === "NO_STOCK" ? "No stock anywhere" : `${l.candidates.length} option(s)`} />
            </div>
            {l.candidates.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="data compact">
                  <thead>
                    <tr><th>Use</th><th>Warehouse</th><th className="num">Available</th><th>Why</th><th className="num">Score</th></tr>
                  </thead>
                  <tbody>
                    {l.candidates.map((c) => (
                      <tr key={c.warehouse_id}>
                        <td>
                          <input type="radio" name={`w-${l.resource_id}`} aria-label={`Use ${c.warehouse_name}`} checked={p?.warehouse_id === c.warehouse_id} onChange={() => setPick({ ...pick, [l.resource_id]: { warehouse_id: c.warehouse_id, quantity: String(c.suggested_quantity) } })} />
                        </td>
                        <td>
                          <div className="cell-main small">{c.warehouse_name}</div>
                          <div className="cell-sub">{c.location_name}</div>
                        </td>
                        <td className="num">{fmtNumber(c.available, 3)}</td>
                        <td className="small muted">{c.reasons.join(" · ")}</td>
                        <td className="num">{c.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {p && (
              <div className="row" style={{ marginTop: 10 }}>
                <label className="small field-label" htmlFor={`q-${l.resource_id}`}>Quantity to allocate</label>
                <input id={`q-${l.resource_id}`} className="input" style={{ width: 140 }} type="number" min={0.001} step="0.001" value={p.quantity} onChange={(e) => setPick({ ...pick, [l.resource_id]: { ...p, quantity: e.target.value } })} />
                <Button size="sm" variant="ghost" onClick={() => { const n = { ...pick }; delete n[l.resource_id]; setPick(n); }}>Skip line</Button>
              </div>
            )}
          </div>
        );
      })}
      {err && <Alert kind="error">{err}</Alert>}
      {open.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button variant="primary" icon={<PackageCheck size={15} />} loading={busy} onClick={submit}>Allocate selected</Button>
        </div>
      )}
    </div>
  );
}
