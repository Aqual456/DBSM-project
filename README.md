# ReliefFlow 2.0

Disaster relief and resource allocation platform, built as a DBMS course project. It coordinates disasters, affected locations, relief camps, warehouses, stock, resource requests, allocations, deliveries, vehicles, volunteers and field incident reports. A built-in **Database Engineering Lab** demonstrates all four units of the DBMS syllabus with real, executable examples on ReliefFlow's own data.

| | |
|---|---|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Zod, motion, recharts, Leaflet |
| Source of truth | PostgreSQL 16: constraints, triggers, views, functions, procedures, row locks, database roles + row-level security |
| Documents | MongoDB 7: incident reports, JSON-Schema validation, text index, aggregation |
| Key-value (optional) | Redis 7: dashboard cache + rate limits, with in-memory fallback |
| Graph (optional) | Neo4j 5: a projection of the response network, queried with Cypher |
| Vectors (optional) | PostgreSQL + pgvector (HNSW, cosine): semantic search with local all-MiniLM-L6-v2 embeddings (384-d, no API key) |
| Lab sandbox | Separate `reliefflow_lab` database, least-privilege `rf_lab` role, every run rolled back |

**Viva pack (print-ready, one A3 landscape sheet each):** ER diagram ([draw.io](docs/viva/ReliefFlow-ER-Diagram.drawio), [A3 PDF](docs/viva/ReliefFlow-ER-Diagram.drawio.pdf)) · Relational schema ([draw.io](docs/viva/ReliefFlow-Relational-Schema.drawio), [A3 PDF](docs/viva/ReliefFlow-Relational-Schema.drawio.pdf)) · [Project & viva guide](docs/viva/ReliefFlow-Viva-Guide.pdf) (regenerate with `npm run viva:diagrams` and `npm run viva:guide`)

**Course submission:** [Project report (PDF)](docs/report/ReliefFlow-Project-Report.pdf) · [Team explanation & presentation guide (PDF)](docs/report/ReliefFlow-Team-Explanation.pdf) · [The database, explained: tables, relationships, DDL, DML, triggers (PDF)](docs/report/ReliefFlow-Database-Explained.pdf) · runnable [MongoDB commands](db/mongodb/incident_commands.mongosh.js) · [pgvector commands](db/vector/pgvector_commands.sql) (regenerate with `npm run report:assets`, `npm run report:shots` and `npm run report:build`)

**Team:** SUJAL Y (relational database, transactions, security, workflow APIs) · SUJAN H (MongoDB, vector search, Redis, Neo4j, Next.js interface, testing)

Documentation: [Architecture](docs/ARCHITECTURE.md) · [Database design](docs/DATABASE_DESIGN.md) · [API](docs/API_DOCUMENTATION.md) · [Syllabus mapping](docs/DBMS_SYLLABUS_MAPPING.md) · [Testing report](docs/TESTING_REPORT.md)

## Quick start (existing installation, data preserved)

Requirements: Node.js 20.9+ and Docker Desktop (or your own PostgreSQL 16 and MongoDB 7).

```powershell
docker compose up -d                       # PostgreSQL + MongoDB (existing volumes are reused)
docker compose --profile optional up -d --no-deps redis neo4j vectordb   # optional services
npm.cmd ci
npm.cmd run db:migrate                     # incremental migrations 005-008, each applied once
npm.cmd run mongo:indexes                  # validator + indexes, existing documents kept
npm.cmd run lab:setup                      # builds the isolated lab database from a sanitised snapshot
npm.cmd run dev                            # http://localhost:3000
```

`db:migrate` records applied files in `schema_migrations`; it never drops or rewrites operational data. New constraints that legacy rows violate are added `NOT VALID`.

### Standard sample data

```powershell
npm.cmd run db:seed
```

Loads the reference catalogue from `db/postgres/002_seed.sql` (roles and 21 relief items whose units and planning figures follow the Sphere humanitarian minimum standards) and a **fictional** present-day scenario set: six emergencies in real Indian districts (Periyar River Floods, Cyclone Tara, Dhemaji Flash Floods, Nichar Landslide, Vidarbha Heatwave, Chennai Urban Flooding), 15 locations with coordinates, 8 camps, 5 warehouses with stock, 8 vehicles, 12 volunteers, 14 requests covering every workflow stage (pending, approved, partially fulfilled, allocated, in transit, delivered, rejected) and 20 MongoDB incident reports. Quantities use Sphere figures (for example 7.5 L of drinking and cooking water and 0.4 kg of cereal per person per day). Every allocation and delivery goes through the real triggers. The script only inserts, runs in one transaction, does nothing if the sample data is already present, and then re-syncs the vector and graph stores. Sample staff accounts (`*@reliefflow.sample`) have no usable password; an admin can set one under **Administration → Users → Password**. Re-run `npm.cmd run lab:setup` afterwards so the lab sees the new rows.

