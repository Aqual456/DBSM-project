# Database design

The live, always-current ER diagram is in the app at **Lab → ER Explorer** (`/lab/er`). It is generated from `pg_constraint` and `information_schema`, so it cannot drift from the real schema. Exported diagrams from the earlier version remain in `docs/diagrams/`.

## Entities and keys

| Table | Primary key | Alternate / unique keys | Foreign keys (→ parent, on delete) |
|---|---|---|---|
| roles | role_id | role_name | — |
| app_users | user_id | email, phone | role_id → roles (RESTRICT) |
| sessions | token_hash | — | user_id → app_users (CASCADE) |
| login_attempts | email | — | — |
| locations | location_id | — | — |
| disasters | disaster_id | (name, type, start date, location) via trigger | created_by → app_users (RESTRICT); event_location_id → locations |
| disaster_locations | (disaster_id, location_id) | — | disaster_id → disasters (CASCADE); location_id → locations (RESTRICT) |
| relief_camps | camp_id | — | location_id → locations (RESTRICT); manager_id → app_users (SET NULL) |
| resource_categories | category_id | category_name | — |
| resources | resource_id | (category_id, resource_name) | category_id → resource_categories (RESTRICT) |
| warehouses | warehouse_id | (name, location) via trigger | location_id → locations (RESTRICT); manager_id → app_users (SET NULL) |
| inventory | (warehouse_id, resource_id) | — | warehouse_id → warehouses; resource_id → resources (RESTRICT) |
| inventory_movements | movement_id | — | (warehouse_id, resource_id) → inventory |
| resource_requests | request_id | — | camp_id → relief_camps; disaster_id → disasters; requested_by → app_users (RESTRICT) |
| request_items | (request_id, resource_id) | — | request_id → resource_requests (CASCADE); resource_id → resources (RESTRICT) |
| allocations | allocation_id | (allocation_id, request_id) | request_id → resource_requests; allocated_by → app_users (RESTRICT) |
| allocation_items | allocation_item_id | — | (allocation_id, request_id) → allocations (CASCADE); (request_id, resource_id) → request_items; (warehouse_id, resource_id) → inventory (RESTRICT) |
| vehicles | vehicle_id | vehicle_number | current_location_id → locations (SET NULL) |
| volunteers | volunteer_id | phone, email | — |
| deliveries | delivery_id | one active delivery per allocation / vehicle / driver (partial unique indexes) | allocation_id → allocations; vehicle_id → vehicles; driver_id → app_users; source/destination → locations (RESTRICT) |
| delivery_volunteers | (delivery_id, volunteer_id) | — | delivery_id → deliveries (CASCADE); volunteer_id → volunteers (CASCADE) |
| audit_logs | audit_id | — | user_id → app_users (RESTRICT) |
| data_change_log | change_id | — | — (changed_by is informational) |
| integration_sync_runs | run_id | — | triggered_by → app_users (SET NULL) |
| schema_migrations | filename | — | — |

## Relationships and cardinality

* disasters **M:N** locations via `disaster_locations` (relationship attributes: impact_level, affected_population, reported_at).
* resource_requests **M:N** resources via `request_items` (weak entity, composite key, attribute quantity_requested).
* warehouses **M:N** resources via `inventory` (attributes: quantity_available, minimum_threshold).
* deliveries **M:N** volunteers via `delivery_volunteers`.
* relief_camps 1:N resource_requests; disasters 1:N resource_requests; resource_requests 1:N allocations; allocations 1:N allocation_items; allocations 1:N deliveries (at most one active).
* Total participation where the FK is `NOT NULL` (e.g. every request belongs to a camp); partial where nullable (camp manager, vehicle location).
* `allocation_items` uses **composite foreign keys** so an allocation line can only reference a resource that was actually requested by that same request, and stock that actually exists in that warehouse.

## Integrity rules

