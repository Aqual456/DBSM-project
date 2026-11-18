"use client";
import Link from "next/link";
import { Activity, AlertTriangle, Boxes, ClipboardList, PackageCheck, RefreshCw, Siren, Tent, Truck, Users, Zap } from "lucide-react";
import { useApi, fmtNumber, fmtRelative, titleCase } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorState, Kpi, PageHeader, Skeleton } from "@/components/ui/primitives";
import { DemandSupplyChart, Legend, SERIES, SeverityChart, TrendChart } from "@/components/charts/Charts";

type Dash = {
  kpi: Record<string, number>;
  stockByUnit: { unit: string; available: number }[];
  severity: { severity: string; count: number }[];
  demand: { resource_name: string; unit: string; demand: number; available: number }[];
  stockTrend: { day: string; inflow: number; outflow: number }[];
  requestTrend: { day: string; requested: number; allocated: number; delivered: number }[];
  deliveryStatus: { status: string; count: number }[];
  campLoad: { camp_name: string; capacity: number; current_population: number }[];
  incidents: { _id: string; description: string; severity: string; reportType: string; location?: { label?: string }; createdAt: string; status?: string }[] | null;
  activity: { audit_id: string; created_at: string; action: string; user_name: string }[];
  cache: { hit: boolean; loadMs: number };
  generatedAt: string;
};

