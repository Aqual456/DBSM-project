"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApi, fmtNumber } from "@/lib/client";
import { Alert, Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";
import type { MapData } from "@/components/map/OpsMap";

const OpsMap = dynamic(() => import("@/components/map/OpsMap"), { ssr: false, loading: () => <Skeleton h={620} /> });

export default function MapPage() {
  const { data, error, reload } = useApi<MapData & { locationsWithoutCoordinates: number }>("/api/map");
  const [layers, setLayers] = useState({ disasters: true, camps: true, warehouses: true });
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Operations Map"
        lead="Disasters (sized by affected population, coloured by severity, dashed lines to affected locations), relief camps and warehouses — positioned from coordinates stored in PostgreSQL."
        actions={<Button icon={<RefreshCw size={15} />} onClick={reload}>Refresh</Button>}
      />
      {error ? (
        <div className="card"><ErrorState message={error} onRetry={reload} /></div>
      ) : (
        <div className="grid g-main">
          <section className="card" style={{ overflow: "hidden" }}>
            <div className="table-tools">
              <span className="field-label">Layers</span>
              {(["disasters", "camps", "warehouses"] as const).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                  <span className="dot" style={{ width: 10, height: 10, background: k === "disasters" ? "#d03b3b" : k === "camps" ? "#0f9d8a" : "#2563eb" }} />
                  {k[0].toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>
            {data ? <OpsMap data={data} layers={layers} /> : <Skeleton h={620} />}
          </section>
          <div className="stack">
            {data && data.locationsWithoutCoordinates > 0 && <Alert kind="warn">{data.locationsWithoutCoordinates} location(s) have no coordinates and are not shown. Add them under Administration → Locations.</Alert>}
            <Card title="Disasters" subtitle="Severity shown with label and colour">
              {!data ? <Skeleton h={160} /> : data.disasters.map((d) => (
                <div className="list-item" key={d.disaster_id}>
                  <div style={{ flex: 1 }}>
                    <div className="cell-main small">{d.disaster_name}</div>
                    <div className="cell-sub">{fmtNumber(d.affected_population)} affected · {d.open_requests} open requests</div>
                  </div>
                  <Badge value={d.severity} />
                </div>
              ))}
            </Card>
            <Card title="Network">
              {data && (
                <dl className="kv">
                  <dt>Relief camps</dt><dd>{data.camps.length}</dd>
                  <dt>Warehouses</dt><dd>{data.warehouses.length}</dd>
                  <dt>Sheltered</dt><dd>{fmtNumber(data.camps.reduce((s, c) => s + c.current_population, 0))}</dd>
                </dl>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
