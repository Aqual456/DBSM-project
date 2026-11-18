# ReliefFlow 2.0

Disaster relief and resource allocation platform, built as a DBMS course project. It coordinates disasters, affected locations, relief camps, warehouses, stock, resource requests, allocations, deliveries, vehicles, volunteers and field incident reports. A built-in **Database Engineering Lab** demonstrates all four units of the DBMS syllabus with real, executable examples on ReliefFlow's own data.

| | |
|---|---|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Zod, motion, recharts, Leaflet |
| Source of truth | PostgreSQL 16: constraints, triggers, views, functions, procedures, row locks |
| Documents | MongoDB 7: incident reports, JSON-Schema validation, text index, aggregation |
| Key-value (optional) | Redis 7: dashboard cache + rate limits, with in-memory fallback |
| Graph (optional) | Neo4j 5: a projection of the response network, queried with Cypher |
| Vectors (optional) | PostgreSQL + pgvector: similarity search over incidents, requests, disasters |
| Lab sandbox | Separate `reliefflow_lab` database, least-privilege `rf_lab` role, every run rolled back |

**Viva pack:** ER diagram ([draw.io](docs/viva/ReliefFlow-ER-Diagram.drawio), [PDF](docs/viva/ReliefFlow-ER-Diagram.drawio.pdf)) · Relational schema ([draw.io](docs/viva/ReliefFlow-Relational-Schema.drawio), [PDF](docs/viva/ReliefFlow-Relational-Schema.drawio.pdf)) · [Project & viva guide](docs/viva/ReliefFlow-Viva-Guide.pdf) (regenerate with `npm run viva:diagrams` and `npm run viva:guide`)

Documentation: [Architecture](docs/ARCHITECTURE.md) · [Database design](docs/DATABASE_DESIGN.md) · [API](docs/API_DOCUMENTATION.md) · [Syllabus mapping](docs/DBMS_SYLLABUS_MAPPING.md) · [Testing report](docs/TESTING_REPORT.md)

## Quick start (existing installation, data preserved)

Requirements: Node.js 20.9+ and Docker Desktop (or your own PostgreSQL 16 and MongoDB 7).

```powershell
docker compose up -d                       # PostgreSQL + MongoDB (existing volumes are reused)
docker compose --profile optional up -d --no-deps redis neo4j vectordb   # optional services
npm.cmd ci
npm.cmd run db:migrate                     # incremental migrations 005-007, each applied once
npm.cmd run mongo:indexes                  # validator + indexes, existing documents kept
npm.cmd run lab:setup                      # builds the isolated lab database from a sanitised snapshot
npm.cmd run dev                            # http://localhost:3000
```

`db:migrate` records applied files in `schema_migrations`; it never drops or rewrites operational data. New constraints that legacy rows violate are added `NOT VALID`.

### Optional: demo dataset

```powershell
npm.cmd run db:demo
```

Adds five disasters (Kerala, Assam, Odisha, Uttarakhand, Karnataka), ten locations with coordinates, camps, warehouses, stock, vehicles, volunteers, eleven requests across every lifecycle stage and twenty MongoDB incident reports. It **only inserts** clearly named rows (descriptions tagged `[ReliefFlow demo dataset]`, incidents with `source: "demo-dataset"`), goes through the real triggers, runs in one transaction, and does nothing if the dataset is already present. Demo staff accounts (`*@reliefflow.demo`) have no usable password; an admin can set one under **Administration → Users → Password**. Re-run `npm.cmd run lab:setup` afterwards so the lab sees the new rows.

### Configuration

`.env` (yours, never overwritten): `DATABASE_URL`, `MONGODB_URI`, `MONGODB_DB`, `COOKIE_SECURE`.

`.env.local` (optional services; delete a line to switch that integration off):

```
REDIS_URL=redis://localhost:6379
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=reliefflow-graph-dev
VECTOR_DATABASE_URL=postgresql://postgres:reliefflow-vector-dev@localhost:5433/reliefflow_vectors
# VOYAGE_API_KEY=...  or  OPENAI_API_KEY=...   (semantic embeddings; otherwise a labelled lexical fallback is used)
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
npm.cmd test                               # 25 unit tests (no database needed)
npm.cmd run build
npm.cmd run test:integration               # 28 end-to-end checks incl. Playwright (needs a build, PostgreSQL, MongoDB, Chrome)
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

Every rule is enforced by the API (and the database where possible); hidden buttons are a convenience, not the protection.

## Project layout

```
db/postgres/          001 schema · 002 seed · 003/004 coursework scripts · 005-007 incremental migrations
db/mongodb/           incident JSON Schema validator
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
