"use client";
import { RefreshCw } from "lucide-react";
import { useApi, fmtNumber, titleCase } from "@/lib/client";
import { Button, Card, ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { DemandSupplyChart, Legend, RankBars, SERIES, SeverityChart, TrendChart } from "@/components/charts/Charts";

type Dash = {
  kpi: Record<string, number>;
  severity: { severity: string; count: number }[];
  demand: { resource_name: string; unit: string; demand: number; available: number }[];
  stockTrend: { day: string; inflow: number; outflow: number }[];
  requestTrend: { day: string; requested: number; allocated: number; delivered: number }[];
  deliveryStatus: { status: string; count: number }[];
  campLoad: { camp_name: string; capacity: number; current_population: number }[];
};
type Intel = { coverage: { disaster_name: string; requested: number; allocated: number }[] };

export default function AnalyticsPage() {
  const { data, error, reload } = useApi<Dash>("/api/dashboard");
  const { data: intel } = useApi<Intel>("/api/intelligence");
  return (
    <>
      <PageHeader eyebrow="Analytics" title="Operational Analytics" lead="Trends and distributions behind the command center. Hover any chart for exact values; tables below each chart give the same numbers." actions={<Button icon={<RefreshCw size={15} />} onClick={reload}>Refresh</Button>} />
      {error ? <div className="card"><ErrorState message={error} onRetry={reload} /></div> : (
        <div className="stack">
          <div className="grid g-2">
            <Card title="Requests over time" actions={<Legend items={[{ label: "Requested", color: SERIES[0] }, { label: "Allocated", color: SERIES[1] }, { label: "Delivered", color: SERIES[2] }]} />}>
              {data ? <TrendChart data={data.requestTrend} label="Requests over time" series={[{ key: "requested", name: "Requested" }, { key: "allocated", name: "Allocated" }, { key: "delivered", name: "Delivered" }]} /> : <Skeleton h={260} />}
            </Card>
            <Card title="Stock flow" actions={<Legend items={[{ label: "Inflow", color: SERIES[0] }, { label: "Outflow", color: SERIES[1] }]} />}>
              {data ? <TrendChart data={data.stockTrend} label="Stock inflow and outflow" series={[{ key: "inflow", name: "Inflow" }, { key: "outflow", name: "Outflow" }]} /> : <Skeleton h={260} />}
            </Card>
          </div>
          <div className="grid g-2">
            <Card title="Disasters by severity">{data ? <SeverityChart data={data.severity} /> : <Skeleton h={200} />}</Card>
            <Card title="Allocation coverage by disaster" subtitle="% of requested quantity allocated">
              {intel ? <RankBars data={intel.coverage.map((c) => ({ ...c, pct: c.requested ? Math.round((1000 * c.allocated) / c.requested) / 10 : 0 }))} x="disaster_name" y="pct" name="% allocated" unit="%" color={SERIES[2]} /> : <Skeleton h={200} />}
            </Card>
          </div>
          <Card title="Demand vs availability" actions={<Legend items={[{ label: "Outstanding demand", color: SERIES[1] }, { label: "Available stock", color: SERIES[0] }]} />}>
            {data ? <DemandSupplyChart data={data.demand} /> : <Skeleton h={300} />}
            {data && (
              <details style={{ marginTop: 10 }}>
                <summary className="small muted" style={{ cursor: "pointer" }}>Show as table</summary>
                <table className="data compact" style={{ marginTop: 8 }}>
                  <thead><tr><th>Resource</th><th className="num">Demand</th><th className="num">Available</th><th>Unit</th></tr></thead>
                  <tbody>{data.demand.map((d) => <tr key={d.resource_name}><td>{d.resource_name}</td><td className="num">{fmtNumber(d.demand)}</td><td className="num">{fmtNumber(d.available)}</td><td>{d.unit}</td></tr>)}</tbody>
                </table>
              </details>
            )}
          </Card>
          <div className="grid g-2">
            <Card title="Camp occupancy" subtitle="Most loaded open camps">
              {data ? <RankBars data={data.campLoad.map((c) => ({ camp_name: c.camp_name, pct: Math.round((1000 * c.current_population) / c.capacity) / 10 }))} x="camp_name" y="pct" name="% occupied" unit="%" /> : <Skeleton h={220} />}
            </Card>
            <Card title="Delivery outcomes">
              {data ? <RankBars data={data.deliveryStatus.map((d) => ({ status: titleCase(d.status), count: d.count }))} x="status" y="count" name="Deliveries" color={SERIES[0]} /> : <Skeleton h={220} />}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
