# API documentation

All endpoints are same-origin JSON under `/api`. Authentication is the `rf_session` httpOnly cookie set by `POST /api/auth`. Writes (POST/PATCH/DELETE) must be same-origin and, for POST/PATCH, use `Content-Type: application/json`. Request bodies are validated with **strict** Zod schemas: unknown fields are rejected.

## Responses

Success: the resource as JSON (`200`). Every response has an `x-request-id` header.

Errors:

```json
{ "error": "Human-readable, safe message", "code": "VALIDATION_ERROR", "requestId": "uuid", "details": [{ "path": "items.0.quantity_requested", "message": "…" }] }
```

| Status | code | When |
|---|---|---|
| 400 | VALIDATION_ERROR, MALFORMED_JSON, INVALID_VALUE, INVALID_REFERENCE, SQL_REJECTED | Bad input |
| 401 | UNAUTHENTICATED, SESSION_EXPIRED, INVALID_CREDENTIALS | No/expired session; wrong credentials |
| 403 | FORBIDDEN, CSRF_REJECTED | Wrong role; cross-site write |
| 404 | NOT_FOUND | Unknown record / module |
| 405 | NOT_ALLOWED | Delete not permitted for that record type |
| 409 | BUSINESS_RULE, DUPLICATE, REFERENCE_VIOLATION, CONSTRAINT_VIOLATION, INVALID_TRANSITION, STALE_RECORD, CAPACITY_EXCEEDED, DEADLOCK, SERIALIZATION_FAILURE, LOCK_TIMEOUT | Rule or concurrency conflict |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | Body > 256 KB / not JSON |
| 429 | RATE_LIMITED | Login throttling, lab and search limits |
| 503 | SERVICE_UNAVAILABLE, SERVICE_DISABLED, LAB_UNAVAILABLE | Database down / optional service not configured |
| 504 | QUERY_TIMEOUT | Statement timeout |

Roles: **A** admin, **C** relief coordinator, **F** field officer, **D** driver. "Staff" = A, C, F.

## Authentication

| Method & path | Roles | Body / query | Result |
|---|---|---|---|
| `POST /api/auth` | public | `{ email, password }` | Sets cookie; `{ signedIn: true }` |
| `GET /api/auth` | any | — | `{ user_id, full_name, email, role_name }` |
| `DELETE /api/auth` | any | — | Revokes the session; clears cookie |

## Operations

| Method & path | Roles | Notes |
|---|---|---|
| `GET /api/dashboard` | Staff | `{ kpi, severity, demand, stockTrend, requestTrend, deliveryStatus, campLoad, stockByUnit, incidents, activity, cache: { hit, loadMs } }`. Cached 30 s. |
| `GET /api/disasters[?q=]` | Staff | List with response summary; `q` = full-text search (`websearch_to_tsquery`) |
| `GET /api/disasters?id=` | Staff | Detail: locations, camps, requests |
| `POST /api/disasters` / `PATCH` | A, C | `{ disaster_name, disaster_type, severity, started_at, event_location_id, description?, status? }` (+ `disaster_id` for PATCH) |
| `GET /api/requests[?status=&q=]` | Staff | With items (`v_request_fulfillment`) and `fulfillment_pct` |
| `GET /api/requests?id=` | Staff | Detail: allocations, deliveries, status history |
| `POST /api/requests` | Staff | `{ camp_id, disaster_id, need_by, priority_level?, priority_score?, medical_emergency?, remarks?, items: [{ resource_id, quantity_requested }] }` |
| `PATCH /api/requests` | A, C | `{ request_id, status: APPROVED \| REJECTED \| CANCELLED }` |
| `GET /api/request-options` | Staff | Camps, disasters, resources, locations, categories, warehouses for forms |
| `GET /api/incidents` | Staff | `?q=&severity=&reportType=&status=&disasterId=&page=&pageSize=` → `{ items, total, page, pageSize, search }`; `?stats=1` → aggregation facets |
| `POST /api/incidents` | Staff | `{ disasterId, reportType, description, location: { label, latitude?, longitude? }, severity, tags? }` |
| `PATCH /api/incidents` | Staff | `{ id, note?, status? }` (appends an embedded update) |
| `GET /api/intelligence` | Staff | Shortages, excess stock, priority requests, availability by location, coverage |
| `GET /api/intelligence?requestId=` | Staff | Explainable allocation recommendations (never auto-applied) |
| `GET /api/map` | Staff | Disasters, camps, warehouses with coordinates |
| `GET /api/health` | public | Service status; 503 only if PostgreSQL is down |

