"use client";
import { useMemo, useState } from "react";
import { Key, Link2, Hash } from "lucide-react";
import { useApi } from "@/lib/client";
import { Badge, Card, ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";

type Attr = { name: string; type: string; nullable: boolean; pk: boolean; fk: boolean; unique: boolean; generated: boolean; default: string | null };
type Entity = { name: string; rows: number; kind: string; primaryKey: string[]; candidateKeys: string[][]; attributes: Attr[]; checks: { name: string; definition: string; validated: boolean }[] };
type Rel = { name: string; from: string; to: string; columns: string[]; references: string[]; cardinality: string; childParticipation: string; onDelete: string };
type ER = { entities: Entity[]; relationships: Rel[]; manyToMany: { via: string; between: string[] }[]; source: string };

const COLUMNS: string[][] = [
  ["roles", "app_users", "sessions", "audit_logs", "data_change_log"],
  ["disasters", "disaster_locations", "locations", "integration_sync_runs"],
  ["relief_camps", "resource_requests", "request_items"],
  ["resource_categories", "resources", "inventory", "warehouses", "inventory_movements"],
  ["allocations", "allocation_items", "deliveries", "delivery_volunteers", "volunteers", "vehicles"],
];
const W = 210, ROW = 17, HEAD = 30, GAP = 34, COLGAP = 70, MAXA = 9;

export default function ErExplorer() {
  const { data, error, reload } = useApi<ER>("/api/lab/er");
  const [sel, setSel] = useState<string | null>("resource_requests");
  const layout = useMemo(() => {
    if (!data) return null;
    const pos = new Map<string, { x: number; y: number; h: number }>();
    const placed = new Set<string>();
    const cols = COLUMNS.map((c) => c.filter((n) => data.entities.some((e) => e.name === n)));
    const extra = data.entities.map((e) => e.name).filter((n) => !COLUMNS.flat().includes(n));
    if (extra.length) cols.push(extra);
    let maxH = 0;
    cols.forEach((col, ci) => {
      let y = 20;
      for (const n of col) {
        const e = data.entities.find((x) => x.name === n)!;
        const shown = Math.min(e.attributes.length, MAXA);
        const h = HEAD + shown * ROW + (e.attributes.length > MAXA ? ROW : 0) + 8;
        pos.set(n, { x: 20 + ci * (W + COLGAP), y, h });
        placed.add(n);
        y += h + GAP;
      }
      maxH = Math.max(maxH, y);
    });
    return { pos, width: 20 + cols.length * (W + COLGAP), height: maxH };
  }, [data]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={reload} /></div>;
  const entity = data?.entities.find((e) => e.name === sel);
  const related = new Set(data?.relationships.filter((r) => r.from === sel || r.to === sel).flatMap((r) => [r.from, r.to]) ?? []);
  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 1"
        title="ER Diagram Explorer"
        lead={`Generated live from the ${data?.source ?? "database catalog"}: every entity, key and relationship below is read from pg_constraint and information_schema — not drawn by hand. Click an entity to inspect it.`}
      />
      <div className="grid g-main">
        <section className="card" style={{ overflow: "hidden" }}>
          <div className="table-tools">
            <div className="graph-legend" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <span><i style={{ background: "#172033", borderRadius: 3 }} />Entity</span>
              <span><i style={{ background: "#0f9d8a", borderRadius: 3 }} />Associative (M:N)</span>
              <span>⟜ crow&apos;s foot = many · bar = one · dashed = optional</span>
            </div>
          </div>
          {!data || !layout ? (
            <Skeleton h={560} />
          ) : (
            <div className="er-canvas" style={{ maxHeight: 720 }}>
              <svg width={layout.width} height={layout.height} role="img" aria-label="Entity relationship diagram">
                {data.relationships.map((r) => {
                  const a = layout.pos.get(r.from), b = layout.pos.get(r.to);
                  if (!a || !b) return null;
                  const hot = sel && (r.from === sel || r.to === sel);
                  const sameCol = a.x === b.x;
                  const ax = sameCol ? a.x + W : a.x < b.x ? a.x + W : a.x;
                  const bx = sameCol ? b.x + W : a.x < b.x ? b.x : b.x + W;
                  const ay = a.y + Math.min(a.h / 2, 40), by = b.y + Math.min(b.h / 2, 40);
                  const dir = ax <= bx ? 1 : -1;
                  const bend = sameCol ? 46 : Math.max(30, Math.abs(bx - ax) / 2);
                  const d = sameCol ? `M${ax},${ay} C${ax + bend},${ay} ${bx + bend},${by} ${bx},${by}` : `M${ax},${ay} C${ax + dir * bend},${ay} ${bx - dir * bend},${by} ${bx},${by}`;
                  const cd = sameCol ? 1 : dir; // child side direction
                  const color = hot ? "#2563eb" : "#b6c2d2";
                  return (
                    <g key={r.name} opacity={sel && !hot ? 0.35 : 1}>
                      <path d={d} fill="none" stroke={color} strokeWidth={hot ? 2 : 1.3} strokeDasharray={r.childParticipation === "partial" ? "5 4" : undefined} />
                      {r.cardinality === "N:1" ? (
                        <path d={`M${ax + cd * 12},${ay} L${ax},${ay - 6} M${ax + cd * 12},${ay} L${ax},${ay + 6} M${ax + cd * 12},${ay} L${ax},${ay}`} stroke={color} strokeWidth={1.5} />
                      ) : (
                        <path d={`M${ax + cd * 8},${ay - 6} L${ax + cd * 8},${ay + 6}`} stroke={color} strokeWidth={1.5} />
                      )}
                      <path d={`M${bx + (sameCol ? 8 : -dir * 8)},${by - 6} L${bx + (sameCol ? 8 : -dir * 8)},${by + 6}`} stroke={color} strokeWidth={1.5} />
                    </g>
                  );
                })}
                {data.entities.map((e) => {
                  const p = layout.pos.get(e.name);
                  if (!p) return null;
                  const dim = sel && sel !== e.name && !related.has(e.name);
                  return (
                    <g
                      key={e.name}
                      className={`er-entity ${e.kind === "associative" ? "associative" : ""} ${sel === e.name ? "selected" : ""} ${dim ? "dim" : ""}`}
                      transform={`translate(${p.x},${p.y})`}
                      onClick={() => setSel(sel === e.name ? null : e.name)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${e.name} entity`}
                      onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSel(e.name)}
                    >
                      <rect className="box" width={W} height={p.h} rx={9} fill="#fff" stroke="#d6dee8" />
                      <rect className="head" width={W} height={HEAD - 4} rx={9} />
                      <rect className="head" y={HEAD - 13} width={W} height={9} />
                      <text x={10} y={18} fill="#fff" fontSize={12.5} fontWeight={650}>{e.name}</text>
                      <text x={W - 10} y={18} fill="#9fb0c8" fontSize={10.5} textAnchor="end">{e.rows} rows</text>
                      {e.attributes.slice(0, MAXA).map((a, i) => (
                        <g key={a.name} transform={`translate(0,${HEAD + i * ROW + 10})`}>
                          <text x={10} y={0} fontSize={11} fill={a.pk ? "#b45309" : a.fk ? "#2563eb" : "#334155"} fontWeight={a.pk ? 650 : 400}>
                            {a.pk ? "PK " : a.fk ? "FK " : a.unique ? "UK " : "    "}
                            {a.name}
                          </text>
                          <text x={W - 10} y={0} fontSize={10} fill="#94a3b8" textAnchor="end">{a.type.replace("timestamptz", "tstz")}{a.nullable ? "" : " *"}</text>
                        </g>
                      ))}
                      {e.attributes.length > MAXA && <text x={10} y={HEAD + MAXA * ROW + 10} fontSize={10.5} fill="#94a3b8">+{e.attributes.length - MAXA} more attributes</text>}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </section>
        <div className="stack">
          {!entity ? (
            <Card title="Select an entity">
              <p className="small muted">Click a box to see its attributes, keys, constraints and relationships.</p>
              {data && (
                <div style={{ marginTop: 12 }}>
                  <div className="field-label">Many-to-many relationships (associative entities)</div>
                  {data.manyToMany.map((m) => (
                    <div key={m.via} className="small" style={{ marginTop: 6 }}>
                      {m.between.join(" ⟷ ")} via <code>{m.via}</code>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <>
              <Card title={entity.name} subtitle={`${entity.kind === "associative" ? "Associative entity (resolves M:N)" : entity.kind === "composite-key" ? "Entity with composite key" : "Entity"} · ${entity.rows} rows`}>
                <dl className="kv">
                  <dt>Primary key</dt>
                  <dd><code>({entity.primaryKey.join(", ")})</code>{entity.primaryKey.length > 1 && <Badge value="x" color="amber" label="composite" />}</dd>
                  <dt>Candidate keys</dt>
                  <dd>{[entity.primaryKey, ...entity.candidateKeys].map((k) => `(${k.join(", ")})`).join(" · ")}</dd>
                  {entity.candidateKeys.length > 0 && (<><dt>Alternate keys</dt><dd>{entity.candidateKeys.map((k) => `(${k.join(", ")})`).join(" · ")}</dd></>)}
                </dl>
                <div className="divider" />
                <div className="table-wrap">
                <table className="data compact">
                  <thead><tr><th>Attribute</th><th>Type</th><th>Flags</th></tr></thead>
                  <tbody>
                    {entity.attributes.map((a) => (
                      <tr key={a.name}>
                        <td className="cell-main small">{a.pk ? <Key size={11} color="#b45309" /> : a.fk ? <Link2 size={11} color="#2563eb" /> : a.unique ? <Hash size={11} /> : null} {a.name}</td>
                        <td className="small"><code>{a.type}</code></td>
                        <td className="small muted">{[a.pk && "PK", a.fk && "FK", a.unique && "UNIQUE", !a.nullable && "NOT NULL", a.generated && "GENERATED", a.default && `default ${a.default}`].filter(Boolean).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Card>
              <Card title="Relationships">
                {data!.relationships.filter((r) => r.from === entity.name || r.to === entity.name).map((r) => {
                  const out = r.from === entity.name;
                  return (
                    <div className="list-item" key={r.name} style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div className="cell-main small">
                          {out ? `${r.from} → ${r.to}` : `${r.from} → ${r.to}`}
                        </div>
                        <div className="cell-sub">
                          <code>({r.columns.join(", ")})</code> references <code>{r.to}({r.references.join(", ")})</code>
                        </div>
                        <div className="cell-sub">
                          {r.cardinality === "N:1" ? `many ${r.from} : one ${r.to}` : `one ${r.from} : one ${r.to}`} · {r.childParticipation} participation of {r.from} · ON DELETE {r.onDelete}
                        </div>
                      </div>
                      <Badge value="x" color="blue" label={r.cardinality} />
                    </div>
                  );
                })}
              </Card>
              {entity.checks.length > 0 && (
                <Card title="CHECK constraints">
                  {entity.checks.map((c) => (
                    <div key={c.name} className="small" style={{ marginBottom: 6 }}>
                      <code>{c.definition}</code> {!c.validated && <Badge value="HIGH" label="NOT VALID (legacy rows)" />}
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
