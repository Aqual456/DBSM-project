"use client";
import Link from "next/link";
import { AlertTriangle, ArrowRight, PackagePlus, RefreshCw, Stethoscope } from "lucide-react";
import { useApi, fmtNumber, titleCase } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorState, Meter, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { RankBars, SERIES } from "@/components/charts/Charts";

type Intel = {
  shortages: { resource_name: string; unit: string; category_name: string; outstanding_demand: string; available_stock: string; net_position: string }[];
  excess: { warehouse_name: string; location_name: string; resource_name: string; unit: string; available: number; threshold: number; times_threshold: number | null }[];
  priority: { request_id: string; priority_level: string; priority_score: string; medical_emergency: boolean; status: string; need_by: string; camp_name: string; disaster_name: string; fulfillment_pct: number; hours_left: number }[];
  byLocation: { location_name: string; category_name: string; units: number }[];
  coverage: { disaster_name: string; severity: string; requested: number; allocated: number }[];
};

export default function IntelligencePage() {
  const { data, error, reload, loading } = useApi<Intel>("/api/intelligence");
  const cats = data ? [...new Set(data.byLocation.map((x) => x.category_name))].sort() : [];
  const locs = data ? [...new Set(data.byLocation.map((x) => x.location_name))].sort() : [];
  const max = data ? Math.max(1, ...data.byLocation.map((x) => x.units)) : 1;
  const short = data?.shortages.filter((s) => Number(s.net_position) < 0) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Resource Demand Intelligence"
        lead="Where demand outruns supply, where stock is idle, and which requests need attention first — all computed with SQL views, CTEs and aggregates."
        actions={<Button icon={<RefreshCw size={15} />} onClick={reload} loading={loading && Boolean(data)}>Refresh</Button>}
      />
      {error ? (
        <div className="card"><ErrorState message={error} onRetry={reload} /></div>
      ) : !data ? (
        <div className="card"><SkeletonRows rows={10} /></div>
      ) : (
        <div className="stack">
          <div className="grid g-2">
            <Card title="Critical shortages" subtitle="v_resource_demand: open demand minus stock in active warehouses">
              {!short.length ? <EmptyState title="No shortages" text="Every open request line can be covered by current stock." /> : (
                <table className="data compact">
                  <thead><tr><th>Resource</th><th className="num">Demand</th><th className="num">Stock</th><th className="num">Gap</th></tr></thead>
                  <tbody>
                    {short.map((s) => (
                      <tr key={s.resource_name}>
                        <td><div className="cell-main row" style={{ gap: 6 }}><AlertTriangle size={14} color="var(--danger)" aria-hidden />{s.resource_name}</div><div className="cell-sub">{titleCase(s.category_name)}</div></td>
                        <td className="num">{fmtNumber(s.outstanding_demand)}</td>
                        <td className="num">{fmtNumber(s.available_stock)}</td>
                        <td className="num" style={{ color: "var(--danger)", fontWeight: 650 }}>{fmtNumber(s.net_position)} {s.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Excess stock" subtitle="Lines holding more than 3× their threshold for resources with no shortage — candidates for transfer">
              {!data.excess.length ? <p className="muted small">No excess stock detected.</p> : (
                <table className="data compact">
                  <thead><tr><th>Stock line</th><th className="num">Available</th><th className="num">× threshold</th></tr></thead>
                  <tbody>
                    {data.excess.slice(0, 8).map((x, i) => (
                      <tr key={i}>
                        <td><div className="cell-main">{x.resource_name}</div><div className="cell-sub">{x.warehouse_name} · {x.location_name}</div></td>
                        <td className="num">{fmtNumber(x.available)} {x.unit}</td>
                        <td className="num">{x.times_threshold ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <Card title="High-priority open requests" subtitle="Medical emergencies first, then priority score and deadline" actions={<Link href="/requests" className="small">Requests queue</Link>}>
            {!data.priority.length ? <p className="muted small">No high-priority requests are open.</p> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Request</th><th>Priority</th><th>Allocated</th><th className="num">Hours left</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {data.priority.map((r) => (
                      <tr key={r.request_id}>
                        <td><div className="cell-main row" style={{ gap: 6 }}>#{r.request_id} · {r.camp_name}{r.medical_emergency && <Stethoscope size={14} color="var(--danger)" aria-label="Medical emergency" />}</div><div className="cell-sub">{r.disaster_name}</div></td>
                        <td><Badge value={r.priority_level} label={`${titleCase(r.priority_level)} · ${fmtNumber(r.priority_score)}`} /></td>
                        <td style={{ minWidth: 120 }}><span className="small num">{fmtNumber(r.fulfillment_pct, 1)}%</span><Meter value={r.fulfillment_pct} tone="teal" /></td>
                        <td className="num" style={{ color: r.hours_left < 0 ? "var(--danger)" : r.hours_left < 24 ? "var(--warning)" : undefined, fontWeight: 600 }}>{r.hours_left < 0 ? `overdue ${-r.hours_left}h` : `${r.hours_left}h`}</td>
                        <td><Badge value={r.status} /></td>
                        <td><Link href={`/requests?id=${r.request_id}`} className="btn sm"><PackagePlus size={13} /> Plan <ArrowRight size={12} /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="grid g-2">
            <Card title="Demand coverage by disaster" subtitle="Share of requested quantity already allocated (non-rejected requests)">
              <RankBars data={data.coverage.map((c) => ({ ...c, pct: c.requested ? Math.round((1000 * c.allocated) / c.requested) / 10 : 0 }))} x="disaster_name" y="pct" name="% allocated" unit="%" color={SERIES[2]} />
            </Card>
            <Card title="Availability across locations" subtitle="Units in active warehouses by location and category (darker = more)">
              <div className="table-wrap">
                <table className="data compact">
                  <thead><tr><th>Location</th>{cats.map((c) => <th key={c} className="num">{titleCase(c)}</th>)}</tr></thead>
                  <tbody>
                    {locs.map((l) => (
                      <tr key={l}>
                        <td className="cell-main small">{l}</td>
                        {cats.map((c) => {
                          const u = data.byLocation.find((x) => x.location_name === l && x.category_name === c)?.units ?? 0;
                          const t = u / max;
                          return (
                            <td key={c} className="num" style={{ background: u ? `rgba(42,120,214,${0.08 + t * 0.6})` : undefined, color: t > 0.55 ? "#fff" : undefined }} title={`${l} · ${c}: ${fmtNumber(u)}`}>
                              {u ? fmtNumber(u) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
