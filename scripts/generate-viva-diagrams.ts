import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

/**
 * Generates the two viva diagrams from the LIVE PostgreSQL catalog (metadata only, no rows):
 *   docs/viva/ReliefFlow-ER-Diagram.{svg,png,pdf}         Chen notation, whole database
 *   docs/viva/ReliefFlow-Relational-Schema.{svg,png,pdf}  every table, column, PK and FK
 * The conceptual ER model (entity/relationship names, weak entities) is curated below, but every
 * relationship is checked against a real foreign key, every FK must be covered, and attributes,
 * keys and nullability come from the catalog. The script fails if the model and database disagree.
 */
type Col = { table: string; name: string; type: string; nullable: boolean; generated: boolean; pos: number };
type Fk = { name: string; child: string; cols: string[]; parent: string; refs: string[]; onDelete: string };

const OUT = resolve("docs/viva");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function catalog() {
  const { pool } = await import("../src/lib/postgres");
  const cols = (
    await pool.query(`SELECT table_name, column_name, ordinal_position,
        CASE WHEN data_type = 'character varying' THEN 'VARCHAR(' || character_maximum_length || ')'
             WHEN data_type = 'numeric' THEN 'NUMERIC(' || numeric_precision || ',' || numeric_scale || ')'
             WHEN data_type = 'timestamp with time zone' THEN 'TIMESTAMPTZ'
             ELSE upper(data_type) END AS type,
        is_nullable = 'YES' AS nullable, is_generated <> 'NEVER' AS generated
      FROM information_schema.columns c WHERE table_schema = 'public' AND EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE') ORDER BY table_name, ordinal_position`)
  ).rows.map((r) => ({ table: r.table_name, name: r.column_name, type: r.type, nullable: r.nullable, generated: r.generated, pos: r.ordinal_position })) as Col[];
  const keys = (
    await pool.query(`SELECT conrelid::regclass::text AS t, contype, conname,
        array(SELECT attname::text FROM unnest(conkey) k JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k ORDER BY array_position(conkey, k)) AS cols,
        confrelid::regclass::text AS parent,
        array(SELECT attname::text FROM unnest(confkey) k JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k ORDER BY array_position(confkey, k)) AS refs,
        confdeltype
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('p','u','f')`)
  ).rows;
  await pool.end();
  const pk: Record<string, string[]> = {};
  const uq: Record<string, string[][]> = {};
  const fks: Fk[] = [];
  for (const k of keys) {
    if (k.contype === "p") pk[k.t] = k.cols;
    if (k.contype === "u") (uq[k.t] ??= []).push(k.cols);
    if (k.contype === "f")
      fks.push({ name: k.conname, child: k.t, cols: k.cols, parent: k.parent, refs: k.refs, onDelete: ({ a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL" } as Record<string, string>)[k.confdeltype] });
  }
  const tables = [...new Set(cols.map((c) => c.table))];
  return { cols, pk, uq, fks, tables };
}

// ----------------------------------------------------------------------------------------
// Conceptual (Chen) model
// ----------------------------------------------------------------------------------------
type Ent = { id: string; table?: string; label: string; x: number; y: number; weak?: boolean; arc: [number, number]; r?: number; external?: boolean; extraAttrs?: Attr[] };
type Attr = { name: string; key?: boolean; partial?: boolean; derived?: boolean; multi?: boolean; parts?: string[] };
type End = { e: string; card: string; total: boolean; via?: [number, number][] };
type Rel = { id: string; label: string; x: number; y: number; a: End; b: End; fk?: string; identifying?: boolean; attrs?: { name: string; dx: number; dy: number }[]; table?: string; external?: boolean; note?: string };

const E = (id: string, table: string | undefined, label: string, x: number, y: number, arc: [number, number], extra: Partial<Ent> = {}): Ent => ({ id, table, label, x, y, arc, ...extra });
const entities: Ent[] = [
  E("USER", "app_users", "USER", 2150, 470, [195, 345], { r: 175 }),
  E("ROLE", "roles", "ROLE", 1230, 300, [200, 330]),
  E("SESSION", "sessions", "SESSION", 3050, 300, [200, 340]),
  E("AUDIT", "audit_logs", "AUDIT LOG", 3700, 560, [250, 400]),
  E("SYNC", "integration_sync_runs", "SYNC RUN", 560, 470, [150, 330], { r: 165 }),
  E("INCIDENT", undefined, "INCIDENT REPORT", 520, 1000, [95, 265], {
    external: true,
    r: 210,
    extraAttrs: [
      { name: "_id", key: true },
      { name: "reportType" },
      { name: "severity" },
      { name: "description" },
      { name: "location", parts: ["label", "latitude", "longitude"] },
      { name: "status" },
      { name: "tags", multi: true },
      { name: "updates", multi: true },
      { name: "createdAt" },
    ],
  }),
  E("DISASTER", "disasters", "DISASTER", 900, 1250, [128, 250], { r: 250 }),
  E("REQUEST", "resource_requests", "RESOURCE REQUEST", 1700, 1250, [200, 340], { r: 230 }),
  E("ALLOCATION", "allocations", "ALLOCATION", 2550, 1250, [215, 325], { r: 170 }),
  E("DELIVERY", "deliveries", "DELIVERY", 3350, 1250, [205, 335], { r: 200 }),
  E("VEHICLE", "vehicles", "VEHICLE", 4050, 1250, [270, 420], { r: 135 }),
  E("VOLUNTEER", "volunteers", "VOLUNTEER", 4050, 1950, [290, 440], { r: 175 }),
  E("CAMP", "relief_camps", "RELIEF CAMP", 1250, 1950, [60, 175], { r: 190 }),
  E("REQITEM", "request_items", "REQUEST ITEM", 2050, 1950, [60, 110], { weak: true }),
  E("ALLOCITEM", "allocation_items", "ALLOCATION ITEM", 2900, 1950, [20, 80], { r: 140 }),
  E("WAREHOUSE", "warehouses", "WAREHOUSE", 900, 2650, [100, 200], { r: 140 }),
  E("STOCK", "inventory", "STOCK LINE", 1700, 2650, [205, 335], { weak: true, r: 170 }),
  E("RESOURCE", "resources", "RESOURCE", 2650, 2650, [40, 140], { r: 140 }),
  E("CATEGORY", "resource_categories", "CATEGORY", 3450, 2650, [-40, 70]),
  E("MOVEMENT", "inventory_movements", "STOCK MOVEMENT", 1700, 3250, [30, 160], { r: 150 }),
  E("LOCATION", "locations", "LOCATION", 330, 2300, [100, 260], { r: 160 }),
  // standalone system tables (no relationships)
  E("LOGIN", "login_attempts", "LOGIN ATTEMPT", 3150, 3300, [180, 360], { r: 120 }),
  E("CHANGELOG", "data_change_log", "DATA CHANGE LOG", 3900, 3150, [180, 360], { r: 150 }),
  E("MIGRATION", "schema_migrations", "SCHEMA MIGRATION", 3900, 2650, [180, 360], { r: 115 }),
];
const R = (id: string, label: string, x: number, y: number, a: End, b: End, extra: Partial<Rel> = {}): Rel => ({ id, label, x, y, a, b, ...extra });
const one = (e: string, total = false, via?: [number, number][]): End => ({ e, card: "1", total, via });
const many = (e: string, total = false, card = "N", via?: [number, number][]): End => ({ e, card, total, via });
const relationships: Rel[] = [
  R("HAS_ROLE", "HAS ROLE", 1650, 380, many("USER", true), one("ROLE"), { fk: "app_users_role_id_fkey" }),
  R("AUTH", "AUTHENTICATES", 2620, 340, many("SESSION", true), one("USER"), { fk: "sessions_user_id_fkey" }),
  R("PERFORMS", "PERFORMS", 3000, 620, many("AUDIT"), one("USER"), { fk: "audit_logs_user_id_fkey" }),
  R("TRIGGERS", "TRIGGERS", 1150, 560, many("SYNC"), one("USER"), { fk: "integration_sync_runs_triggered_by_fkey" }),
  R("CREATES", "CREATES", 1350, 820, many("DISASTER", true), one("USER"), { fk: "disasters_created_by_fkey" }),
  R("REQUESTED_BY", "RAISED BY", 1900, 860, many("REQUEST", true), one("USER"), { fk: "resource_requests_requested_by_fkey" }),
  R("ALLOCATED_BY", "ALLOCATED BY", 2380, 860, many("ALLOCATION", true), one("USER"), { fk: "allocations_allocated_by_fkey" }),
  R("DRIVES", "DRIVES", 2900, 860, many("DELIVERY", true), one("USER"), { fk: "deliveries_driver_id_fkey" }),
  R("MANAGES_CAMP", "MANAGES", 1120, 1700, many("CAMP"), one("USER", false, [[1120, 700]]), { fk: "relief_camps_manager_id_fkey" }),
  R("MANAGES_DEPOT", "MANAGES", 640, 2850, many("WAREHOUSE"), one("USER", false, [[55, 2850], [55, 620], [1900, 620]]), { fk: "warehouses_manager_id_fkey" }),
  R("REPORTS_ON", "REPORTS ON", 800, 960, many("INCIDENT", true), one("DISASTER"), { external: true, note: "application-level reference" }),
  R("REPORTED_BY", "REPORTED BY", 520, 760, many("INCIDENT", true), one("USER", false, [[520, 660], [1800, 660]]), { external: true }),
  R("OCCURS_AT", "OCCURS AT", 900, 1650, many("DISASTER"), one("LOCATION", false, [[600, 2050]]), { fk: "disasters_event_location_id_fkey" }),
  R("AFFECTS", "AFFECTS", 600, 1650, many("DISASTER", true, "M"), many("LOCATION", true, "N"), {
    table: "disaster_locations",
    attrs: [
      { name: "impact_level", dx: -165, dy: -40 },
      { name: "affected_population", dx: -190, dy: 10 },
      { name: "reported_at", dx: -150, dy: 60 },
    ],
  }),
  R("CAMP_AT", "LOCATED AT", 800, 2150, many("CAMP", true), one("LOCATION"), { fk: "relief_camps_location_id_fkey" }),
  R("DEPOT_AT", "SITED AT", 620, 2500, many("WAREHOUSE", true), one("LOCATION"), { fk: "warehouses_location_id_fkey" }),
  R("RAISED_AT", "RAISED AT", 1500, 1620, many("REQUEST", true), one("CAMP"), { fk: "resource_requests_camp_id_fkey" }),
  R("FOR_DISASTER", "FOR", 1300, 1250, many("REQUEST", true), one("DISASTER"), { fk: "resource_requests_disaster_id_fkey" }),
  R("CONTAINS", "CONTAINS", 1880, 1600, many("REQITEM", true), one("REQUEST"), { fk: "request_items_request_id_fkey", identifying: true }),
  R("OF_RESOURCE", "OF", 2300, 2300, many("REQITEM", true), one("RESOURCE"), { fk: "request_items_resource_id_fkey", identifying: true }),
  R("FULFILS", "FULFILS", 2130, 1250, many("ALLOCATION", true), one("REQUEST"), { fk: "allocations_request_id_fkey" }),
  R("PART_OF", "PART OF", 2720, 1600, many("ALLOCITEM", true), one("ALLOCATION"), { fk: "allocation_items_allocation_id_request_id_fkey" }),
  R("COVERS", "COVERS", 2470, 1950, many("ALLOCITEM", true), one("REQITEM"), { fk: "allocation_items_request_id_resource_id_fkey" }),
  R("DRAWS_FROM", "DRAWS FROM", 2250, 2650, many("ALLOCITEM", true, "N", [[2900, 2300]]), one("STOCK"), { fk: "allocation_items_warehouse_id_resource_id_fkey" }),
  R("TRANSPORTS", "TRANSPORTS", 2950, 1250, many("DELIVERY", true), one("ALLOCATION"), { fk: "deliveries_allocation_id_fkey", note: "≤ 1 active" }),
  R("USES", "USES", 3700, 1250, many("DELIVERY", true), one("VEHICLE"), { fk: "deliveries_vehicle_id_fkey" }),
  R("FROM", "FROM", 3350, 1700, many("DELIVERY", true, "N", [[3350, 1450]]), one("LOCATION", false, [[3350, 2420], [330, 2420]]), { fk: "deliveries_source_location_id_fkey" }),
  R("TO", "TO", 3600, 1650, many("DELIVERY", true, "N", [[3500, 1400]]), one("LOCATION", false, [[3600, 2470], [400, 2470]]), { fk: "deliveries_destination_location_id_fkey" }),
  R("LAST_AT", "LAST SEEN AT", 4050, 1650, many("VEHICLE"), one("LOCATION", false, [[4050, 2520], [450, 2520]]), { fk: "vehicles_current_location_id_fkey" }),
  R("CREWED_BY", "CREWED BY", 3700, 1950, many("DELIVERY", false, "M", [[3350, 1950]]), many("VOLUNTEER", false, "N"), {
    table: "delivery_volunteers",
    attrs: [{ name: "assigned_role", dx: 0, dy: 75 }],
  }),
  R("HOLDS", "HOLDS", 1300, 2650, many("STOCK", true), one("WAREHOUSE"), { fk: "inventory_warehouse_id_fkey", identifying: true }),
  R("STOCK_OF", "STOCK OF", 2050, 2850, many("STOCK", true, "N", [[1700, 2850]]), one("RESOURCE", false, [[2650, 2850]]), { fk: "inventory_resource_id_fkey", identifying: true }),
  R("BELONGS", "BELONGS TO", 3050, 2650, many("RESOURCE", true), one("CATEGORY"), { fk: "resources_category_id_fkey" }),
  R("LOGS", "LOGS", 1700, 2960, many("MOVEMENT", true), one("STOCK"), { fk: "inventory_movements_warehouse_id_resource_id_fkey" }),
];
// associative tables shown as M:N relationships rather than entities
const relationshipTables: Record<string, string[]> = { disaster_locations: ["disaster_locations_disaster_id_fkey", "disaster_locations_location_id_fkey"], delivery_volunteers: ["delivery_volunteers_delivery_id_fkey", "fk_delivery_volunteer_volunteer"] };

function attrsFor(ent: Ent, cols: Col[], pk: Record<string, string[]>, fks: Fk[]): Attr[] {
  if (ent.extraAttrs) return ent.extraAttrs;
  const t = ent.table!;
  const fkCols = new Set(fks.filter((f) => f.child === t).flatMap((f) => f.cols));
  const keys = pk[t] ?? [];
  const out: Attr[] = [];
  const own = cols.filter((c) => c.table === t).sort((a, b) => a.pos - b.pos);
  const hasCoords = own.some((c) => c.name === "latitude");
  for (const c of own) {
    if (hasCoords && (c.name === "latitude" || c.name === "longitude")) continue;
    const isKey = keys.includes(c.name);
    if (fkCols.has(c.name) && !(ent.weak && isKey)) continue; // FKs are represented by relationships
    if (ent.weak && fkCols.has(c.name)) continue; // owner keys come from identifying relationships
    out.push({ name: c.name, key: isKey && !ent.weak, derived: c.generated });
  }
  if (hasCoords) out.push({ name: "coordinates", parts: ["latitude", "longitude"] });
  if (t === "relief_camps") out.push({ name: "occupancy_pct", derived: true });
  if (ent.weak && !out.some((a) => a.partial)) {
    // partial key of a weak entity = the discriminator inherited from the second owner
    const disc = t === "request_items" ? "resource (via OF)" : t === "inventory" ? "resource (via STOCK OF)" : null;
    if (disc) out.unshift({ name: disc, partial: true });
  }
  return out;
}

let erAttrs: { key: string; attr: Attr; cx: number; cy: number; rx: number; ry: number; small: boolean; owner?: string; parentKey?: string }[] = [];
function chenSvg(model: Awaited<ReturnType<typeof catalog>>) {
  const W = 4400, H = 3520;
  const byId = new Map(entities.map((e) => [e.id, e]));
  const parts: string[] = [];
  const lines: string[] = [];
  const entW = (e: Ent) => Math.max(150, e.label.length * 10 + 40);
  const EH = 50;
  // ---- relationship edges
  const edge = (r: Rel, end: End) => {
    const e = byId.get(end.e)!;
    const pts: [number, number][] = [[r.x, r.y], ...(end.via ?? []), [e.x, e.y]];
    const d = "M" + pts.map((p) => p.join(",")).join(" L");
    const color = r.external ? "#7c6fcf" : "#334155";
    const dash = r.external ? ' stroke-dasharray="8 5"' : "";
    if (end.total) {
      lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="7"${dash}/>`, `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="3"/>`);
    } else lines.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${dash}/>`);
    // cardinality label near the entity end
    const [px, py] = pts[pts.length - 2];
    const dx = e.x - px, dy = e.y - py, len = Math.hypot(dx, dy) || 1;
    const hw = entW(e) / 2 + 18, hh = EH / 2 + 18;
    const t = Math.min(hw / Math.abs(dx / len || 1e-9), hh / Math.abs(dy / len || 1e-9));
    const lx = e.x - (dx / len) * (t + 4) + (-dy / len) * 14;
    const ly = e.y - (dy / len) * (t + 4) + (dx / len) * 14;
    parts.push(`<text x="${lx.toFixed(0)}" y="${(ly + 6).toFixed(0)}" class="card">${end.card}</text>`);
  };
  for (const r of relationships) {
    edge(r, r.a);
    edge(r, r.b);
    for (const a of r.attrs ?? []) lines.push(`<line x1="${r.x}" y1="${r.y}" x2="${r.x + a.dx}" y2="${r.y + a.dy}" stroke="#64748b" stroke-width="1.2"/>`);
  }
  // ---- entity attributes
  const attrSvg = (cx: number, cy: number, a: Attr, ox: number, oy: number, small = false): string => {
    const rx = Math.max(38, a.name.length * (small ? 3.6 : 3.9) + 16);
    const ry = small ? 14 : 17;
    const style = a.derived ? ' stroke-dasharray="5 4"' : "";
    let s = `<line x1="${ox}" y1="${oy}" x2="${cx}" y2="${cy}" stroke="#94a3b8" stroke-width="1.1"/>`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="attr"${style}/>`;
    if (a.multi) s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx - 4}" ry="${ry - 4}" class="attr"/>`;
    const deco = a.key ? ' text-decoration="underline"' : "";
    s += `<text x="${cx}" y="${cy + 4}" class="${small ? "attrt small" : "attrt"}"${deco}>${esc(a.name)}</text>`;
    if (a.partial) s += `<line x1="${cx - a.name.length * 3.3}" y1="${cy + 7}" x2="${cx + a.name.length * 3.3}" y2="${cy + 7}" stroke="#172033" stroke-dasharray="3 2"/>`;
    return s;
  };
  type Item = { a: Attr; cx: number; cy: number; rx: number; ry: number; dx: number; dy: number; ox: number; oy: number; small: boolean; parent?: Item; owner?: string };
  const items: Item[] = [];
  const size = (a: Attr, small: boolean) => ({ rx: Math.max(38, a.name.length * (small ? 3.6 : 3.9) + 16), ry: small ? 14 : 17 });
  for (const e of entities) {
    const attrs = attrsFor(e, model.cols, model.pk, model.fks);
    const [a0, a1] = e.arc;
    const n = attrs.length;
    const base = e.r ?? 130;
    attrs.forEach((a, i) => {
      const ang = ((n === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const it: Item = { a, cx: e.x + dx * (base * 0.75 + entW(e) / 4), cy: e.y + dy * base * 0.62, ...size(a, false), dx, dy, ox: e.x, oy: e.y, small: false, owner: e.id };
      items.push(it);
      (a.parts ?? []).forEach((pname, j) => {
        const off = (j - ((a.parts!.length - 1) / 2)) * 100;
        items.push({ a: { name: pname }, cx: it.cx + dx * 70 - dy * off, cy: it.cy + dy * 55 + dx * off * 0.5, ...size({ name: pname }, true), dx, dy, ox: 0, oy: 0, small: true, parent: it });
      });
    });
  }
  // fixed obstacles: entity boxes and relationship diamonds (as boxes)
  const obstacles = [
    ...entities.map((e) => ({ x: e.x, y: e.y, w: entW(e) / 2 + 8, h: EH / 2 + 8 })),
    ...relationships.map((r) => ({ x: r.x, y: r.y, w: Math.max(70, r.label.length * 7.4 + 34) * 0.75, h: 26 })),
  ];
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.abs(a.x - b.x) < a.w + b.w && Math.abs(a.y - b.y) < a.h + b.h;
  const box = (i: Item) => ({ x: i.cx, y: i.cy, w: i.rx + 6, h: i.ry + 5 });
  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const me = items[i];
      const collide = obstacles.some((o) => hit(box(me), o)) || items.some((o, j) => j !== i && hit(box(me), box(o)) && (j < i || o.parent === me));
      if (collide) {
        me.cx += me.dx * 7;
        me.cy += me.dy * 7;
        if (Math.abs(me.dy) < 0.35) me.cy += (i % 2 ? 4 : -4); // break horizontal ties
        for (const child of items) if (child.parent === me) { child.cx += me.dx * 7; child.cy += me.dy * 7; }
        moved = true;
      }
    }
    if (!moved) break;
  }
  erAttrs = items.map((it, i) => ({ key: `a${i}`, attr: it.a, cx: it.cx, cy: it.cy, rx: it.rx, ry: it.ry, small: it.small, owner: it.owner, parentKey: it.parent ? `a${items.indexOf(it.parent)}` : undefined }));
  for (const it of items) {
    const ox = it.parent ? it.parent.cx : it.ox, oy = it.parent ? it.parent.cy : it.oy;
    parts.push(attrSvg(Math.round(it.cx), Math.round(it.cy), it.a, ox, oy, it.small));
  }
  // ---- entities on top of lines
  const ents = entities.map((e) => {
    const w = entW(e);
    const x = e.x - w / 2, y = e.y - EH / 2;
    const cls = e.external ? "ent ext" : "ent";
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${EH}" rx="3" class="${cls}"/>`;
    if (e.weak) s += `<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${EH - 10}" rx="2" class="${cls}" fill="none"/>`;
    s += `<text x="${e.x}" y="${e.y + 6}" class="entt">${esc(e.label)}</text>`;
    if (e.external) s += `<text x="${e.x}" y="${e.y + 44}" class="note">MongoDB document</text>`;
    return s;
  });
  const rels = relationships.map((r) => {
    const hw = Math.max(70, r.label.length * 7.4 + 34), hh = 34;
    const pts = `${r.x},${r.y - hh} ${r.x + hw},${r.y} ${r.x},${r.y + hh} ${r.x - hw},${r.y}`;
    let s = `<polygon points="${pts}" class="rel${r.external ? " ext" : ""}"/>`;
    if (r.identifying) s += `<polygon points="${r.x},${r.y - hh + 7} ${r.x + hw - 12},${r.y} ${r.x},${r.y + hh - 7} ${r.x - hw + 12},${r.y}" class="rel" fill="none"/>`;
    s += `<text x="${r.x}" y="${r.y + 5}" class="relt">${esc(r.label)}</text>`;
    if (r.note) s += `<text x="${r.x}" y="${r.y + hh + 16}" class="note">${esc(r.note)}</text>`;
    for (const a of r.attrs ?? []) s += attrSvg(r.x + a.dx, r.y + a.dy, { name: a.name }, r.x + a.dx, r.y + a.dy);
    return s;
  });
  const legend = `
  <g transform="translate(40,3080)">
    <rect width="1080" height="400" rx="10" fill="#f8fafc" stroke="#cbd5e1"/>
    <text x="24" y="40" class="legh">Notation (Chen)</text>
    <rect x="24" y="64" width="120" height="40" class="ent"/><text x="84" y="89" class="entt" style="font-size:13px">ENTITY</text>
    <text x="160" y="90" class="legt">Strong entity (own primary key)</text>
    <rect x="24" y="120" width="120" height="40" class="ent"/><rect x="29" y="125" width="110" height="30" class="ent" fill="none"/><text x="84" y="145" class="entt" style="font-size:13px">WEAK</text>
    <text x="160" y="146" class="legt">Weak entity (identified through its owners)</text>
    <polygon points="84,172 144,198 84,224 24,198" class="rel"/><text x="84" y="202" class="relt" style="font-size:11px">REL</text>
    <text x="160" y="203" class="legt">Relationship · double diamond = identifying</text>
    <ellipse cx="84" cy="258" rx="58" ry="17" class="attr"/><text x="84" y="262" class="attrt" text-decoration="underline">key</text>
    <text x="160" y="263" class="legt">Attribute · underlined = key · dashed underline = partial key</text>
    <ellipse cx="84" cy="304" rx="58" ry="17" class="attr" stroke-dasharray="5 4"/><text x="84" y="308" class="attrt">derived</text>
    <text x="160" y="309" class="legt">Derived (computed) · double ellipse = multivalued</text>
    <line x1="560" y1="80" x2="660" y2="80" stroke="#334155" stroke-width="7"/><line x1="560" y1="80" x2="660" y2="80" stroke="#fff" stroke-width="3"/>
    <text x="680" y="86" class="legt">Total participation (NOT NULL FK)</text>
    <line x1="560" y1="128" x2="660" y2="128" stroke="#334155" stroke-width="1.6"/>
    <text x="680" y="134" class="legt">Partial participation (nullable FK)</text>
    <line x1="560" y1="176" x2="660" y2="176" stroke="#7c6fcf" stroke-width="1.6" stroke-dasharray="8 5"/>
    <text x="680" y="182" class="legt">Cross-database reference (MongoDB → PostgreSQL)</text>
    <text x="560" y="230" class="legt">1 / N / M = cardinality written beside each entity.</text>
    <text x="560" y="258" class="legt">Foreign-key columns are not drawn as attributes:</text>
    <text x="560" y="282" class="legt">in Chen notation they are the relationships.</text>
    <text x="560" y="320" class="legt">AFFECTS and CREWED BY are M:N relationships that become</text>
    <text x="560" y="344" class="legt">the tables disaster_locations and delivery_volunteers.</text>
  </g>`;
  const title = `<text x="40" y="70" class="title">ReliefFlow — Entity–Relationship Diagram (entire database)</text>
  <text x="40" y="104" class="sub">Generated from the live PostgreSQL catalog: ${model.tables.length} tables, ${model.fks.length} foreign keys, every relationship checked against a real FK · plus the MongoDB incident document</text>
  <rect x="2950" y="2980" width="1410" height="500" rx="12" fill="none" stroke="#cbd5e1" stroke-dasharray="6 6"/>
  <text x="2975" y="3015" class="legh">Stand-alone system tables (no relationships)</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">
<style>
  .ent{fill:#eaf1ff;stroke:#1d4ed8;stroke-width:2}
  .ent.ext{fill:#f3f0ff;stroke:#6d4fd8;stroke-dasharray:7 4}
  .entt{font-size:16px;font-weight:700;fill:#0f1e3d;text-anchor:middle;letter-spacing:.5px}
  .rel{fill:#fff7e6;stroke:#b45309;stroke-width:2}
  .rel.ext{fill:#f8f5ff;stroke:#6d4fd8;stroke-dasharray:7 4}
  .relt{font-size:12.5px;font-weight:700;fill:#7c2d12;text-anchor:middle}
  .attr{fill:#ffffff;stroke:#64748b;stroke-width:1.3}
  .attrt{font-size:12.5px;fill:#172033;text-anchor:middle}
  .attrt.small{font-size:11px}
  .card{font-size:17px;font-weight:800;fill:#dc2626;text-anchor:middle}
  .note{font-size:11px;fill:#6d4fd8;text-anchor:middle;font-style:italic}
  .title{font-size:34px;font-weight:800;fill:#0f1e3d}
  .sub{font-size:17px;fill:#475569}
  .legh{font-size:17px;font-weight:700;fill:#0f1e3d}
  .legt{font-size:14px;fill:#334155}
</style>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${title}
${lines.join("\n")}
${parts.join("\n")}
${rels.join("\n")}
${ents.join("\n")}
${legend}
</svg>`;
}

// ----------------------------------------------------------------------------------------
// Relational schema diagram
// ----------------------------------------------------------------------------------------
const layout: string[][] = [
  ["roles", "app_users", "sessions", "login_attempts", "audit_logs", "data_change_log"],
  ["locations", "disasters", "disaster_locations", "relief_camps", "integration_sync_runs"],
  ["resource_categories", "resources", "warehouses", "inventory", "inventory_movements", "schema_migrations"],
  ["resource_requests", "request_items", "allocations", "allocation_items"],
  ["vehicles", "volunteers", "deliveries", "delivery_volunteers"],
];
function schemaSvg(model: Awaited<ReturnType<typeof catalog>>) {
  const TW = 330, ROWH = 24, HEAD = 40, GAPX = 120, GAPY = 90;
  const colsOf = (t: string) => model.cols.filter((c) => c.table === t).sort((a, b) => a.pos - b.pos);
  const pos = new Map<string, { x: number; y: number; h: number }>();
  let y = 140;
  for (const row of layout) {
    let maxH = 0;
    row.forEach((t, i) => {
      const h = HEAD + colsOf(t).length * ROWH + 10;
      pos.set(t, { x: 130 + i * (TW + GAPX), y, h });
      maxH = Math.max(maxH, h);
    });
    y += maxH + GAPY;
  }
  for (const t of model.tables) if (!pos.has(t)) throw new Error(`Table ${t} missing from schema layout`);
  const W = 130 + 6 * (TW + GAPX), H = y + 110;
  const rowY = (t: string, col: string) => {
    const p = pos.get(t)!;
    const i = colsOf(t).findIndex((c) => c.name === col);
    return p.y + HEAD + i * ROWH + ROWH / 2 + 4;
  };
  const palette = ["#2563eb", "#0f9d8a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626"];
  const arrows: string[] = [];
  model.fks.forEach((f, i) => {
    const a = pos.get(f.child)!, b = pos.get(f.parent)!;
    const y1 = rowY(f.child, f.cols[0]), y2 = rowY(f.parent, f.refs[0]);
    const leftToRight = a.x <= b.x;
    const x1 = leftToRight && a.x !== b.x ? a.x + TW : a.x;
    const x2 = leftToRight && a.x !== b.x ? b.x : a.x === b.x ? b.x : b.x + TW;
    const out = a.x === b.x ? -(30 + (i % 4) * 12) : leftToRight ? 30 + (i % 5) * 10 : -(30 + (i % 5) * 10);
    const inn = a.x === b.x ? -(30 + (i % 4) * 12) : leftToRight ? -(30 + (i % 5) * 10) : 30 + (i % 5) * 10;
    const color = palette[i % palette.length];
    arrows.push(
      `<path d="M${x1},${y1} C${x1 + out * 2.2},${y1} ${x2 + inn * 2.2},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.7" opacity="0.85" marker-end="url(#arr${i % palette.length})"/>`,
      `<circle cx="${x1}" cy="${y1}" r="3.5" fill="${color}"/>`,
    );
  });
  const boxes = [...pos.entries()].map(([t, p]) => {
    const keys = model.pk[t] ?? [];
    const fkCols = new Set(model.fks.filter((f) => f.child === t).flatMap((f) => f.cols));
    const uniq = new Set((model.uq[t] ?? []).filter((u) => u.length === 1).map((u) => u[0]));
    const rows = colsOf(t)
      .map((c, i) => {
        const ry = p.y + HEAD + i * ROWH;
        const tags = [keys.includes(c.name) ? "PK" : "", fkCols.has(c.name) ? "FK" : "", uniq.has(c.name) ? "UQ" : ""].filter(Boolean).join(" ");
        return `<rect x="${p.x}" y="${ry}" width="${TW}" height="${ROWH}" fill="${i % 2 ? "#f8fafc" : "#ffffff"}"/>
<text x="${p.x + 10}" y="${ry + 16.5}" class="tag">${tags}</text>
<text x="${p.x + 58}" y="${ry + 16.5}" class="${keys.includes(c.name) ? "colk" : "col"}"${keys.includes(c.name) ? ' text-decoration="underline"' : ""}>${esc(c.name)}${c.nullable ? "" : " *"}</text>
<text x="${p.x + TW - 10}" y="${ry + 16.5}" class="type">${esc(c.type.replace("TIMESTAMP WITHOUT TIME ZONE", "TIMESTAMP"))}${c.generated ? " (gen)" : ""}</text>`;
      })
      .join("\n");
    return `<g><rect x="${p.x}" y="${p.y}" width="${TW}" height="${p.h}" rx="8" fill="#fff" stroke="#94a3b8" stroke-width="1.4"/>
<rect x="${p.x}" y="${p.y}" width="${TW}" height="${HEAD - 4}" rx="8" fill="#101b2d"/><rect x="${p.x}" y="${p.y + HEAD - 14}" width="${TW}" height="10" fill="#101b2d"/>
<text x="${p.x + 12}" y="${p.y + 24}" class="tname">${t}</text>
<text x="${p.x + TW - 12}" y="${p.y + 24}" class="tpk">PK (${esc((model.pk[t] ?? []).join(", "))})</text>
${rows}</g>`;
  });
  const fkList = model.fks
    .map((f, i) => `<text x="${60 + (i % 2) * 1350}" y="${y + 70 + Math.floor(i / 2) * 22}" class="fkl">${esc(`${f.child}(${f.cols.join(", ")}) → ${f.parent}(${f.refs.join(", ")})  ON DELETE ${f.onDelete}`)}</text>`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + Math.ceil(model.fks.length / 2) * 22}" viewBox="0 0 ${W} ${H + Math.ceil(model.fks.length / 2) * 22}" font-family="Segoe UI, Arial, sans-serif">
<defs>${palette.map((c, i) => `<marker id="arr${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}</defs>
<style>
  .tname{font-size:15px;font-weight:700;fill:#fff}
  .tpk{font-size:10.5px;fill:#93c5fd;text-anchor:end}
  .col{font-size:12.5px;fill:#172033}
  .colk{font-size:12.5px;fill:#b45309;font-weight:700}
  .type{font-size:11px;fill:#64748b;text-anchor:end;font-family:Consolas,monospace}
  .tag{font-size:10px;fill:#2563eb;font-weight:700}
  .title{font-size:34px;font-weight:800;fill:#0f1e3d}
  .sub{font-size:17px;fill:#475569}
  .fkl{font-size:13px;fill:#334155;font-family:Consolas,monospace}
  .legh{font-size:17px;font-weight:700;fill:#0f1e3d}
</style>
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="60" y="70" class="title">ReliefFlow — Relational Schema (entire PostgreSQL database)</text>
<text x="60" y="104" class="sub">${model.tables.length} tables · ${model.cols.length} columns · ${model.fks.length} foreign keys · PK underlined · * = NOT NULL · UQ = unique (alternate key) · arrows run from the foreign key to the referenced key</text>
${arrows.join("\n")}
${boxes.join("\n")}
<text x="60" y="${y + 36}" class="legh">All foreign keys (referential actions)</text>
${fkList}
</svg>`;
}

// ----------------------------------------------------------------------------------------
// draw.io (diagrams.net) export — native, editable mxGraph files
// ----------------------------------------------------------------------------------------
const xa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
class Mx {
  cells: string[] = [];
  private n = 2;
  id(prefix = "c") {
    return `${prefix}${this.n++}`;
  }
  vertex(id: string, value: string, style: string, x: number, y: number, w: number, h: number, parent = "1", extra = "") {
    this.cells.push(`<mxCell id="${id}" value="${xa(value)}" style="${style}" vertex="1" parent="${parent}"${extra}><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`);
    return id;
  }
  edge(id: string, source: string, target: string, style: string, points: [number, number][] = [], value = "") {
    const pts = points.length ? `<Array as="points">${points.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>` : "";
    this.cells.push(`<mxCell id="${id}" value="${xa(value)}" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`);
    return id;
  }
  edgeLabel(edgeId: string, value: string, x: number, style: string, offset: [number, number] = [0, 0]) {
    this.cells.push(`<mxCell id="${this.id("l")}" value="${xa(value)}" style="${style}" vertex="1" connectable="0" parent="${edgeId}"><mxGeometry x="${x}" relative="1" as="geometry"><mxPoint x="${offset[0]}" y="${offset[1]}" as="offset"/></mxGeometry></mxCell>`);
  }
  file(name: string, w: number, h: number) {
    return `<mxfile host="ReliefFlow generator" type="device"><diagram id="${name.replace(/\W/g, "")}" name="${xa(name)}"><mxGraphModel dx="1600" dy="1000" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0" background="#ffffff"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${this.cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
  }
}
const FONT = "fontFamily=Segoe UI;";
const TXT = `text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;${FONT}`;

function chenDrawio(model: Awaited<ReturnType<typeof catalog>>) {
  const W = 4400, H = 3520;
  const g = new Mx();
  const entW = (e: Ent) => Math.max(150, e.label.length * 10 + 40);
  const EH = 50;
  g.vertex("title", "ReliefFlow — Entity–Relationship Diagram (entire database)", `${TXT}fontSize=34;fontStyle=1;fontColor=#0f1e3d;`, 40, 30, 1600, 50);
  g.vertex("sub", `Chen notation · generated from the live PostgreSQL catalog: ${model.tables.length} tables, ${model.fks.length} foreign keys (every relationship checked against a real FK) · plus the MongoDB incident document`, `${TXT}fontSize=17;fontColor=#475569;`, 40, 80, 2400, 34);
  g.vertex("sysbox", "Stand-alone system tables (no relationships)", `rounded=1;arcSize=2;html=1;dashed=1;dashPattern=6 6;fillColor=none;strokeColor=#cbd5e1;align=left;verticalAlign=top;spacingLeft=20;spacingTop=12;fontStyle=1;fontSize=17;fontColor=#0f1e3d;${FONT}`, 2950, 2980, 1410, 500);
  // relationships (diamonds)
  const relId = (r: Rel) => `r_${r.id}`;
  for (const r of relationships) {
    const hw = Math.max(70, r.label.length * 7.4 + 34), hh = 34;
    const style = r.external
      ? `rhombus;whiteSpace=wrap;html=1;fillColor=#f8f5ff;strokeColor=#6d4fd8;dashed=1;fontStyle=1;fontSize=12;fontColor=#7c2d12;strokeWidth=2;${FONT}`
      : `rhombus;whiteSpace=wrap;html=1;fillColor=#fff7e6;strokeColor=#b45309;fontStyle=1;fontSize=12;fontColor=#7c2d12;strokeWidth=2;${FONT}`;
    g.vertex(relId(r), r.label, style, r.x - hw, r.y - hh, hw * 2, hh * 2);
    if (r.identifying) g.vertex(g.id("inner"), "", `rhombus;html=1;fillColor=none;strokeColor=#b45309;strokeWidth=1.5;connectable=0;`, r.x - hw + 12, r.y - hh + 7, hw * 2 - 24, hh * 2 - 14);
    if (r.note) g.vertex(g.id("note"), r.note, `${TXT}align=center;fontSize=11;fontStyle=2;fontColor=#6d4fd8;`, r.x - 120, r.y + hh + 2, 240, 20);
  }
  // entities
  for (const e of entities) {
    const w = entW(e);
    const base = `whiteSpace=wrap;html=1;fontStyle=1;fontSize=16;fontColor=#0f1e3d;strokeWidth=2;${FONT}`;
    const style = e.external
      ? `rounded=0;dashed=1;fillColor=#f3f0ff;strokeColor=#6d4fd8;${base}`
      : e.weak
        ? `shape=ext;double=1;rounded=0;fillColor=#eaf1ff;strokeColor=#1d4ed8;${base}`
        : `rounded=0;fillColor=#eaf1ff;strokeColor=#1d4ed8;${base}`;
    g.vertex(`e_${e.id}`, e.label, style, e.x - w / 2, e.y - EH / 2, w, EH);
    if (e.external) g.vertex(g.id("note"), "MongoDB document", `${TXT}align=center;fontSize=11;fontStyle=2;fontColor=#6d4fd8;`, e.x - 90, e.y + EH / 2 + 2, 180, 18);
  }
  // relationship edges with cardinality and participation
  for (const r of relationships) {
    for (const end of [r.a, r.b]) {
      const color = r.external ? "#7c6fcf" : "#334155";
      const style = end.total
        ? `shape=link;html=1;endArrow=none;startArrow=none;edgeStyle=none;strokeColor=${color};strokeWidth=1.5;width=4;${r.external ? "dashed=1;" : ""}`
        : `html=1;endArrow=none;startArrow=none;edgeStyle=none;strokeColor=${color};strokeWidth=1.6;${r.external ? "dashed=1;dashPattern=8 5;" : ""}`;
      const eid = g.edge(g.id("re"), relId(r), `e_${end.e}`, style, end.via ?? []);
      g.edgeLabel(eid, end.card, 0.78, `edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];fontSize=17;fontStyle=1;fontColor=#dc2626;labelBackgroundColor=#ffffff;${FONT}`, [0, -14]);
    }
    for (const a of r.attrs ?? []) {
      const rx = Math.max(38, a.name.length * 3.9 + 16), ry = 17;
      const aid = g.vertex(g.id("ra"), a.name, `ellipse;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#64748b;fontSize=12.5;fontColor=#172033;${FONT}`, r.x + a.dx - rx, r.y + a.dy - ry, rx * 2, ry * 2);
      g.edge(g.id("rae"), aid, relId(r), `html=1;endArrow=none;edgeStyle=none;strokeColor=#64748b;`);
    }
  }
  // attributes (positions from the collision-relaxed SVG layout)
  for (const a of erAttrs) {
    const label = a.attr.partial ? `<span style="text-decoration: underline dashed;">${xa(a.attr.name)}</span>` : a.attr.name;
    const style = [
      a.attr.multi ? "shape=doubleEllipse;" : "ellipse;",
      "whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#64748b;fontColor=#172033;",
      a.attr.key ? "fontStyle=4;" : "",
      a.attr.derived ? "dashed=1;dashPattern=5 4;" : "",
      `fontSize=${a.small ? 11 : 12.5};${FONT}`,
    ].join("");
    g.vertex(`at_${a.key}`, a.attr.partial ? label : a.attr.name, style, a.cx - a.rx, a.cy - a.ry, a.rx * 2, a.ry * 2);
  }
  for (const a of erAttrs) {
    const target = a.parentKey ? `at_${a.parentKey}` : `e_${a.owner}`;
    g.edge(g.id("ae"), `at_${a.key}`, target, `html=1;endArrow=none;edgeStyle=none;strokeColor=#94a3b8;`);
  }
  // legend
  const lx = 40, ly = 3080;
  g.vertex("legend", "Notation (Chen)", `rounded=1;arcSize=3;html=1;fillColor=#f8fafc;strokeColor=#cbd5e1;align=left;verticalAlign=top;spacingLeft=20;spacingTop=12;fontStyle=1;fontSize=17;fontColor=#0f1e3d;${FONT}`, lx, ly, 1080, 400);
  const leg: [string, string, number, number, number, number, string][] = [
    ["ENTITY", "rounded=0;fillColor=#eaf1ff;strokeColor=#1d4ed8;fontStyle=1;", 24, 64, 120, 40, "Strong entity (own primary key)"],
    ["WEAK", "shape=ext;double=1;rounded=0;fillColor=#eaf1ff;strokeColor=#1d4ed8;fontStyle=1;", 24, 120, 120, 40, "Weak entity (identified through its owners)"],
    ["REL", "rhombus;fillColor=#fff7e6;strokeColor=#b45309;fontStyle=1;", 24, 172, 120, 52, "Relationship · double diamond = identifying"],
    ["key", "ellipse;fillColor=#ffffff;strokeColor=#64748b;fontStyle=4;", 26, 240, 116, 34, "Attribute · underlined = key · dashed underline = partial key"],
    ["derived", "ellipse;dashed=1;fillColor=#ffffff;strokeColor=#64748b;", 26, 288, 116, 34, "Derived attribute · double ellipse = multivalued"],
  ];
  for (const [v, st, x, y, w, h, text] of leg) {
    g.vertex(g.id("lg"), v, `${st}whiteSpace=wrap;html=1;fontSize=12;${FONT}`, lx + x, ly + y, w, h);
    g.vertex(g.id("lt"), text, `${TXT}fontSize=14;fontColor=#334155;`, lx + 160, ly + y, 380, h);
  }
  const lines: [string, string, number][] = [
    ["shape=link;html=1;endArrow=none;strokeColor=#334155;width=4;", "Total participation (NOT NULL FK)", 80],
    ["html=1;endArrow=none;strokeColor=#334155;", "Partial participation (nullable FK)", 128],
    ["html=1;endArrow=none;strokeColor=#7c6fcf;dashed=1;dashPattern=8 5;", "Cross-database reference (MongoDB → PostgreSQL)", 176],
  ];
  for (const [st, text, y] of lines) {
    const a = g.vertex(g.id("p"), "", "point;html=1;", lx + 560, ly + y, 1, 1);
    const b = g.vertex(g.id("p"), "", "point;html=1;", lx + 660, ly + y, 1, 1);
    g.edge(g.id("le"), a, b, st);
    g.vertex(g.id("lt"), text, `${TXT}fontSize=14;fontColor=#334155;`, lx + 680, ly + y - 14, 380, 28);
  }
  g.vertex(g.id("lt"), "1 / N / M = cardinality beside each entity. Foreign-key columns are not drawn as attributes: in Chen notation they are the relationships. AFFECTS and CREWED BY are M:N relationships that become the tables disaster_locations and delivery_volunteers.", `${TXT}fontSize=14;fontColor=#334155;verticalAlign=top;`, lx + 560, ly + 215, 500, 160);
  return { xml: g.file("ER Diagram", W, H), W, H };
}

function schemaDrawio(model: Awaited<ReturnType<typeof catalog>>) {
  const g = new Mx();
  const TW = 340, ROWH = 26, HEAD = 34, GAPX = 150, GAPY = 90;
  const colsOf = (t: string) => model.cols.filter((c) => c.table === t).sort((a, b) => a.pos - b.pos);
  g.vertex("title", "ReliefFlow — Relational Schema (entire PostgreSQL database)", `${TXT}fontSize=34;fontStyle=1;fontColor=#0f1e3d;`, 60, 30, 1600, 50);
  g.vertex("sub", `${model.tables.length} tables · ${model.cols.length} columns · ${model.fks.length} foreign keys · PK underlined · * = NOT NULL · UQ = unique (alternate key) · crow's foot = many, bar = one, circle = optional`, `${TXT}fontSize=17;fontColor=#475569;`, 60, 80, 2600, 34);
  const rowId = new Map<string, string>();
  let y = 150;
  layout.forEach((row) => {
    let maxH = 0;
    row.forEach((t, i) => {
      const cols = colsOf(t);
      const h = HEAD + cols.length * ROWH;
      const x = 60 + i * (TW + GAPX);
      const tid = `t_${t}`;
      g.vertex(tid, t, `shape=table;startSize=${HEAD};container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=left;spacingLeft=10;resizeLast=1;html=1;whiteSpace=wrap;fillColor=#101b2d;fontColor=#ffffff;strokeColor=#94a3b8;swimlaneFillColor=#ffffff;fontSize=15;${FONT}`, x, y, TW, h);
      const keys = model.pk[t] ?? [];
      const fkCols = new Set(model.fks.filter((f) => f.child === t).flatMap((f) => f.cols));
      const uniq = new Set((model.uq[t] ?? []).filter((u) => u.length === 1).map((u) => u[0]));
      cols.forEach((c, j) => {
        const rid = `${tid}__${c.name}`;
        rowId.set(`${t}.${c.name}`, rid);
        const isPk = keys.includes(c.name);
        g.vertex(rid, "", `shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=${j % 2 ? "#f8fafc" : "#ffffff"};collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=${isPk && !keys.includes(cols[j + 1]?.name ?? "") ? 1 : 0};strokeColor=#cbd5e1;html=1;`, 0, HEAD + j * ROWH, TW, ROWH, tid);
        const tag = [isPk ? "PK" : "", fkCols.has(c.name) ? "FK" : "", uniq.has(c.name) ? "UQ" : ""].filter(Boolean).join(",");
        const cell = `shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;overflow=hidden;whiteSpace=wrap;html=1;${FONT}`;
        g.vertex(`${rid}_k`, tag, `${cell}fontStyle=1;fontSize=10;fontColor=#2563eb;align=center;`, 0, 0, 50, ROWH, rid);
        g.vertex(`${rid}_n`, `${c.name}${c.nullable ? "" : " *"}`, `${cell}align=left;spacingLeft=6;fontSize=12.5;${isPk ? "fontStyle=5;fontColor=#b45309;" : "fontColor=#172033;"}`, 50, 0, 175, ROWH, rid);
        g.vertex(`${rid}_t`, `${c.type}${c.generated ? " (gen)" : ""}`, `${cell}align=right;spacingRight=8;fontSize=10.5;fontColor=#64748b;fontFamily=Consolas;`, 225, 0, TW - 225, ROWH, rid);
      });
      maxH = Math.max(maxH, h);
    });
    y += maxH + GAPY;
  });
  // foreign keys as crow's-foot connectors between the actual columns
  const palette = ["#2563eb", "#0f9d8a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626"];
  model.fks.forEach((f, i) => {
    const src = rowId.get(`${f.child}.${f.cols[0]}`)!, dst = rowId.get(`${f.parent}.${f.refs[0]}`)!;
    const nullable = f.cols.some((c) => model.cols.find((x) => x.table === f.child && x.name === c)!.nullable);
    const end = nullable ? "ERzeroToOne" : "ERmandOne";
    const label = f.cols.length > 1 ? `(${f.cols.join(", ")})` : "";
    const eid = g.edge(`fk_${i}`, src, dst, `edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERzeroToMany;endArrow=${end};startFill=0;endFill=0;strokeColor=${palette[i % palette.length]};strokeWidth=1.5;fontSize=10;`, [], "");
    if (label) g.edgeLabel(eid, label, 0, `edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];fontSize=10;fontColor=${palette[i % palette.length]};labelBackgroundColor=#ffffff;${FONT}`, [0, -10]);
  });
  // referential actions list
  g.vertex("fkh", "All foreign keys (referential actions)", `${TXT}fontSize=17;fontStyle=1;fontColor=#0f1e3d;`, 60, y + 10, 800, 30);
  const half = Math.ceil(model.fks.length / 2);
  [model.fks.slice(0, half), model.fks.slice(half)].forEach((list, col) => {
    g.vertex(
      g.id("fkl"),
      list.map((f) => xa(`${f.child}(${f.cols.join(", ")}) → ${f.parent}(${f.refs.join(", ")})  ON DELETE ${f.onDelete}`)).join("<br>"),
      `${TXT}fontSize=13;fontColor=#334155;fontFamily=Consolas;verticalAlign=top;`,
      60 + col * 1400,
      y + 50,
      1380,
      half * 22 + 10,
    );
  });
  const W = 60 + 6 * (TW + GAPX), H = y + 70 + half * 22;
  return { xml: g.file("Relational Schema", W, H), W, H };
}

/** Render a .drawio file to PNG + PDF with the official draw.io viewer library (client-side rendering). */
async function renderDrawio(xml: string, w: number, h: number, pngFile: string, pdfFile: string) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: w + 40, height: h + 40 } });
    const cfg = JSON.stringify({ xml, highlight: "none", nav: false, resize: false, toolbar: "", lightbox: false, "auto-fit": false, zoom: 1 });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}@page{size:${w}px ${h}px;margin:0}</style></head><body><div class="mxgraph" style="width:${w}px" data-mxgraph="${xa(cfg)}"></div><script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script></body></html>`,
      { waitUntil: "load", timeout: 120000 },
    );
    await page.waitForSelector(".mxgraph svg", { timeout: 120000 });
    await page.waitForTimeout(1500);
    const box = await page.evaluate(() => {
      const s = document.querySelector(".mxgraph svg") as SVGSVGElement;
      const r = s.getBoundingClientRect();
      return { x: r.x, y: r.y, w: Math.ceil(r.width), h: Math.ceil(r.height) };
    });
    await page.setViewportSize({ width: Math.max(box.w, w) + 40, height: Math.max(box.h, h) + 40 });
    await page.screenshot({ path: pngFile, clip: { x: box.x, y: box.y, width: box.w, height: box.h }, timeout: 180000 });
    // PDF from the rendered image (vector PDF of the viewer page is unreliable at this size)
    const { readFileSync } = await import("fs");
    const png = readFileSync(pngFile).toString("base64");
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}@page{size:${box.w}px ${box.h}px;margin:0}img{display:block;width:${box.w}px;height:${box.h}px}</style></head><body><img src="data:image/png;base64,${png}"></body></html>`);
    await page.pdf({ path: pdfFile, width: `${box.w}px`, height: `${box.h}px`, printBackground: true, pageRanges: "1" });
  } finally {
    await browser.close();
  }
}