### `/api/operations?kind=…`

Generic master data (`GET` list, `POST` create, `POST` with key = update, `DELETE ?id=` where allowed):

| kind | Write roles | Fields | Delete |
|---|---|---|---|
| camps | A, C | camp_name, location_id, capacity, current_population, status | — |
| warehouses | A, C | warehouse_name, location_id, capacity, status | — |
| locations | A, C | location_name, location_type, address, latitude?, longitude? | yes (if unreferenced) |
| vehicles | A, C | vehicle_number, vehicle_type, capacity, status | yes |
| volunteers | A, C | full_name, phone, email, skills, availability_status | yes (no delivery history) |
| resources | A, C | resource_name, category_id, unit, is_perishable | yes |
| categories | A, C | category_name, description | yes |

Updates may include `row_version` (from the list response); if the row changed since, the result is `409 STALE_RECORD`.

Read-only kinds: `users` (A), `roles` (A), `drivers` (A, C), `inventory`, `movements`, `allocations`, `disaster-locations` (Staff), `audit`, `changes` (A, C), `deliveries` (any; drivers see only their own).

Commands (`POST`):

| kind | Roles | Body |
|---|---|---|
| inventory | A, C | `{ warehouse_id, resource_id, delta, minimum_threshold, reason, expected_quantity? }` |
| allocations | A, C | `{ request_id, items: [{ warehouse_id, resource_id, quantity_allocated }], remarks? }` |
| allocation-cancel | A, C | `{ allocation_id }` (only while ALLOCATED, no active delivery) |
| deliveries | A, C | `{ allocation_id, vehicle_id, driver_id, expected_arrival, volunteer_ids? }` |
| delivery-status | A, C, own driver | `{ delivery_id, status: IN_TRANSIT \| DELAYED \| DELIVERED \| CANCELLED }` (drivers cannot cancel) |
| camp-occupancy | Staff | `{ camp_id, delta }` (atomic; 409 CAPACITY_EXCEEDED) |
| disaster-locations | A, C | `{ disaster_id, location_id, impact_level, affected_population }` (upsert) |
| users | A | `{ full_name, email, password, role_name }` |
| user-role | A | `{ user_id, role_name, is_active }` (revokes sessions; last active admin protected) |
| user-password | A | `{ user_id, password }` (revokes sessions) |
| user-sessions-revoke | A | `{ user_id }` |

## Integrations

| Method & path | Roles | Notes |
|---|---|---|
| `GET /api/graph` | Staff | Status, sync runs, available Cypher queries |
| `GET /api/graph?query=&disasterId=&warehouseId=` | Staff | Runs one fixed, parameterised query → `{ rows, graph: { nodes, edges }, ms }` |
| `POST /api/graph` | A, C | Sync PostgreSQL → Neo4j |
| `GET /api/vector` | Staff | Provider, counts, sync runs, query plan |
| `GET /api/vector?q=&source=` | Staff | Nearest neighbours + MongoDB keyword results (30/min) |
| `POST /api/vector` | A, C | Re-embed documents |

## DBMS lab

| Method & path | Roles | Notes |
|---|---|---|
| `GET /api/lab/demos[?unit=]` | any | Catalogue (sections, demos with SQL and algebra) |
| `POST /api/lab/demos` | any | `{ id }` → step results; always rolled back (60/min) |
| `POST /api/lab/sql` | any | `{ sql }` → guarded single statement in the sandbox (30/min) |
| `GET/POST /api/lab/concurrency` | any | List / run `{ id }` two-session scenario → timeline |
| `GET/POST /api/lab/mongo` | any (reset: A, C) | List / run `{ id }` MongoDB demo on the lab copy |
| `GET/POST /api/lab/cache` | any (invalidate: A, C) | Inspect keys / `{ action: benchmark \| invalidate }` |
| `GET /api/lab/er` | any | Live ER model from the catalog |
| `POST /api/lab/trace` | any | `{ quantity? }` → timed pipeline trace (rolled back) |
| `GET /api/lab/setup` | any | Snapshot status |
| `POST /api/lab/setup` | A | Rebuild the lab snapshot |