| Rule | Enforced by |
|---|---|
| Stock never negative | `CHECK (quantity_available >= 0)` + validation trigger + API check |
| Allocation ≤ stock and ≤ outstanding demand | `validate_allocation_item()` (locks request, line, stock in fixed order) |
| Allocation history immutable; cancel only before dispatch | `validate_allocation_item()` rejects UPDATE/DELETE; `allocation_status_guard()` state machine; stock restored exactly once on cancel |
| Stock deducted automatically | `adjust_inventory_for_allocation()` |
| Every stock change recorded | `record_inventory_movement()` → `inventory_movements` |
| Delivery lifecycle PLANNED → IN_TRANSIT ↔ DELAYED → DELIVERED / PLANNED → CANCELLED | `delivery_status_guard()` (and API) |
| No delivery with a vehicle in maintenance | `delivery_vehicle_guard()` |
| One active delivery per vehicle / driver / allocation | partial unique indexes |
| Occupancy ≤ capacity; CLOSED ⇒ 0; FULL ⇔ at capacity | CHECKs (`camp_status_occupancy` is NOT VALID for legacy rows) |
| No duplicate disaster events / warehouses | `prevent_operational_duplicate()` with advisory locks |
| Every change to key tables audited with a field diff and actor | `log_row_change()` → `data_change_log` (password hashes excluded) |

## Views, functions, procedure

| Object | Purpose |
|---|---|
| `v_low_stock` | Lines at or below threshold |
| `v_request_fulfillment` | Requested / allocated / remaining per request line (cancelled allocations excluded) |
| `v_warehouse_inventory_summary` | Lines, units and low-stock count per warehouse |
| `v_resource_demand` | Open demand vs active stock per resource (shortage detection) |
| `v_disaster_response_summary` | Affected locations, population, requests and allocated units per disaster |
| `remaining_request_quantity(request, resource)` | Outstanding quantity for one line |
| `resource_availability(resource)` | Stock in ACTIVE warehouses |
| `request_fulfillment_pct(request)` | % of requested quantity allocated |
| `operational_summary()` | Set-returning KPI summary |
| `CALL refresh_request_status(request)` | Single source of truth for derived request status, used by the API |

## Indexes (selection)

FK indexes on every hot join (`allocations(request_id)`, `allocation_items(allocation_id)`, `deliveries(driver_id|vehicle_id|allocation_id)`, `relief_camps(location_id)`, …), composite `inventory_movements(warehouse_id, resource_id, created_at DESC)`, GIN full-text indexes on generated `tsvector` columns of `disasters` and `resource_requests`, a trigram GIN index on `locations.location_name`, and the three partial unique indexes above. In the vector store: a partial expression HNSW index `((embedding::vector(256)) vector_cosine_ops) WHERE provider = 'lexical-hash'`.

## MongoDB

Collection `incident_reports`, `$jsonSchema` validation (moderate, so legacy documents are kept): required `disasterId`, `reportedBy`, `reportType` (enum), `description` (10–10000 chars), embedded `location { label, latitude?, longitude? }`, `severity` (enum), timestamps; optional `status` (OPEN | MONITORING | RESOLVED), `tags[]`, embedded `updates[] { note, by, byName, at }`. Indexes: `{disasterId, createdAt}`, `{reportType, severity}`, `{status, createdAt}`, weighted text index on description/tags/location.

## Migrations

| File | Contents |
|---|---|
| 001_schema.sql | Base schema, views, original triggers |
| 002_seed.sql | Roles, categories, resources, two locations, placeholder admin |
| 003 / 004 | Coursework SQL demonstrations and the original operational demo data |
| 005_integrity_security.sql | Sessions, login throttling, audit, inventory history, duplicate guards, corrected allocation validation |
| 006_allocation_history.sql | Immutable allocation lines, cancellation state machine with exact-once stock restoration |
| 007_dbms_engineering.sql | FK indexes, partial unique indexes, delivery triggers, row-change audit, FTS columns, views, functions, procedure, sync bookkeeping, `schema_migrations` |

## Data quality findings (left untouched)

Existing rows that predate the newer rules were **not modified**:

* Camp #3 "test" is `CLOSED` with 99 occupants (violates `camp_status_occupancy`, which is therefore `NOT VALID`).
* Two warehouses named "Audit Warehouse 3" and two disasters named "test disaster 1" are duplicates created before the duplicate guard existed.

Correct them through the UI if they are not intended; the lab snapshot mirrors them faithfully.