async function render(svgFile: string, pngFile: string, pdfFile: string) {
  const { chromium } = await import("@playwright/test");
  const { readFileSync } = await import("fs");
  const svg = readFileSync(svgFile, "utf8");
  const w = Number(/width="(\d+)"/.exec(svg)![1]);
  const h = Number(/height="(\d+)"/.exec(svg)![1]);
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#fff}svg{display:block}@page{size:${w}px ${h}px;margin:0}</style></head><body>${svg}</body></html>`);
    await page.screenshot({ path: pngFile, clip: { x: 0, y: 0, width: w, height: h }, timeout: 180000 });
    await page.pdf({ path: pdfFile, width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: "1" });
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const model = await catalog();
  // ---- consistency checks between the curated ER model and the real database
  const covered = new Set<string>();
  for (const r of relationships) {
    if (r.fk) {
      const f = model.fks.find((x) => x.name === r.fk);
      if (!f) throw new Error(`Relationship ${r.id} refers to unknown FK ${r.fk}`);
      const ents = [r.a.e, r.b.e].map((id) => entities.find((e) => e.id === id)!.table);
      if (!ents.includes(f.child) || !ents.includes(f.parent)) throw new Error(`Relationship ${r.id} does not match ${r.fk}`);
      const childEnd = entities.find((e) => e.table === f.child)!.id === r.a.e ? r.a : r.b;
      const nullable = f.cols.some((c) => model.cols.find((x) => x.table === f.child && x.name === c)!.nullable);
      if (childEnd.total === nullable) throw new Error(`Participation of ${r.id} disagrees with nullability of ${r.fk}`);
      covered.add(r.fk);
    }
    if (r.table) relationshipTables[r.table].forEach((fk) => covered.add(fk));
  }
  const missing = model.fks.filter((f) => !covered.has(f.name)).map((f) => f.name);
  if (missing.length) throw new Error("Foreign keys not represented in the ER diagram: " + missing.join(", "));
  const tablesInEr = new Set([...entities.map((e) => e.table).filter(Boolean), ...Object.keys(relationshipTables)]);
  const notInEr = model.tables.filter((t) => !tablesInEr.has(t));
  if (notInEr.length) throw new Error("Tables missing from ER diagram: " + notInEr.join(", "));

  const er = resolve(OUT, "ReliefFlow-ER-Diagram.svg");
  const rs = resolve(OUT, "ReliefFlow-Relational-Schema.svg");
  writeFileSync(er, chenSvg(model));
  writeFileSync(rs, schemaSvg(model));
  writeFileSync(resolve(OUT, "schema-snapshot.json"), JSON.stringify({ generatedAt: new Date().toISOString(), tables: model.tables, columns: model.cols, primaryKeys: model.pk, uniqueKeys: model.uq, foreignKeys: model.fks }, null, 2));
  await render(er, er.replace(".svg", ".png"), er.replace(".svg", ".pdf"));
  await render(rs, rs.replace(".svg", ".png"), rs.replace(".svg", ".pdf"));
  // native draw.io versions (editable in draw.io / diagrams.net / VS Code Draw.io extension)
  const erD = chenDrawio(model);
  const rsD = schemaDrawio(model);
  const erFile = resolve(OUT, "ReliefFlow-ER-Diagram.drawio");
  const rsFile = resolve(OUT, "ReliefFlow-Relational-Schema.drawio");
  writeFileSync(erFile, erD.xml);
  writeFileSync(rsFile, rsD.xml);
  if (!process.env.SKIP_DRAWIO_RENDER) {
    await renderDrawio(erD.xml, erD.W, erD.H, erFile.replace(".drawio", ".drawio.png"), erFile.replace(".drawio", ".drawio.pdf"));
    await renderDrawio(rsD.xml, rsD.W, rsD.H, rsFile.replace(".drawio", ".drawio.png"), rsFile.replace(".drawio", ".drawio.pdf"));
  }
  console.log(`ER: ${entities.length} entities, ${relationships.length} relationships · schema: ${model.tables.length} tables, ${model.cols.length} columns, ${model.fks.length} FKs (all covered)`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
