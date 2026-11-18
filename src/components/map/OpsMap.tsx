"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { fmtNumber, titleCase } from "@/lib/client";

export type MapData = {
  disasters: { disaster_id: string; disaster_name: string; disaster_type: string; severity: string; status: string; location_name: string; lat: number; lon: number; affected_population: string; open_requests: string; affected: { location_name: string; lat: number; lon: number; impact: string; population: number }[] | null }[];
  camps: { camp_id: string; camp_name: string; status: string; capacity: number; current_population: number; location_name: string; lat: number; lon: number; open_requests: number }[];
  warehouses: { warehouse_id: string; warehouse_name: string; status: string; location_name: string; lat: number; lon: number; units: number; low_stock_lines: number; resource_lines: number }[];
};
const SEV: Record<string, string> = { CRITICAL: "#d03b3b", HIGH: "#ec835a", MODERATE: "#fab219", LOW: "#94a3b8" };

function Fit({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
  }, [bounds, map]);
  return null;
}

export default function OpsMap({ data, layers }: { data: MapData; layers: { disasters: boolean; camps: boolean; warehouses: boolean } }) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const bounds = useMemo(() => {
    const pts = [...data.disasters.map((d) => [d.lat, d.lon]), ...data.camps.map((c) => [c.lat, c.lon]), ...data.warehouses.map((w) => [w.lat, w.lon])] as [number, number][];
    return pts.length ? (pts as LatLngBoundsExpression) : null;
  }, [data]);
  return (
    <div className="map-box">
      <MapContainer center={[20.6, 79]} zoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom aria-label="Operations map">
        {!tilesFailed && (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{ tileerror: () => setTilesFailed(true) }}
          />
        )}
        <Fit bounds={bounds} />
        {layers.disasters &&
          data.disasters.map((d) => (
            <div key={`d${d.disaster_id}`}>
              {(d.affected ?? []).map((a, i) => (
                <Polyline key={i} positions={[[d.lat, d.lon], [a.lat, a.lon]]} pathOptions={{ color: SEV[d.severity], weight: 1.5, dashArray: "4 4", opacity: 0.7 }} />
              ))}
              <CircleMarker center={[d.lat, d.lon]} radius={10 + Math.min(14, Math.sqrt(Number(d.affected_population)) / 12)} pathOptions={{ color: "#fff", weight: 2, fillColor: SEV[d.severity] ?? "#94a3b8", fillOpacity: 0.85 }}>
                <Popup>
                  <b>{d.disaster_name}</b>
                  <br />
                  {titleCase(d.disaster_type)} · {titleCase(d.severity)} · {titleCase(d.status)}
                  <br />
                  {fmtNumber(d.affected_population)} affected · {d.open_requests} open requests
                </Popup>
              </CircleMarker>
            </div>
          ))}
        {layers.camps &&
          data.camps.map((c) => (
            <CircleMarker key={`c${c.camp_id}`} center={[c.lat + 0.02, c.lon + 0.02]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0f9d8a", fillOpacity: 0.95 }}>
              <Popup>
                <b>{c.camp_name}</b> (camp)
                <br />
                {fmtNumber(c.current_population)} / {fmtNumber(c.capacity)} · {titleCase(c.status)}
                <br />
                {c.open_requests} open requests
              </Popup>
            </CircleMarker>
          ))}
        {layers.warehouses &&
          data.warehouses.map((w) => (
            <CircleMarker key={`w${w.warehouse_id}`} center={[w.lat - 0.02, w.lon - 0.02]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 0.95 }}>
              <Popup>
                <b>{w.warehouse_name}</b> (warehouse)
                <br />
                {fmtNumber(w.units)} units · {w.resource_lines} lines · {w.low_stock_lines} low · {titleCase(w.status)}
              </Popup>
            </CircleMarker>
          ))}
      </MapContainer>
      {tilesFailed && <p className="small muted" style={{ padding: 8 }}>Map tiles could not be loaded (offline?). Markers are still positioned from stored coordinates.</p>}
    </div>
  );
}
