"use client";
import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/primitives";
import { Concept } from "@/components/lab/LabKit";

const fileVsDb = [
  ["Redundancy", "Each office keeps its own spreadsheet of stock; copies drift apart.", "One inventory table; every screen reads the same row."],
  ["Integrity", "Nothing stops a negative stock figure being typed.", "CHECK (quantity_available >= 0) and triggers reject it."],
  ["Concurrency", "Two coordinators editing the same file overwrite each other.", "Row locks (SELECT … FOR UPDATE) serialise allocations."],
  ["Atomicity", "A crash half-way through updating two files leaves them inconsistent.", "Allocation + stock deduction + history commit together or not at all."],
  ["Security", "File permissions are all-or-nothing.", "Roles, sessions and per-endpoint checks; the lab uses a restricted DB role."],
  ["Querying", "Custom code for every question.", "Declarative SQL: joins, aggregates, views, window functions."],
  ["Recovery", "Manual backups, if any.", "Write-ahead log and pg_dump backups."],
];

export default function Concepts() {
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 1" title="Database Concepts" lead="The ideas behind a DBMS, each tied to the concrete ReliefFlow object that implements it." />
      <div className="stack">
        <div className="grid g-2">
          <Concept title="Purpose of a DBMS">
            A DBMS stores shared data once and lets many users and programs read and change it safely. ReliefFlow needs this because
            disaster data is written concurrently by field officers, coordinators and drivers, and mistakes (double-allocating the last
            water tanker) have real consequences. PostgreSQL provides storage, a query language, integrity constraints, transactions,
            concurrency control, security and recovery.
          </Concept>
          <Concept title="Advantages">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Controlled redundancy and consistency (normalised tables).</li>
              <li>Integrity enforced centrally (keys, FKs, CHECKs, triggers).</li>
              <li>Atomic, isolated transactions; durable commits (WAL).</li>
              <li>Data independence: views and indexes change without changing applications.</li>
              <li>Ad-hoc querying, reporting and analytics in SQL.</li>
              <li>Fine-grained security and auditing (audit_logs, data_change_log).</li>
            </ul>
          </Concept>
        </div>
        <Card title="Database vs file system" subtitle="The same requirements, handled two ways">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Concern</th><th>Files / spreadsheets</th><th>ReliefFlow on PostgreSQL</th></tr></thead>
              <tbody>{fileVsDb.map(([a, b, c]) => <tr key={a}><td className="cell-main">{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Three-schema architecture" subtitle="External, conceptual and internal levels — with ReliefFlow's actual objects at each level">
          <svg viewBox="0 0 900 360" style={{ width: "100%", height: "auto" }} role="img" aria-label="Three-schema architecture diagram">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" /></marker>
            </defs>
            {[
              ["Coordinator view", "v_resource_demand, v_request_fulfillment", 40],
              ["Warehouse view", "v_low_stock, v_warehouse_inventory_summary", 330],
              ["Command view", "v_disaster_response_summary, operational_summary()", 620],
            ].map(([t, s, x]) => (
              <g key={String(t)}>
                <rect x={Number(x)} y={20} width={240} height={70} rx={10} fill="#eff4ff" stroke="#bfd2fb" />
                <text x={Number(x) + 120} y={48} textAnchor="middle" fontSize="14" fontWeight="650" fill="#172033">{t}</text>
                <text x={Number(x) + 120} y={70} textAnchor="middle" fontSize="11" fill="#475569">{s}</text>
                <line x1={Number(x) + 120} y1={92} x2={450} y2={148} stroke="#94a3b8" markerEnd="url(#arr)" />
              </g>
            ))}
            <text x={12} y={12} fontSize="11" fill="#64748b" fontWeight="650">EXTERNAL LEVEL (views)</text>
            <rect x={150} y={150} width={600} height={80} rx={12} fill="#e7f7f4" stroke="#9fdccf" />
            <text x={450} y={180} textAnchor="middle" fontSize="15" fontWeight="650" fill="#172033">Conceptual schema</text>
            <text x={450} y={202} textAnchor="middle" fontSize="11.5" fill="#475569">tables · primary / foreign keys · CHECK constraints · triggers (disasters, camps, inventory, requests, allocations…)</text>
            <text x={12} y={146} fontSize="11" fill="#64748b" fontWeight="650">CONCEPTUAL / LOGICAL LEVEL</text>
            <line x1={450} y1={232} x2={450} y2={278} stroke="#94a3b8" markerEnd="url(#arr)" />
            <rect x={150} y={280} width={600} height={66} rx={12} fill="#f1f5f9" stroke="#cbd5e1" />
            <text x={450} y={306} textAnchor="middle" fontSize="15" fontWeight="650" fill="#172033">Internal schema</text>
            <text x={450} y={327} textAnchor="middle" fontSize="11.5" fill="#475569">heap files & 8 KB pages · B-tree / GIN / HNSW indexes · write-ahead log · MVCC tuple versions (xmin)</text>
            <text x={12} y={276} fontSize="11" fill="#64748b" fontWeight="650">INTERNAL / PHYSICAL LEVEL</text>
          </svg>
          <p className="small muted" style={{ marginTop: 8 }}>
            <b>Logical data independence:</b> adding a column to <code>inventory</code> does not break <code>v_low_stock</code> users.
            <b> Physical data independence:</b> migration 007 added 16 indexes without changing a single query.
          </p>
        </Card>
        <div className="grid g-3">
          <Concept title="Views of data">
            <b>Physical</b>: how rows are stored (pages, indexes). <b>Logical</b>: what tables, columns and relationships exist.
            <b> View level</b>: tailored subsets for each user group — ReliefFlow drivers only ever see their own deliveries, enforced
            in the query <code>WHERE d.driver_id = $2</code>.
          </Concept>
          <Concept title="Application architecture">
            Three-tier: <b>presentation</b> (React pages in the browser) → <b>application</b> (Next.js route handlers: auth, Zod
            validation, business rules) → <b>data</b> (PostgreSQL, MongoDB, Redis, Neo4j, pgvector). Browsers never connect to a
            database directly. See <Link href="/lab/integration">Next.js ↔ SQL</Link> for a timed trace.
          </Concept>
          <Concept title="Data models">
            ReliefFlow is <b>polyglot</b>: relational for transactions, document (MongoDB) for flexible incident reports, key-value
            (Redis) for caching, graph (Neo4j) for relationship queries and vectors (pgvector) for similarity search. PostgreSQL remains
            the source of truth.
          </Concept>
        </div>
        <Card title="ER modelling vocabulary, applied" subtitle="Explore the live model in the ER Explorer">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Concept</th><th>Meaning</th><th>In ReliefFlow</th></tr></thead>
              <tbody>
                {[
                  ["Entity / entity set", "A thing with independent existence", "disasters, relief_camps, warehouses, resources"],
                  ["Attribute", "A property of an entity", "relief_camps.capacity, resources.unit"],
                  ["Composite / derived attribute", "Made of parts / computed", "locations (latitude, longitude); occupancy_pct is derived, not stored"],
                  ["Multivalued attribute", "Many values per entity", "incident tags (stored as an array in MongoDB; would need its own table in SQL)"],
                  ["Relationship", "Association between entities", "disaster AFFECTS location; camp RAISES request"],
                  ["Cardinality 1:N", "One parent, many children", "relief_camps 1 — N resource_requests"],
                  ["Cardinality M:N", "Resolved with an associative table", "disasters M — N locations via disaster_locations (+ impact_level)"],
                  ["Total participation", "Every child must participate", "resource_requests.camp_id NOT NULL"],
                  ["Partial participation", "Participation is optional", "relief_camps.manager_id is nullable"],
                  ["Weak entity", "Identified through its owner", "request_items (PK = request_id + resource_id)"],
                ].map(([a, b, c]) => <tr key={a}><td className="cell-main">{a}</td><td>{b}</td><td>{c}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Keys" subtitle="Run the live key catalogue in the SQL Explorer → Keys & constraints">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Key</th><th>Definition</th><th>Example</th></tr></thead>
              <tbody>
                {[
                  ["Super key", "Any attribute set that uniquely identifies a row", "{user_id, email}, {user_id}"],
                  ["Candidate key", "A minimal super key", "app_users: {user_id} and {email}"],
                  ["Primary key", "The chosen candidate key", "app_users.user_id (identity)"],
                  ["Alternate key", "Candidate keys not chosen as primary", "app_users.email, vehicles.vehicle_number (UNIQUE)"],
                  ["Composite key", "A key of several attributes", "inventory (warehouse_id, resource_id)"],
                  ["Foreign key", "References a key in another table", "allocation_items (warehouse_id, resource_id) → inventory"],
                  ["Surrogate vs natural", "System-generated vs meaningful", "request_id (surrogate) vs vehicle_number (natural)"],
                ].map(([a, b, c]) => <tr key={a}><td className="cell-main">{a}</td><td>{b}</td><td><code>{c}</code></td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
