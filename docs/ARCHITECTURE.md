# Architecture

## Layers

```
Browser (React client components)
   │  fetch('/api/...')  JSON, same-origin, httpOnly session cookie
   ▼
Next.js route handlers  (src/app/api/**/route.ts)
   │  endpoint(): request id · access log · error → status mapping · cache invalidation after writes
   │  actor():    session lookup (SHA-256 token) · role check · same-origin check on writes
   │  Zod:        strict schemas, unexpected fields rejected
   │  transaction(): BEGIN · lock_timeout · set_config('reliefflow.user_id') · COMMIT/ROLLBACK
   ▼
PostgreSQL (source of truth) ── constraints · triggers · views · functions · procedure
MongoDB    (incident documents)
Redis      (derived cache, rate limits)          ┐
Neo4j      (graph projection of PostgreSQL)      ├ optional; each degrades independently
pgvector   (derived embeddings)                  ┘
reliefflow_lab (sandbox copy for the DBMS lab; every transaction rolled back)
```

The browser never talks to a database and never makes an authoritative decision about stock, fulfilment or permissions; the UI only mirrors rules that the API and database enforce.

## Data ownership and consistency

| Store | Owns | Consistency rule |
|---|---|---|
| PostgreSQL `reliefflow` | users, sessions, disasters, locations, camps, warehouses, inventory, requests, allocations, deliveries, vehicles, volunteers, audit | ACID. Multi-step workflows run in one transaction. |
| MongoDB `incident_reports` | incident narratives, tags, embedded field updates | Single-document atomicity. `disasterId` is checked against PostgreSQL before insert (application-level reference). |
| Redis | nothing authoritative | `rf:cache:*` keys have TTLs and are deleted after every successful write. If Redis fails, an in-process map is used. |
| Neo4j | nothing authoritative | Explicit, manager-triggered full refresh inside one Neo4j transaction, 3 attempts with backoff, outcome stored in `integration_sync_runs`. A failed sync leaves the previous complete graph. |
| pgvector (`reliefflow_vectors`) | nothing authoritative | Explicit re-embed of incidents, requests and disasters, recorded in `integration_sync_runs`; replaced atomically per provider. |
| `reliefflow_lab` | a sanitised copy | Rebuilt on demand (read-only on production). No e-mails, phones or password hashes are copied. |

There is no distributed transaction across these systems and the project does not claim one.

## Concurrency strategy

* **Lock order** (prevents deadlocks): request row → request lines → inventory rows sorted by (warehouse_id, resource_id). Both the API and `validate_allocation_item()` follow it.
* **Row locks**: `SELECT … FOR UPDATE` on stock, requests, vehicles, drivers; `FOR SHARE` on parents that must not close mid-operation.
* **Atomic relative updates**: camp admissions (`current_population = current_population + n` with the capacity check in the same statement) and stock adjustments.
* **Database backstops**: partial unique indexes (one active delivery per allocation / vehicle / driver), CHECK constraints, state-machine triggers.
* **Optimistic concurrency**: edits carry `row_version` (PostgreSQL `xmin`); stock adjustments may carry `expected_quantity`. A mismatch returns `409 STALE_RECORD`.

## Security

* bcrypt (cost 12) password hashes; opaque random 256-bit session tokens stored only as SHA-256 hashes; 8-hour expiry; logout, role change, deactivation and password reset revoke sessions.
* Login throttling: 10 attempts per e-mail per 15 minutes; constant-work comparison against a dummy hash for unknown accounts.
* Cookies: `HttpOnly`, `SameSite=Strict`, `Secure` in production. Writes require `Origin`/`Sec-Fetch-Site` to be same-origin and `Content-Type: application/json`.
* All SQL is parameterised. The only dynamic identifiers are table names taken from a fixed allow-list.
* Errors never leak SQL, stack traces or raw database messages (except deliberate business-rule messages raised by our own triggers).
* SQL playground: authenticated, rate-limited, static guard (single statement, allow-listed statement types, blocked commands and functions), separate database, non-superuser role without CREATE on `public`, statement/lock/idle timeouts, temp-file limit, forced ROLLBACK and `DISCARD ALL`.

## Observability

* One JSON log line per API request: `requestId`, method, path, kind, status, duration. Error responses return the same `requestId`.
* `GET /api/health`: PostgreSQL (required, 503 if down), MongoDB (required, `degraded` if down), Redis, Neo4j, vector store and lab (optional, reported individually with latency; never change the core status).
* The top bar shows live service dots; the Lab overview shows a status table.

## Frontend

* App shell with grouped, collapsible sidebar (remembered per browser), tooltips when collapsed, mobile drawer, breadcrumb, service health and user menu.
* Design tokens in `globals.css`; reusable `Button`, `Badge` (colour always paired with text), `Card`, `Kpi`, `DataTable` (search, filters, sorting, pagination, empty/error/loading states), accessible `Modal`/drawer (focus trap, Escape, focus restore), `Toast` (`role=status`/`alert`) and `Confirm` dialogs.
* Motion via `motion/react` for page transitions, card entrances, dialogs and toasts; all disabled under `prefers-reduced-motion`.
* Charts (recharts) use a palette validated for colour-vision deficiency (blue / orange / aqua), with legends, direct labels, tooltips and table alternatives.
