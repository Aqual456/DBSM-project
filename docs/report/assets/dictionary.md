#### allocation_items

Allocation lines: how much of which resource from which warehouse (immutable).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| allocation_item_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| allocation_id | BIGINT | FK | NOT NULL | Composite FK (allocation_id, request_id) to allocations. |
| request_id | BIGINT | FK | NOT NULL | Shared by two composite FKs: ties the line to its request line. |
| resource_id | BIGINT | FK | NOT NULL | Composite FK part to request_items and inventory. |
| warehouse_id | BIGINT | FK | NOT NULL | Composite FK part to inventory (the stock drawn from). |
| quantity_allocated | NUMERIC(14,3) |  | NOT NULL | Quantity committed (> 0, <= stock and outstanding demand). |

#### allocations

Commitment of stock to a request.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| allocation_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| request_id | BIGINT | FK | NOT NULL | FK to the request being fulfilled. |
| allocated_by | BIGINT | FK | NOT NULL | FK to the coordinator who allocated. |
| allocated_at | TIMESTAMPTZ |  | NOT NULL | When stock was committed. |
| status | VARCHAR(20) |  | NOT NULL | ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED (stock restored). |
| remarks | TEXT |  | NULL | Optional notes. |

#### app_users

People who can sign in. Passwords are stored only as bcrypt hashes.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| user_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| role_id | BIGINT | FK | NOT NULL | FK to roles: the user's single role. |
| full_name | VARCHAR(120) |  | NOT NULL | Display name. |
| email | VARCHAR(254) |  | NOT NULL | Login e-mail (alternate key, format-checked). |
| password_hash | TEXT |  | NOT NULL | bcrypt hash (cost 12); readable only by rf_admin. |
| phone | VARCHAR(25) |  | NULL | Optional unique phone number. |
| is_active | BOOLEAN |  | NOT NULL | FALSE blocks sign-in and invalidates sessions. |
| created_at | TIMESTAMPTZ |  | NOT NULL | When the account was created. |

#### audit_logs

Application audit trail, written in the same transaction as each change.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| audit_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| user_id | BIGINT | FK | NULL | FK to the acting user. |
| action | TEXT |  | NOT NULL | Operation code, e.g. ALLOCATIONS, DELIVERY_STATUS. |
| details | JSONB |  | NOT NULL | JSON input and result of the operation (passwords removed). |
| created_at | TIMESTAMPTZ |  | NOT NULL | When the action happened. |

#### data_change_log

Row-level change history written by the log_row_change() trigger.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| change_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| table_name | TEXT |  | NOT NULL | Table that changed. |
| operation | TEXT |  | NOT NULL | INSERT, UPDATE or DELETE. |
| row_data | JSONB |  | NULL | Row after (or before, for DELETE) the change, without secrets. |
| changed_fields | JSONB |  | NULL | JSON diff {field: {from, to}} for UPDATEs. |
| changed_by | BIGINT |  | NULL | Acting user id taken from the reliefflow.user_id session setting. |
| txid | BIGINT |  | NOT NULL | Transaction id, groups changes made together. |
| changed_at | TIMESTAMPTZ |  | NOT NULL | When the change happened. |

#### deliveries

Transport of one allocation (row-level security: drivers see only their own).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| delivery_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| allocation_id | BIGINT | FK | NOT NULL | FK to the allocation transported (one active delivery each). |
| vehicle_id | BIGINT | FK | NOT NULL | FK to the vehicle (one active delivery each). |
| driver_id | BIGINT | FK | NOT NULL | FK to the driver (one active delivery each). |
| source_location_id | BIGINT | FK | NOT NULL | FK: pickup location (warehouse). |
| destination_location_id | BIGINT | FK | NOT NULL | FK: drop location (camp). |
| departure_time | TIMESTAMPTZ |  | NULL | Set when dispatched. |
| expected_arrival | TIMESTAMPTZ |  | NULL | Planned arrival. |
| actual_arrival | TIMESTAMPTZ |  | NULL | Set when delivered. |
| status | VARCHAR(20) |  | NOT NULL | PLANNED → IN_TRANSIT ↔ DELAYED → DELIVERED, or PLANNED → CANCELLED (trigger-enforced). |

#### delivery_volunteers

M:N: volunteers crewing a delivery.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| delivery_id | BIGINT | PK, FK | NOT NULL | PK part / FK to deliveries (cascade). |
| volunteer_id | BIGINT | PK, FK | NOT NULL | PK part / FK to volunteers (cascade). |
| assigned_role | VARCHAR(60) |  | NOT NULL | Role on the delivery, e.g. LOADING_SUPPORT. |

#### disaster_locations

M:N: which locations a disaster affects, with impact attributes.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| disaster_id | BIGINT | PK, FK | NOT NULL | PK part / FK to disasters. |
| location_id | BIGINT | PK, FK | NOT NULL | PK part / FK to locations. |
| impact_level | VARCHAR(20) |  | NOT NULL | LOW, MODERATE, HIGH or SEVERE. |
| affected_population | INTEGER |  | NOT NULL | People affected at this location (>= 0). |
| reported_at | TIMESTAMPTZ |  | NOT NULL | When the impact was reported. |