To start again from an empty operational database (destructive, take a backup first): `npm.cmd run db:clear-example-data -- --yes`, then `npm.cmd run db:seed`. It keeps roles and every non-sample user account.

### Configuration

`.env` (yours, never overwritten): `DATABASE_URL`, `MONGODB_URI`, `MONGODB_DB`, `COOKIE_SECURE`.

`.env.local` (optional services; delete a line to switch that integration off):

```
REDIS_URL=redis://localhost:6379
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=reliefflow-graph-dev
VECTOR_DATABASE_URL=postgresql://postgres:reliefflow-vector-dev@localhost:5433/reliefflow_vectors
# VOYAGE_API_KEY=...  or  OPENAI_API_KEY=...   (optional hosted embeddings; by default the local MiniLM model is
#                                                downloaded once to .cache/models; EMBEDDING_PROVIDER=lexical forces the offline fallback)
# LAB_DATABASE_URL=... (override the derived lab connection)
```

The lab role's password is derived from `DATABASE_URL` (SHA-256), so no extra secret is stored. Passwords above are local Docker development defaults; use your own elsewhere.

### First administrator

```powershell
$env:ADMIN_EMAIL = 'admin@reliefflow.local'
$cred = Get-Credential -UserName $env:ADMIN_EMAIL -Message 'Initial administrator password (12+ chars)'
$env:ADMIN_PASSWORD = $cred.GetNetworkCredential().Password
npm.cmd run db:admin
Remove-Item Env:ADMIN_PASSWORD
```

Existing working passwords are never reset by this script.

## Fresh installation

```powershell
docker compose up -d
Copy-Item .env.example .env                # only if no .env exists
npm.cmd ci
Get-Content db/postgres/001_schema.sql -Raw | docker exec -i reliefflow-postgres psql -U postgres -d reliefflow -v ON_ERROR_STOP=1
Get-Content db/postgres/002_seed.sql  -Raw | docker exec -i reliefflow-postgres psql -U postgres -d reliefflow -v ON_ERROR_STOP=1
npm.cmd run db:migrate
npm.cmd run mongo:indexes
npm.cmd run db:admin                       # see "First administrator"
npm.cmd run lab:setup
```

## Production run

```powershell
npm.cmd run build
npm.cmd run start                          # set COOKIE_SECURE=true behind HTTPS
```

## Tests

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd test                               # 27 unit tests (no database needed)
npm.cmd run build
npm.cmd run test:integration               # 30 end-to-end checks incl. RBAC/RLS and Playwright (needs a build, PostgreSQL, MongoDB, Chrome)
npm.cmd run test:services                  # live Redis / Neo4j / pgvector checks (skips unconfigured services)
```

The integration suite creates a fresh `reliefflow_test_<timestamp>` database (PostgreSQL and MongoDB) for every run and never touches development data. Results: `docs/test-results.json`, `docs/services-test-results.json`; screenshots in `docs/screenshots/`.

## Roles

| Role | Can do |
|---|---|
| Administrator | Everything, plus users, roles, password resets, session revocation, lab snapshot rebuild |
| Relief coordinator | Disasters, camps, warehouses, stock, approvals, allocations, deliveries, graph/vector sync |
| Field officer | View operations, raise requests, report incidents, admit/discharge at camps |
| Driver | Own deliveries only (dispatch, delay, deliver) and the read-only lab |

Every rule is enforced twice: by the API, and by PostgreSQL itself. Each API transaction runs `SET LOCAL ROLE rf_admin | rf_coordinator | rf_field_officer | rf_driver` (migration 008), so table and column GRANTs and the row-level-security policy on `deliveries` apply (a driver's queries only ever see their own deliveries). See `/lab/security`. Hidden buttons are a convenience, not the protection.

## Project layout

```
db/postgres/          001 schema · 002 seed · 003/004 coursework scripts · 005-008 incremental migrations (008: roles, RLS, data dictionary)
db/mongodb/           incident JSON Schema validator · incident_commands.mongosh.js (all MongoDB commands, scratch DB)
db/vector/            pgvector_commands.sql (vector concepts + the real document_vectors table)
docs/report/          project report and team explanation (Markdown sources, HTML, PDF, generated assets)
scripts/              migrate, admin, mongo indexes, lab setup, demo data, integration + service tests
src/lib/              api (auth, errors, transactions), validation, cache, graph, vector, embeddings,
                      normalization (FD engine), lab/ (sandbox, demos, concurrency, mongo lab, SQL guard)
src/app/api/          route handlers (see docs/API_DOCUMENTATION.md)
src/app/              pages: command center, map, disasters, requests, incidents, intelligence, analytics,
                      manage/[module], lab/*
src/components/       shell, UI kit (DataTable, Modal, Toast, Confirm), charts, lab components, map
tests/                unit tests (node:test)
backups/              source and database backups taken before the 2.0 changes
```