export default function CommandCenter() {
  const { data, error, loading, reload } = useApi<Dash>("/api/dashboard");
  const k = data?.kpi;
  const shortages = data?.demand.filter((d) => d.demand > d.available) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Disaster Response Command Center"
        lead="Live operational picture across disasters, shelters, stock and logistics. All figures are computed from PostgreSQL and MongoDB."
        actions={
          <>
            {data && (
              <span className="small muted" title="Dashboard metrics are cached in the key-value store for 30 s and invalidated on every write">
                {data.cache.hit ? "Served from cache" : "Fresh from database"} · {data.cache.loadMs} ms · updated {fmtRelative(data.generatedAt)}
              </span>
            )}
            <Button icon={<RefreshCw size={15} />} onClick={reload} loading={loading}>
              Refresh
            </Button>
            <Link href="/requests" className="btn primary">
              <ClipboardList size={15} /> Requests queue
            </Link>
          </>
        }
      />
      {error && !data ? (
        <div className="card">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : (
        <div className="stack">
          <div className="grid g-4">
            {!k ? (
              Array.from({ length: 8 }, (_, i) => (
                <div className="card kpi" key={i}>
                  <Skeleton h={12} w="50%" />
                  <Skeleton h={28} w="40%" style={{ marginTop: 14 }} />
                </div>
              ))
            ) : (
              <>
                <Kpi label="Active disasters" value={fmtNumber(k.active_disasters)} icon={<Siren size={16} />} iconTone="danger" foot={`${data.severity.find((s) => s.severity === "CRITICAL")?.count ?? 0} critical`} />
                <Kpi label="Affected population" value={fmtNumber(k.affected_population)} icon={<Users size={16} />} iconTone="violet" foot="across affected locations" delay={0.03} />
                <Kpi
                  label="Relief camps open"
                  value={fmtNumber(k.active_camps)}
                  icon={<Tent size={16} />}
                  iconTone="teal"
                  foot={`${fmtNumber(k.sheltered_population)} of ${fmtNumber(k.shelter_capacity)} beds used`}
                  meter={{ value: k.sheltered_population, max: k.shelter_capacity, tone: k.sheltered_population / (k.shelter_capacity || 1) > 0.9 ? "danger" : "teal" }}
                  delay={0.06}
                />
                <Kpi label="Stocked lines" value={fmtNumber(k.stocked_lines)} icon={<Boxes size={16} />} foot={`${k.low_stock_lines} at or below threshold`} iconTone={k.low_stock_lines ? "warn" : undefined} delay={0.09} />
                <Kpi label="Pending requests" value={fmtNumber(k.pending_requests)} icon={<ClipboardList size={16} />} iconTone="warn" foot={`${k.approved_open_requests} approved & awaiting stock`} delay={0.12} />
                <Kpi label="Active allocations" value={fmtNumber(k.allocations)} icon={<PackageCheck size={16} />} foot="non-cancelled allocations" delay={0.15} />
                <Kpi label="Deliveries on the road" value={fmtNumber(k.active_deliveries)} icon={<Truck size={16} />} iconTone="violet" foot={`${k.completed_deliveries} completed`} delay={0.18} />
                <Kpi
                  label="Delivery completion"
                  value={`${k.delivery_completion_pct}%`}
                  icon={<Activity size={16} />}
                  iconTone="teal"
                  foot={`${k.completed_deliveries} of ${k.total_deliveries} non-cancelled`}
                  meter={{ value: k.delivery_completion_pct, tone: "teal" }}
                  delay={0.21}
                />
              </>
            )}
          </div>

          <div className="grid g-main">
            <Card
              title="Demand vs availability"
              subtitle="Outstanding demand on open requests compared with stock in active warehouses (each resource in its own unit)"
              actions={<Legend items={[{ label: "Outstanding demand", color: SERIES[1] }, { label: "Available stock", color: SERIES[0] }]} />}
            >
              {data ? data.demand.length ? <DemandSupplyChart data={data.demand} /> : <EmptyState title="No resources yet" /> : <Skeleton h={280} />}
            </Card>
            <div className="stack">
              <Card title="Open disasters by severity">{data ? <SeverityChart data={data.severity} /> : <Skeleton h={200} />}</Card>
              <Card title="Critical shortages" subtitle="Demand exceeds stock in every active warehouse combined">
                {!data ? (
                  <Skeleton h={90} />
                ) : shortages.length === 0 ? (
                  <p className="muted small">No resource is in shortage right now.</p>
                ) : (
                  shortages.map((s) => (
                    <div className="list-item" key={s.resource_name}>
                      <AlertTriangle size={16} color="var(--danger)" aria-hidden />
                      <div style={{ flex: 1 }}>
                        <div className="cell-main">{s.resource_name}</div>
                        <div className="cell-sub">
                          short by {fmtNumber(s.demand - s.available)} {s.unit}
                        </div>
                      </div>
                      <Badge value="SHORTAGE" />
                    </div>
                  ))
                )}
              </Card>
            </div>
          </div>

          <div className="grid g-2">
            <Card title="Request fulfilment trend" subtitle="Last 14 days: requests raised, requests receiving allocations, deliveries completed" actions={<Legend items={[{ label: "Requested", color: SERIES[0] }, { label: "Allocated", color: SERIES[1] }, { label: "Delivered", color: SERIES[2] }]} />}>
              {data ? <TrendChart data={data.requestTrend} label="Request fulfilment trend" series={[{ key: "requested", name: "Requested" }, { key: "allocated", name: "Allocated" }, { key: "delivered", name: "Delivered" }]} /> : <Skeleton h={260} />}
            </Card>
            <Card title="Inventory movements" subtitle="Units received vs dispatched per day (all resources, from inventory_movements)" actions={<Legend items={[{ label: "Inflow", color: SERIES[0] }, { label: "Outflow", color: SERIES[1] }]} />}>
              {data ? <TrendChart data={data.stockTrend} label="Inventory inflow and outflow" series={[{ key: "inflow", name: "Inflow" }, { key: "outflow", name: "Outflow" }]} /> : <Skeleton h={260} />}
            </Card>
          </div>

          <div className="grid g-3">
            <Card title="Delivery status" subtitle="All deliveries by current state">
              {!data ? (
                <Skeleton h={140} />
              ) : !data.deliveryStatus.length ? (
                <p className="muted small">No deliveries yet.</p>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {data.deliveryStatus.map((d) => {
                    const total = data.deliveryStatus.reduce((s, x) => s + x.count, 0);
                    return (
                      <div key={d.status}>
                        <div className="row" style={{ justifyContent: "space-between" }}>
                          <Badge value={d.status} />
                          <span className="num small">
                            {d.count} · {Math.round((100 * d.count) / total)}%
                          </span>
                        </div>
                        <div className="meter">
                          <span style={{ width: `${(100 * d.count) / total}%`, background: d.status === "DELIVERED" ? "var(--success)" : d.status === "CANCELLED" ? "var(--subtle)" : "var(--violet)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card title="Recent incidents" subtitle="Latest field reports (MongoDB)" actions={<Link href="/incidents" className="small">View all</Link>}>
              {!data ? (
                <Skeleton h={140} />
              ) : data.incidents === null ? (
                <p className="muted small">MongoDB is unavailable — incident feed paused.</p>
              ) : !data.incidents.length ? (
                <p className="muted small">No incidents reported.</p>
              ) : (
                data.incidents.slice(0, 5).map((i) => (
                  <div className="list-item" key={i._id}>
                    <Badge value={i.severity} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-main" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.description}</div>
                      <div className="cell-sub">
                        {titleCase(i.reportType)} · {i.location?.label} · {fmtRelative(i.createdAt)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </Card>
            <Card title="Recent activity" subtitle="Audited actions" actions={<Link href="/manage/audit" className="small">Audit log</Link>}>
              {!data ? (
                <Skeleton h={140} />
              ) : !data.activity.length ? (
                <p className="muted small">Activity is visible to administrators and coordinators.</p>
              ) : (
                <div className="timeline">
                  {data.activity.slice(0, 6).map((a) => (
                    <div className="tl-item" key={a.audit_id}>
                      <div className="cell-main small">{titleCase(a.action)}</div>
                      <div className="cell-sub">
                        {a.user_name ?? "System"} · {fmtRelative(a.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="Shelter load" subtitle="Most occupied open camps" actions={<Link href="/manage/camps" className="small">All camps</Link>}>
            {!data ? (
              <Skeleton h={120} />
            ) : (
              <div className="grid g-4">
                {data.campLoad.map((c) => {
                  const pct = (100 * c.current_population) / c.capacity;
                  return (
                    <div key={c.camp_name}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="cell-main small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{c.camp_name}</span>
                        <span className="num small">{Math.round(pct)}%</span>
                      </div>
                      <div className={`meter ${pct >= 100 ? "danger" : pct > 85 ? "warn" : "teal"}`}>
                        <span style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <div className="cell-sub">
                        {fmtNumber(c.current_population)} / {fmtNumber(c.capacity)} people
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          {data && (
            <p className="small muted row" style={{ gap: 6 }}>
              <Zap size={13} /> Stock totals by unit:{" "}
              {data.stockByUnit.map((u) => `${fmtNumber(u.available)} ${u.unit}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </>
  );
}