#### disasters

Disaster events being responded to.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| disaster_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| disaster_name | VARCHAR(160) |  | NOT NULL | Event name (duplicate events rejected by trigger). |
| disaster_type | VARCHAR(50) |  | NOT NULL | FLOOD, CYCLONE, EARTHQUAKE, ... |
| severity | VARCHAR(20) |  | NOT NULL | LOW, MODERATE, HIGH or CRITICAL. |
| started_at | TIMESTAMPTZ |  | NOT NULL | When the event started. |
| ended_at | TIMESTAMPTZ |  | NULL | When it was closed (must be after started_at). |
| status | VARCHAR(20) |  | NOT NULL | ACTIVE, CONTAINED or CLOSED. |
| description | TEXT |  | NULL | Free-text situation summary. |
| created_by | BIGINT | FK | NOT NULL | FK to the coordinator who registered it. |
| created_at | TIMESTAMPTZ |  | NOT NULL | Registration time. |
| event_location_id | BIGINT | FK | NULL | FK to the main event location. |
| search_vector | TSVECTOR |  | NULL | Generated tsvector for full-text search (GIN indexed). |

#### integration_sync_runs

One row per Neo4j / vector synchronisation run.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| run_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| target | TEXT |  | NOT NULL | neo4j or vector. |
| status | TEXT |  | NOT NULL | RUNNING, SUCCEEDED or FAILED. |
| attempts | INTEGER |  | NOT NULL | Attempts used (max 3). |
| records_synced | INTEGER |  | NOT NULL | Records written to the target. |
| detail | TEXT |  | NULL | Summary or failure reason. |
| triggered_by | BIGINT | FK | NULL | FK to the user who started the sync. |
| started_at | TIMESTAMPTZ |  | NOT NULL | Start time. |
| finished_at | TIMESTAMPTZ |  | NULL | End time (NULL while running). |

#### inventory

Stock line: quantity of one resource in one warehouse (weak entity).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| warehouse_id | BIGINT | PK, FK | NOT NULL | PK part / FK to warehouses. |
| resource_id | BIGINT | PK, FK | NOT NULL | PK part / FK to resources. |
| quantity_available | NUMERIC(14,3) |  | NOT NULL | Units on hand (CHECK >= 0). |
| minimum_threshold | NUMERIC(14,3) |  | NOT NULL | Low-stock alert level. |
| last_updated | TIMESTAMPTZ |  | NOT NULL | Time of the last stock change. |

#### inventory_movements

Every stock change with its reason (written by trigger).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| movement_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| warehouse_id | BIGINT | FK | NOT NULL | Composite FK part to inventory. |
| resource_id | BIGINT | FK | NOT NULL | Composite FK part to inventory. |
| delta | NUMERIC(14,3) |  | NOT NULL | Signed change (+ received, - dispatched). |
| reason | TEXT |  | NOT NULL | Why stock changed. |
| created_at | TIMESTAMPTZ |  | NOT NULL | When it changed. |

#### locations

Places: districts, camp areas, depots. Coordinates drive the map and distances.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| location_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| location_name | VARCHAR(160) |  | NOT NULL | Name of the place. |
| location_type | VARCHAR(40) |  | NOT NULL | DISTRICT, CAMP_AREA, DEPOT, WARD, ... |
| address | TEXT |  | NOT NULL | Postal/landmark address. |
| latitude | NUMERIC(9,6) |  | NULL | WGS-84 latitude (-90..90). |
| longitude | NUMERIC(9,6) |  | NULL | WGS-84 longitude (-180..180). |

#### login_attempts

Login throttling window per e-mail.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| email | TEXT | PK | NOT NULL | Normalised e-mail being attempted (primary key). |
| attempts | INTEGER |  | NOT NULL | Failed attempts in the current window. |
| window_start | TIMESTAMPTZ |  | NOT NULL | Start of the 15-minute window. |

#### relief_camps

Shelters with capacity and current occupancy.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| camp_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| location_id | BIGINT | FK | NOT NULL | FK to the camp location. |
| camp_name | VARCHAR(160) |  | NOT NULL | Camp name. |
| capacity | INTEGER |  | NOT NULL | Maximum people (> 0). |
| current_population | INTEGER |  | NOT NULL | People sheltered now (0..capacity). |
| manager_id | BIGINT | FK | NULL | Optional FK to the managing user. |
| status | VARCHAR(20) |  | NOT NULL | OPEN, FULL (= at capacity) or CLOSED (= empty). |
| established_at | DATE |  | NOT NULL | Opening date. |

#### request_items

Lines of a request: resource and quantity (weak entity).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| request_id | BIGINT | PK, FK | NOT NULL | PK part / FK to resource_requests (cascade). |
| resource_id | BIGINT | PK, FK | NOT NULL | PK part / FK to resources. |
| quantity_requested | NUMERIC(14,3) |  | NOT NULL | Quantity asked for (> 0). |

#### resource_categories

Groups of resources (FOOD, WATER, MEDICAL, ...).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| category_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| category_name | VARCHAR(80) |  | NOT NULL | Unique category code. |
| description | TEXT |  | NULL | Description. |

#### resource_requests

A camp's request for resources (header).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| request_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| camp_id | BIGINT | FK | NOT NULL | FK to the requesting camp. |
| disaster_id | BIGINT | FK | NOT NULL | FK to the disaster it relates to. |
| requested_by | BIGINT | FK | NOT NULL | FK to the field officer who raised it (taken from the session). |
| requested_at | TIMESTAMPTZ |  | NOT NULL | When it was raised. |
| need_by | TIMESTAMPTZ |  | NOT NULL | Deadline (must be after requested_at). |
| priority_score | NUMERIC(5,2) |  | NOT NULL | Priority 0..100. |
| priority_level | VARCHAR(20) |  | NOT NULL | LOW, MEDIUM, HIGH or CRITICAL. |
| status | VARCHAR(20) |  | NOT NULL | PENDING → APPROVED → PARTIALLY_FULFILLED/ALLOCATED → IN_TRANSIT → DELIVERED, or REJECTED/CANCELLED. |
| medical_emergency | BOOLEAN |  | NOT NULL | Flag that moves the request to the top. |
| remarks | TEXT |  | NULL | Situation notes. |
| search_vector | TSVECTOR |  | NULL | Generated tsvector over remarks (GIN indexed). |

#### resources

Catalogue of relief items, each with a unit of measure.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| resource_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| category_id | BIGINT | FK | NOT NULL | FK to resource_categories. |
| resource_name | VARCHAR(120) |  | NOT NULL | Item name (unique within its category). |
| unit | VARCHAR(30) |  | NOT NULL | Unit of measure: kg, litre, kit, piece ... |
| description | TEXT |  | NULL | Optional notes. |
| is_perishable | BOOLEAN |  | NOT NULL | TRUE for items with limited shelf life. |

#### roles

Application roles (ADMIN, RELIEF_COORDINATOR, FIELD_OFFICER, DRIVER).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| role_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| role_name | VARCHAR(40) |  | NOT NULL | Unique role code used for authorisation. |
| description | TEXT |  | NULL | Human-readable description of the role. |

#### schema_migrations

Applied migration files (each runs once).

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| filename | TEXT | PK | NOT NULL | Migration file name (primary key). |
| applied_at | TIMESTAMPTZ |  | NOT NULL | When it was applied. |

#### sessions

Server-side sessions. Only the SHA-256 hash of the cookie token is stored.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| token_hash | TEXT | PK | NOT NULL | SHA-256 of the random session token (primary key). |
| user_id | BIGINT | FK | NOT NULL | FK to app_users (cascade delete). |
| expires_at | TIMESTAMPTZ |  | NOT NULL | Absolute expiry (8 hours after sign-in). |

#### vehicles

Fleet used for deliveries.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| vehicle_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| vehicle_number | VARCHAR(30) |  | NOT NULL | Registration number (alternate key). |
| vehicle_type | VARCHAR(50) |  | NOT NULL | TRUCK, VAN, BOAT, ... |
| capacity | NUMERIC(14,2) |  | NOT NULL | Load capacity (> 0). |
| status | VARCHAR(20) |  | NOT NULL | AVAILABLE, IN_USE or MAINTENANCE. |
| current_location_id | BIGINT | FK | NULL | Optional FK to the last known location. |

#### volunteers

Volunteers who can crew deliveries.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| volunteer_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| full_name | VARCHAR(120) |  | NOT NULL | Name. |
| phone | VARCHAR(25) |  | NOT NULL | Unique phone (format-checked). |
| email | VARCHAR(254) |  | NULL | Optional unique e-mail (format-checked). |
| skills | TEXT |  | NULL | Free-text skills. |
| availability_status | VARCHAR(20) |  | NOT NULL | AVAILABLE, ASSIGNED or UNAVAILABLE. |
| registered_at | TIMESTAMPTZ |  | NOT NULL | Registration time. |

#### warehouses

Storage sites holding stock.

| Column | Type | Key | Null | Description |
|---|---|---|---|---|
| warehouse_id | BIGINT | PK | NOT NULL | Surrogate primary key. |
| location_id | BIGINT | FK | NOT NULL | FK to the warehouse location. |
| warehouse_name | VARCHAR(160) |  | NOT NULL | Name (unique per location via trigger). |
| manager_id | BIGINT | FK | NULL | Optional FK to the managing user. |
| capacity | NUMERIC(14,2) |  | NOT NULL | Storage capacity (> 0). |
| status | VARCHAR(20) |  | NOT NULL | ACTIVE, INACTIVE or MAINTENANCE; only ACTIVE supplies stock. |
