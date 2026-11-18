# ReliefFlow — Complete Project & Viva Guide

This guide explains the whole project in plain language: what it does, how the database is designed, what every table, key, trigger and screen means, how each DBMS syllabus topic appears in it, how to demo it, and how to answer the questions examiners usually ask.

Companion files in this folder:

* **ReliefFlow-ER-Diagram.drawio**: the conceptual model in Chen notation as an editable draw.io file (open it in draw.io desktop, app.diagrams.net or the VS Code "Draw.io Integration" extension). Rendered copies: `.drawio.png` / `.drawio.pdf`.
* **ReliefFlow-Relational-Schema.drawio**: every table, column, primary key and foreign key, built from draw.io's ER *Table* shapes with crow's-foot connectors. Rendered copies: `.drawio.png` / `.drawio.pdf`.
* The same two diagrams also exist as plain `.svg` / `.png` / `.pdf` (non-draw.io) for quick viewing.
* **schema-snapshot.json**: the machine-readable catalog the diagrams were generated from.

Both diagrams (draw.io and plain versions) are produced by `npm run viva:diagrams` from the live database, and the script fails if the diagram and the database disagree. You can say in the viva: *"The diagrams are generated from PostgreSQL's system catalog, so they cannot drift from the real schema."*

---

## 1. The 60-second pitch

> **ReliefFlow is a disaster relief coordination platform.** When a disaster happens, people are moved to relief camps. Camps raise **resource requests** (water, food, medicine). A coordinator **approves** a request, **allocates** stock from warehouses, and a driver **delivers** it. ReliefFlow tracks every step on one transactional PostgreSQL database, so stock can never be double-allocated or go negative, even when several coordinators work at the same time. Field reports are stored as flexible documents in MongoDB. Redis caches the dashboard, Neo4j shows the response network as a graph, and pgvector does similarity search. A built-in **Database Engineering Lab** demonstrates all four units of the DBMS syllabus by running real SQL on a safe copy of the project's own data.

Three things to stress:

1. **Correctness is enforced by the database**, not only by the screens: constraints, triggers, row locks and transactions.
2. **Academic coverage is executable**: about 70 SQL demonstrations, 9 concurrency scenarios, a live ER diagram and a normalisation engine.
3. **It is a usable product**: role-based screens, dashboard, map, workflow, responsive design and automated tests.

---

## 2. The problem and the users

During a disaster, relief work usually runs on phone calls and spreadsheets. The result is duplicate requests, two people promising the same last truckload of water, and no one knowing what reached which camp. ReliefFlow replaces that with one shared, consistent database.

| Role | What they do in ReliefFlow |
|---|---|
| **Administrator** | Manages users and roles, resets passwords, revokes sessions, rebuilds the lab snapshot; can do everything a coordinator can. |
| **Relief coordinator** | Registers disasters, camps and warehouses, adjusts stock, approves or rejects requests, allocates stock, plans deliveries, syncs the graph and vector stores. |
| **Field officer** | Raises resource requests for camps, reports incidents, admits and discharges people at camps, views operations. |
| **Driver** | Sees only their own deliveries and updates their progress (dispatched, delayed, delivered). |

---

## 3. The main workflow, step by step

This is the heart of the project. Learn this sequence; most questions come back to it.

| Step | What happens | Tables touched | What protects it |
|---|---|---|---|
| 1. Disaster registered | Coordinator records the event and its location. | `disasters` | Duplicate-event trigger; CHECK on severity and status. |
| 2. Affected locations recorded | Which places are affected and how many people. | `disaster_locations` (M:N) | Composite PK (disaster_id, location_id). |
| 3. Camps opened | Shelters with capacity and occupancy. | `relief_camps` | CHECK: occupancy ≤ capacity; CLOSED ⇒ 0 people; FULL ⇔ at capacity. |
| 4. Request raised | A field officer asks for items for a camp. | `resource_requests` + `request_items` | Header and all lines inserted in **one transaction**; a resource can appear only once per request (composite PK). |
| 5. Approval | Coordinator approves (or rejects/cancels). | `resource_requests.status` | State machine: only PENDING → APPROVED / REJECTED / CANCELLED, APPROVED → CANCELLED. |
| 6. Allocation | Stock from a warehouse is reserved for the request. | `allocations` + `allocation_items` | Trigger locks the request, the line and the stock row, then checks stock and outstanding demand. |
| 7. Stock deduction | Stock goes down automatically. | `inventory` | Trigger `adjust_inventory_for_allocation`; CHECK `quantity_available >= 0`. |
| 8. Movement history | Every stock change is logged. | `inventory_movements` | Trigger `record_inventory_movement`. |
| 9. Delivery planned | Vehicle, driver and volunteer crew assigned. | `deliveries`, `delivery_volunteers`, `vehicles`, `volunteers` | Row locks; partial unique indexes: one active delivery per vehicle, per driver, per allocation. |
| 10. In transit / delayed / delivered | Driver updates progress. | `deliveries`, `allocations` | Delivery and allocation state-machine triggers. |
| 11. Fulfilment | The request's status is recalculated. | `resource_requests` | Procedure `refresh_request_status`. |

Request status journey:

`PENDING → APPROVED → PARTIALLY_FULFILLED (some allocated) → ALLOCATED (all allocated) → IN_TRANSIT → DELIVERED`, with `REJECTED` and `CANCELLED` as stop states.

Cancellation: an allocation can be cancelled only while it is still ALLOCATED (not dispatched). Cancelling returns the stock **exactly once** (trigger `allocation_status_guard`) and the request becomes allocatable again.

---

## 4. Technology stack, and why each piece is there

| Piece | What it is | Why ReliefFlow uses it |
|---|---|---|
| **Next.js 15 + React 19** | Web framework: React pages plus server "route handlers" (the API). | One codebase for UI and backend; the API runs on the server, close to the database. |
| **TypeScript** | JavaScript with types. | Catches mistakes before running. |
| **Zod** | Validation library. | Every API input is checked (types, ranges, unknown fields) before touching the database. |
| **PostgreSQL 16** | Relational DBMS. | Source of truth: ACID transactions, constraints, triggers, views, procedures, row locks. |
| **pg (node-postgres)** | PostgreSQL driver. | Sends **parameterised** SQL (`$1, $2`), which prevents SQL injection. |
| **MongoDB 7** | Document database. | Incident reports have flexible, nested content (location, tags, update history). |
| **Redis 7** | In-memory key-value store. | Caches dashboard numbers (30 s) and counts rate limits. Optional. |
| **Neo4j 5** | Graph database (Cypher). | Relationship questions, such as "shortest path from a disaster to a warehouse". Optional. |
| **pgvector** | PostgreSQL extension for vectors. | Similarity search over incidents, requests and disasters. Optional. |
| **bcrypt** | Password hashing. | Passwords are stored only as slow salted hashes. |
| **Docker Compose** | Runs databases in containers. | One command starts PostgreSQL, MongoDB and the optional services. |
| **Playwright** | Browser automation. | Automated tests click through the real UI. |
| **recharts, motion, lucide, Leaflet** | Charts, animation, icons, maps. | Dashboard and visual design. |

---

## 5. Architecture (three tiers)

```
Browser (React pages)         ← presentation tier: shows data, never decides stock or permissions
      │ fetch('/api/...') JSON + session cookie
Next.js route handlers        ← application tier
      ├ actor()       who is signed in? which role? same-origin request?
      ├ Zod schema    is the input valid?
      └ transaction() BEGIN … parameterised SQL … COMMIT / ROLLBACK
PostgreSQL / MongoDB / Redis / Neo4j / pgvector   ← data tier
```

* **PostgreSQL owns** all structured operational data.
* **MongoDB owns** incident documents.
* **Redis, Neo4j and pgvector hold derived copies only.** If they fail, the core app keeps working ("graceful degradation"). There is **no distributed transaction** across databases, and the project does not claim one.

---

## 6. How to read the ER diagram

The ER diagram uses **Chen notation**:

| Symbol | Meaning | Example in ReliefFlow |
|---|---|---|
| Rectangle | **Strong entity**: has its own primary key. | DISASTER, RELIEF CAMP, WAREHOUSE, USER |
| Double rectangle | **Weak entity**: identified only through its owners. | REQUEST ITEM (owned by RESOURCE REQUEST and RESOURCE), STOCK LINE (owned by WAREHOUSE and RESOURCE) |
| Diamond | **Relationship** | RAISED AT, FULFILS, TRANSPORTS |
| Double diamond | **Identifying relationship** (links a weak entity to its owner). | CONTAINS, OF, HOLDS, STOCK OF |
| Ellipse | **Attribute** | camp_name, capacity |
| Underlined attribute | **Key attribute** | disaster_id |
| Dashed underline | **Partial key** of a weak entity | "resource" for REQUEST ITEM |
| Dashed ellipse | **Derived attribute** (computed, not entered) | search_vector, occupancy_pct |
| Double ellipse | **Multivalued attribute** | tags, updates (MongoDB arrays) |
| Ellipse with sub-ellipses | **Composite attribute** | coordinates = (latitude, longitude); MongoDB location = (label, latitude, longitude) |
| Double line | **Total participation**: every entity must take part (FK is NOT NULL). | Every request must belong to a camp. |
| Single line | **Partial participation** (FK may be NULL). | A camp may have no manager. |
| 1 / N / M | **Cardinality** | One camp raises N requests; M disasters affect N locations. |
| Dashed purple | Cross-database reference (MongoDB → PostgreSQL). | INCIDENT REPORT reports on DISASTER. |

Reading the **relational schema's connectors** (draw.io crow's-foot notation): the crow's foot with a circle sits at the referencing (child) table and means "zero or many"; at the referenced (parent) table, two bars mean "exactly one" (the FK is NOT NULL) and a circle with a bar means "zero or one" (the FK is nullable). Composite foreign keys are labelled with their column list.

Why the ER diagram shows no foreign-key columns: in Chen notation, the **relationship is the foreign key**. For example, `resource_requests.camp_id` appears as the RAISED AT diamond, not as an attribute.

Why some tables are diamonds and some are double rectangles:

* `disaster_locations` and `delivery_volunteers` are **pure M:N relationships with attributes**. Nothing else refers to them, so in the ER diagram they are diamonds (AFFECTS, CREWED BY) with their attributes attached.
* `request_items` and `inventory` are also M:N in structure, but **other tables reference them** (allocation lines point to a specific request line and a specific stock line). That makes them things in their own right, so they are modelled as **weak entities** (REQUEST ITEM, STOCK LINE).

### Relationships and cardinalities in the diagram

| Relationship | Between | Cardinality | Participation | Becomes in SQL |
|---|---|---|---|---|
| HAS ROLE | USER – ROLE | N : 1 | user total | `app_users.role_id` |
| AUTHENTICATES | SESSION – USER | N : 1 | session total | `sessions.user_id` (ON DELETE CASCADE) |
| PERFORMS | AUDIT LOG – USER | N : 1 | partial | `audit_logs.user_id` |
| TRIGGERS | SYNC RUN – USER | N : 1 | partial | `integration_sync_runs.triggered_by` |
| CREATES | DISASTER – USER | N : 1 | disaster total | `disasters.created_by` |
| OCCURS AT | DISASTER – LOCATION | N : 1 | partial | `disasters.event_location_id` |
| AFFECTS | DISASTER – LOCATION | M : N | both total | table `disaster_locations` |
| LOCATED AT | RELIEF CAMP – LOCATION | N : 1 | camp total | `relief_camps.location_id` |
| SITED AT | WAREHOUSE – LOCATION | N : 1 | warehouse total | `warehouses.location_id` |
| MANAGES (×2) | CAMP / WAREHOUSE – USER | N : 1 | partial | `manager_id` (ON DELETE SET NULL) |
| RAISED AT | REQUEST – CAMP | N : 1 | request total | `resource_requests.camp_id` |
| FOR | REQUEST – DISASTER | N : 1 | request total | `resource_requests.disaster_id` |
| RAISED BY | REQUEST – USER | N : 1 | request total | `resource_requests.requested_by` |
| CONTAINS (identifying) | REQUEST ITEM – REQUEST | N : 1 | item total | `request_items.request_id` (CASCADE) |
| OF (identifying) | REQUEST ITEM – RESOURCE | N : 1 | item total | `request_items.resource_id` |
| FULFILS | ALLOCATION – REQUEST | N : 1 | allocation total | `allocations.request_id` |
| ALLOCATED BY | ALLOCATION – USER | N : 1 | total | `allocations.allocated_by` |
| PART OF | ALLOCATION ITEM – ALLOCATION | N : 1 | total | composite FK `(allocation_id, request_id)` |
| COVERS | ALLOCATION ITEM – REQUEST ITEM | N : 1 | total | composite FK `(request_id, resource_id)` |
| DRAWS FROM | ALLOCATION ITEM – STOCK LINE | N : 1 | total | composite FK `(warehouse_id, resource_id)` |
| HOLDS (identifying) | STOCK LINE – WAREHOUSE | N : 1 | total | `inventory.warehouse_id` |
| STOCK OF (identifying) | STOCK LINE – RESOURCE | N : 1 | total | `inventory.resource_id` |
| LOGS | STOCK MOVEMENT – STOCK LINE | N : 1 | total | composite FK to `inventory` |
| BELONGS TO | RESOURCE – CATEGORY | N : 1 | total | `resources.category_id` |
| TRANSPORTS | DELIVERY – ALLOCATION | N : 1 (at most 1 active) | total | `deliveries.allocation_id` + partial unique index |
| USES | DELIVERY – VEHICLE | N : 1 | total | `deliveries.vehicle_id` |
| DRIVES | DELIVERY – USER | N : 1 | total | `deliveries.driver_id` |
| FROM / TO | DELIVERY – LOCATION | N : 1 each | total | `source_location_id`, `destination_location_id` |
| LAST SEEN AT | VEHICLE – LOCATION | N : 1 | partial | `vehicles.current_location_id` |
| CREWED BY | DELIVERY – VOLUNTEER | M : N | partial | table `delivery_volunteers` |
| REPORTS ON / REPORTED BY | INCIDENT (MongoDB) – DISASTER / USER | N : 1 | total | application-level references (checked in code) |

Note on **DELIVERY – LOCATION**: the same pair of entity sets has **two different relationships** (FROM and TO), distinguished by **role names** (source, destination). This is not a recursive relationship; a recursive relationship would link an entity set to itself (for example, an employee managing employees).

---

## 7. How to read the relational schema

* Each box is a **table** (a relation). The header shows the primary key.
* **PK** = primary key (underlined, orange). **FK** = foreign key. **UQ** = unique (an alternate key).
* `*` = NOT NULL. `(gen)` = generated column (computed by PostgreSQL).
* Arrows run **from the foreign key to the referenced key**.
* The list at the bottom gives every foreign key with its **referential action** (what happens on delete).

### ER → relational mapping rules (textbook, applied here)

| Rule | Applied in ReliefFlow |
|---|---|
| Strong entity → table with its own PK. | DISASTER → `disasters(disaster_id PK, …)` |
| 1 : N relationship → FK on the "N" side. | One camp, many requests → `resource_requests.camp_id` |
| M : N relationship → new table whose PK is both FKs. | AFFECTS → `disaster_locations(disaster_id, location_id)` |
| Relationship attributes go into that table. | `impact_level`, `affected_population` live in `disaster_locations` |
| Weak entity → table whose PK includes the owner's PK. | `request_items(request_id, resource_id)` |
| Total participation → NOT NULL FK. | `resource_requests.camp_id NOT NULL` |
| Partial participation → nullable FK. | `relief_camps.manager_id` nullable |
| Composite attribute → flattened into columns. | coordinates → `latitude`, `longitude` |
| Multivalued attribute → separate table (SQL) or array (MongoDB). | incident `tags` stored as an array in MongoDB |
| Derived attribute → not stored, or a generated column / view. | `occupancy_pct` computed in queries; `search_vector` is a GENERATED column |

### Text form of the relational schema

PK fields are in **bold**; FK fields are marked †.

* roles(**role_id**, role_name UQ, description)
* app_users(**user_id**, role_id†, full_name, email UQ, password_hash, phone UQ, is_active, created_at)
* sessions(**token_hash**, user_id†, expires_at)
* login_attempts(**email**, attempts, window_start)
* audit_logs(**audit_id**, user_id†, action, details, created_at)
* data_change_log(**change_id**, table_name, operation, row_data, changed_fields, changed_by, txid, changed_at)
* integration_sync_runs(**run_id**, target, status, attempts, records_synced, detail, triggered_by†, started_at, finished_at)
* schema_migrations(**filename**, applied_at)
* locations(**location_id**, location_name, location_type, address, latitude, longitude)
* disasters(**disaster_id**, disaster_name, disaster_type, severity, started_at, ended_at, status, description, created_by†, created_at, event_location_id†, search_vector)
* disaster_locations(**disaster_id†, location_id†**, impact_level, affected_population, reported_at)
* relief_camps(**camp_id**, location_id†, camp_name, capacity, current_population, manager_id†, status, established_at)
* resource_categories(**category_id**, category_name UQ, description)
* resources(**resource_id**, category_id†, resource_name, unit, description, is_perishable) with UNIQUE(category_id, resource_name)
* warehouses(**warehouse_id**, location_id†, warehouse_name, manager_id†, capacity, status)
* inventory(**warehouse_id†, resource_id†**, quantity_available, minimum_threshold, last_updated)
* inventory_movements(**movement_id**, (warehouse_id, resource_id)†, delta, reason, created_at)
* resource_requests(**request_id**, camp_id†, disaster_id†, requested_by†, requested_at, need_by, priority_score, priority_level, status, medical_emergency, remarks, search_vector)
* request_items(**request_id†, resource_id†**, quantity_requested)
* allocations(**allocation_id**, request_id†, allocated_by†, allocated_at, status, remarks) with UNIQUE(allocation_id, request_id)
* allocation_items(**allocation_item_id**, (allocation_id, request_id)†, (request_id, resource_id)†, (warehouse_id, resource_id)†, quantity_allocated)
* vehicles(**vehicle_id**, vehicle_number UQ, vehicle_type, capacity, status, current_location_id†)
* volunteers(**volunteer_id**, full_name, phone UQ, email UQ, skills, availability_status, registered_at)
* deliveries(**delivery_id**, allocation_id†, vehicle_id†, driver_id†, source_location_id†, destination_location_id†, departure_time, expected_arrival, actual_arrival, status)
* delivery_volunteers(**delivery_id†, volunteer_id†**, assigned_role)

**Clever detail worth mentioning:** `allocations` has UNIQUE(allocation_id, request_id) even though allocation_id alone is already the PK. This exists so that `allocation_items` can reference **(allocation_id, request_id)** together. Combined with the FK (request_id, resource_id) → `request_items`, the database itself guarantees that an allocation line can only cover a resource that **the same request** actually asked for. This is integrity enforced purely through **composite foreign keys**.

---

## 8. Every table explained

### Identity and security

| Table | Purpose | Notes |
|---|---|---|
| `roles` | The four roles. | Referenced by users; ON DELETE RESTRICT. |
| `app_users` | People who sign in. | `email` is an alternate key. `password_hash` is bcrypt. `is_active = false` blocks sign-in. |
| `sessions` | Signed-in sessions. | Stores only the **SHA-256 hash** of the random token, so a database leak does not reveal usable tokens. 8-hour expiry. Deleted on logout, role change, deactivation and password reset. |
| `login_attempts` | Throttling. | At most 10 attempts per e-mail per 15 minutes. |
| `audit_logs` | Application audit trail. | Written in the same transaction as the change, so an audit row never describes a change that was rolled back. |
| `data_change_log` | Row-level change history. | Filled by trigger `log_row_change()` with a JSON diff ("field: from → to") and the acting user. Never stores password hashes. |

### Disasters and places

| Table | Purpose | Notes |
|---|---|---|
| `locations` | Districts, camp areas, depots. | Coordinates power the map and distance-based recommendations. |
| `disasters` | Events. | `severity` LOW/MODERATE/HIGH/CRITICAL; `status` ACTIVE/CONTAINED/CLOSED; CHECK `ended_at >= started_at`; generated full-text column `search_vector`. |
| `disaster_locations` | Which locations a disaster affects. | M:N table with impact level and affected population. |
| `relief_camps` | Shelters. | CHECKs keep occupancy, capacity and status consistent. |

### Resources and stock

| Table | Purpose | Notes |
|---|---|---|
| `resource_categories` | FOOD, WATER, MEDICAL, … | — |
| `resources` | Catalogue items with a unit. | UNIQUE(category_id, resource_name). |
| `warehouses` | Storage sites. | Status ACTIVE/INACTIVE/MAINTENANCE; only ACTIVE ones can supply stock. |
| `inventory` | Stock of one resource in one warehouse. | Composite PK; CHECK quantity ≥ 0; low-stock threshold. |
| `inventory_movements` | Every change in stock with a reason. | Written by trigger. |

### Requests and allocations

| Table | Purpose | Notes |
|---|---|---|
| `resource_requests` | Request header. | Priority, deadline, medical-emergency flag, status, full-text column. |
| `request_items` | Lines: which resource, how much. | Composite PK prevents the same resource twice in one request. |
| `allocations` | A commitment of stock to a request. | Status ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED. |
| `allocation_items` | Lines: how much from which warehouse. | Immutable once inserted (history). |

### Logistics

| Table | Purpose | Notes |
|---|---|---|
| `vehicles` | Fleet. | Unique registration; status AVAILABLE/IN_USE/MAINTENANCE. |
| `volunteers` | Helpers. | AVAILABLE/ASSIGNED/UNAVAILABLE. |
| `deliveries` | Transport of one allocation. | Status machine enforced by a trigger; one active delivery per vehicle, driver and allocation. |
| `delivery_volunteers` | Crew on a delivery. | M:N. |

### Integration bookkeeping

| Table | Purpose |
|---|---|
| `integration_sync_runs` | One row per Neo4j or vector sync: status, attempts, record count, message. |
| `schema_migrations` | Which migration files have been applied, so each runs once. |

---

## 9. Database logic: views, functions, procedure, triggers

### Views (stored queries)

| View | Answers the question |
|---|---|
| `v_low_stock` | Which stock lines are at or below their threshold? |
| `v_request_fulfillment` | For each request line: requested, allocated (cancelled allocations excluded), remaining. |
| `v_warehouse_inventory_summary` | Per warehouse: number of lines, total units, low-stock count. |
| `v_resource_demand` | Per resource: open demand vs stock in active warehouses (a negative net position means shortage). |
| `v_disaster_response_summary` | Per disaster: affected locations and population, requests, units allocated. |

Why views: they give one definition used by many screens (dashboard, intelligence, reports) and hide join complexity. This is **logical data independence** in practice.

### Functions and procedure

| Routine | Type | What it does |
|---|---|---|
| `remaining_request_quantity(request, resource)` | SQL function | Outstanding quantity for one line. |
| `resource_availability(resource)` | SQL function | Total stock in active warehouses. |
| `request_fulfillment_pct(request)` | SQL function | Percentage allocated. |
| `operational_summary()` | set-returning function | A KPI table (metric, value). |
| `refresh_request_status(request)` | **procedure** (`CALL`) | The single place that decides a request's derived status. |

Function vs procedure: a function **returns a value** and can be used inside SELECT; a procedure is **called** with `CALL` and performs actions. It can also control transactions when called outside one.

### Triggers (16 attachments, 8 trigger functions)

| Trigger | Table, timing | What it does, in plain words |
|---|---|---|
| `trg_validate_allocation_item` | allocation_items, BEFORE INSERT/UPDATE/DELETE | Locks request → request line → stock row (in that order). Rejects the line if the request is not approved, the warehouse is not active, stock is insufficient, or it would exceed outstanding demand. Rejects any UPDATE/DELETE ("allocation lines are immutable"). |
| `trg_adjust_inventory` | allocation_items, AFTER | Deducts the allocated quantity from `inventory`. |
| `inventory_history` | inventory, AFTER INSERT/UPDATE | Writes a row to `inventory_movements` with the change and its reason. |
| `allocation_status_guard` | allocations, BEFORE UPDATE | Allows only ALLOCATED → IN_TRANSIT/CANCELLED and IN_TRANSIT → DELIVERED. On cancel, returns the stock (exactly once) and refuses if a delivery is still active. |
| `delivery_status_guard` | deliveries, BEFORE UPDATE | Allows only PLANNED → IN_TRANSIT/CANCELLED, IN_TRANSIT ↔ DELAYED, → DELIVERED. |
| `delivery_vehicle_guard` | deliveries, BEFORE INSERT | Refuses a vehicle under maintenance. |
| `operational_duplicate` | disasters, warehouses, BEFORE INSERT/UPDATE | Rejects duplicates (same name, type, date and location), compared case- and space-insensitively, using an advisory lock so two simultaneous inserts cannot both pass. |
| `row_change_log` | 8 key tables, AFTER | Writes a JSON diff and the acting user to `data_change_log`. |

BEFORE vs AFTER: **BEFORE** triggers validate (and can stop) a change. **AFTER** triggers react to a change that has happened (deduct stock, write history).

How the trigger knows the user: the API runs `set_config('reliefflow.user_id', <id>, true)` at the start of each transaction, and the trigger reads it with `current_setting()`. The `true` means "for this transaction only".

---

## 10. Keys and constraints (with examples)

| Concept | Definition | ReliefFlow example |
|---|---|---|
| Super key | Any set of attributes that identifies a row. | {user_id, email}, {user_id}, {email} |
| Candidate key | A minimal super key. | app_users: {user_id} and {email} |
| Primary key | The chosen candidate key. | user_id (identity) |
| Alternate key | Candidate keys not chosen. | email, vehicle_number (UNIQUE) |
| Composite key | A key of several columns. | inventory (warehouse_id, resource_id) |
| Surrogate key | System-generated, no meaning. | request_id (GENERATED ALWAYS AS IDENTITY) |
| Natural key | Meaningful in the real world. | vehicle_number |
| Foreign key | References a key in another table. | allocation_items → inventory |
| CHECK | Row-level rule. | quantity_available >= 0 |
| NOT NULL | Value required. | resource_requests.camp_id |
| UNIQUE | No duplicates. | resource_categories.category_name |

Referential actions used:

* **RESTRICT** (most FKs): you cannot delete a parent that still has children. For example, a category in use cannot be deleted, which protects history.
* **CASCADE**: deleting the parent deletes the children. Used where children are meaningless alone: a request's lines, a user's sessions, a delivery's crew.
* **SET NULL**: the child survives without the link. Used for a camp or warehouse manager, a vehicle's last location, and a sync run's trigger user.

`NOT VALID` constraints: a constraint added with NOT VALID is enforced for **new and changed rows** but does not check old rows. ReliefFlow uses this so that adding stricter rules never breaks or deletes existing historical data. (There are three legacy rows that violate newer rules; they were deliberately left untouched.)

---

## 11. Transactions and concurrency in ReliefFlow

### ACID, applied

* **Atomicity**: creating an allocation inserts the header, every line, deducts stock, writes history and updates the request status in **one transaction**. If line 2 fails, line 1's stock deduction is undone too. (Lab demo: "Atomicity: allocation fails halfway".)
* **Consistency**: constraints and triggers make an invalid state impossible to commit.
* **Isolation**: row locks and MVCC snapshots stop concurrent transactions from seeing or overwriting each other's partial work.
* **Durability**: PostgreSQL writes the **write-ahead log (WAL)** to disk before COMMIT returns.

### The concurrency techniques used (know these four)

1. **Pessimistic row locking**: `SELECT … FOR UPDATE` on the request, stock row, vehicle and driver before changing them. A second coordinator waits instead of overwriting.
2. **Fixed lock order** (request → request lines → stock rows sorted by warehouse, resource). If everyone takes locks in the same order, a cycle (**deadlock**) cannot form.
3. **Atomic relative updates**: `UPDATE relief_camps SET current_population = current_population + n WHERE … AND current_population + n BETWEEN 0 AND capacity`. Read and write happen in one statement, so no update is lost. (Tested: 12 simultaneous admissions all counted.)
4. **Optimistic concurrency**: the edit form remembers the row's version (PostgreSQL's hidden `xmin` column). If someone else changed the row since, the save is rejected with "changed by someone else" instead of silently overwriting.

Plus **database backstops**: partial unique indexes ensure that, even if two requests race, only one active delivery per vehicle can exist.

### Isolation levels and anomalies

| Anomaly | Meaning | Where it is prevented |
|---|---|---|
| Dirty read | Reading uncommitted data. | Never possible in PostgreSQL. |
| Non-repeatable read | Same row read twice gives different values. | REPEATABLE READ |
| Phantom read | Same query returns new rows the second time. | REPEATABLE READ in PostgreSQL (snapshot isolation) |
| Lost update | Two read-modify-writes overwrite each other. | Row locks / atomic UPDATE / REPEATABLE READ (fails with 40001) |
| Deadlock | Two transactions wait for each other. | PostgreSQL detects it and aborts one (error 40P01); ReliefFlow avoids it with lock ordering. |

PostgreSQL's default level is **READ COMMITTED**. ReliefFlow uses it together with explicit row locks, which is the standard production approach.

Shared vs exclusive locks: `FOR SHARE` (shared) lets many transactions hold it together (used so a camp or disaster cannot be closed while a request is being created). `FOR UPDATE` (exclusive) allows only one holder.

---

## 12. Security

| Threat | Protection |
|---|---|
| Password theft | bcrypt hashes (cost 12); never stored in plain text; never logged. |
| Session theft | Random 256-bit token in an **httpOnly** cookie (JavaScript cannot read it), SameSite=Strict, Secure on HTTPS; only its SHA-256 hash is stored. |
| Brute force | Login throttling, plus a dummy-hash comparison so the response time doesn't reveal which e-mails exist. |
| CSRF (cross-site request forgery) | SameSite cookie, Origin / Sec-Fetch-Site checks, JSON content type required. |
| SQL injection | All SQL is parameterised (`$1`); the only dynamic identifiers come from a fixed allow-list. |
| Privilege escalation | Every API route checks the role; drivers only see their own deliveries (enforced in SQL `WHERE driver_id = $2`). |
| Information leakage | Errors are mapped to safe messages and codes; no SQL or stack traces reach the browser. |
| Lab abuse | Separate database, a non-superuser role, a statement guard, timeouts and forced ROLLBACK (see section 15). |

---

## 13. MongoDB (document database) part

Collection `incident_reports`. One incident looks like:

```json
{
  "_id": ObjectId("…"),
  "disasterId": 11,
  "reportedBy": 7,
  "reportType": "MEDICAL",
  "severity": "CRITICAL",
  "description": "Cluster of acute diarrhoea among children…",
  "location": { "label": "Aluva Government School Camp", "latitude": 10.1, "longitude": 76.3 },
  "tags": ["waterborne", "children"],
  "status": "OPEN",
  "updates": [ { "note": "Field team dispatched", "by": 6, "byName": "Ananya Rao", "at": ISODate("…") } ],
  "createdAt": ISODate("…"), "updatedAt": ISODate("…")
}
```

* **Embedded documents**: `location` and `updates` live inside the incident (read together, written together).
* **References**: `disasterId` and `reportedBy` point to PostgreSQL rows. MongoDB cannot enforce this, so the API **checks the disaster exists in PostgreSQL before inserting** (application-level referential integrity).
* **Schema validation**: a `$jsonSchema` validator enforces required fields, enums and lengths. It is "moderate", so old documents are kept.
* **Indexes**: {disasterId, createdAt}, {reportType, severity}, {status, createdAt}, and a weighted **text index** (description × 5, tags × 3, location × 1).
* **Aggregation**: the Incidents page uses `$facet`, `$group` and `$unwind` for severity, type and top-tag counts.
* **Why MongoDB here**: incident reports are free-form and their shape evolves (photos or new fields later), and they don't need multi-row transactions. Everything that needs ACID stays in PostgreSQL.

---

## 14. The optional NoSQL services

| Service | Model | Role in ReliefFlow | If it is down |
|---|---|---|---|
| **Redis** | Key-value | Caches the dashboard for 30 s (key `rf:cache:dashboard:v2`), deleted after any write. Counts rate limits with INCR + EXPIRE. | Falls back to an in-memory map automatically. |
| **Neo4j** | Property graph | Copy of the response network: (Disaster)-[:AFFECTS]->(Location)-[:CONTAINS]->(Camp)-[:RAISED]->(Request)-[:NEEDS]->(Resource)<-[:STORES]-(Warehouse), and so on. Queries: shortest path disaster → warehouse, resources shared by several camps, critical resources across locations. | Graph pages show "unreachable"; everything else works. |
| **pgvector** | Vectors | Each incident, request and disaster becomes a vector; search returns nearest neighbours by **cosine similarity** using an **HNSW** index. | Vector page shows "not configured"; everything else works. |

Synchronisation is **explicit**: a coordinator presses Sync. It does a full refresh, retries up to 3 times, and records the outcome in `integration_sync_runs`. A failed sync keeps the previous complete copy.

Honest point about embeddings: real semantic embeddings need an API key (Voyage or OpenAI). Without one, ReliefFlow uses a **clearly labelled lexical fallback**: hashed word counts, which match shared words, not meaning. Say this openly if asked; it is a deliberate integrity decision.

---

## 15. The Database Engineering Lab

**Where it runs:** a **separate database** `reliefflow_lab`, rebuilt from a sanitised copy of the real data (no e-mails, phones or password hashes). It runs as role `rf_lab`, which is not a superuser and has no CREATE rights on public tables, a statement timeout and a temp-file limit. Every demo runs inside a transaction that is **always rolled back**, so even DELETE or DROP demos change nothing permanently.

| Page | What you can show |
|---|---|
| DBMS Concepts | Purpose, DB vs files, three-schema architecture (mapped to real views, tables, indexes), keys, ER vocabulary. |
| ER Explorer | Live ER diagram from the catalog; click a table to see attributes, keys, CHECKs and relationships with cardinality. |
| Relational Algebra | σ, π, ∪, −, ∩, ×, ρ, ⋈, ⟕, ÷, γ, each with the algebra expression, equivalent SQL and live result. |
| SQL Explorer | DDL, DML, clauses and constraint violations, plus a **guarded playground**. |
| Advanced SQL | Set operations, NULLs, subqueries, joins, views, real triggers, functions, procedure, CTEs (including recursive), window functions, full-text search. |
| Query Optimisation | EXPLAIN ANALYZE plan trees on 300,000 synthetic rows: seq scan vs index scan, index-only scan, composite index order, bad vs good predicate, hash vs merge vs nested-loop join. |
| Normalisation | FD engine (closure, candidate keys, minimal cover, 2NF/3NF/BCNF violations, BCNF decomposition, 3NF synthesis, lossless-join test) and SQL demos of anomalies, 4NF and 5NF. |
| Transactions | ACID demos with savepoints, and 9 **two-session** scenarios (dirty read, non-repeatable read, phantom, lost update, FOR UPDATE, serialization failure, deadlock, shared vs exclusive, concurrent allocation) with a lock observer. |
| MongoDB & NoSQL | Relational vs NoSQL table; live CRUD, validation errors, explain plans (IXSCAN vs COLLSCAN), text search, aggregation with $lookup. |
| Key-Value | Live keys and TTLs, measured cache vs database benchmark, invalidation. |
| Graph | Cypher queries with a force-directed graph view; sync history. |
| Vector | Similarity search beside keyword search; query plan using HNSW. |
| Next.js ↔ SQL | A live, timed trace of one request through parse → auth → validation → BEGIN → locks → INSERTs → ROLLBACK. |

Measured results (they vary per run): seq scan about 13 ms → index scan about 1.6 ms; index-only scan about 0.1 ms; non-sargable `date_trunc(...) =` about 3 ms → range predicate about 0.06 ms.

---

## 16. Syllabus theory in one place (with ReliefFlow answers)

### Unit 1

* **DBMS**: software to store, retrieve and manage shared data with integrity, concurrency, security and recovery.
* **Three-schema architecture**: external (views for users, e.g. `v_low_stock`) → conceptual (tables and constraints) → internal (pages, indexes, WAL). **Logical data independence**: change tables without breaking views. **Physical data independence**: add indexes without changing queries (migration 007 added indexes; no query changed).
* **Relational algebra**: selection σ (WHERE), projection π (SELECT DISTINCT), union ∪, difference − (EXCEPT), Cartesian product × (CROSS JOIN), rename ρ (AS); derived: join ⋈, intersection ∩, division ÷ ("for all": warehouses that stock every medical resource, written with NOT EXISTS … NOT EXISTS).
* **SQL categories**: DDL (CREATE, ALTER, DROP, TRUNCATE), DML (INSERT, UPDATE, DELETE), DQL (SELECT), DCL (GRANT, REVOKE: used to give `rf_lab` table rights only), TCL (BEGIN, COMMIT, ROLLBACK, SAVEPOINT).
* **WHERE vs HAVING**: WHERE filters rows before grouping; HAVING filters groups after aggregation.
* **DELETE vs TRUNCATE vs DROP**: DELETE removes chosen rows (fires triggers, can be filtered); TRUNCATE empties the table quickly; DROP removes the table itself.

### Unit 2

* **UNION vs UNION ALL**: UNION removes duplicates; UNION ALL keeps them and is cheaper.
* **NULL**: means unknown. `NULL = NULL` is UNKNOWN, so use IS NULL. COUNT(*) counts rows; COUNT(col) skips NULLs. COALESCE gives a default; NULLIF avoids division by zero.
* **Correlated subquery**: refers to the outer row and is logically re-run per row (camps whose total requested quantity exceeds 1,000).
* **Joins**: INNER (matches only), LEFT (all left rows), RIGHT, FULL (both sides), CROSS (every pair), SELF (a table with itself, e.g. duplicate requests from the same camp).
* **View vs table**: a view stores a query, not data (unless materialized).
* **Trigger**: code the DBMS runs automatically on INSERT, UPDATE or DELETE.
* **CTE**: `WITH name AS (…)`, a named sub-result. **Recursive CTE**: anchor part UNION recursive part (days until water runs out; disasters related through shared locations).
* **Window function vs GROUP BY**: GROUP BY collapses rows; window functions keep every row and add a computed column (RANK, ROW_NUMBER, LAG, running SUM).
* **Full-text search**: text → `tsvector` (normalised words), query → `tsquery`, matched with `@@`, ranked with `ts_rank`, sped up with a GIN index.

### Unit 3

* **Query processing**: parse → analyse (names, types, permissions) → rewrite (views expanded) → plan / optimise (cost-based) → execute → return.
* **Indexes**: B-tree (default; =, <, >, ranges, ORDER BY), GIN (full-text, arrays, trigram), HNSW (vectors), partial (with a WHERE), composite (column order matters: leftmost prefix), covering (index-only scans).
* **EXPLAIN vs EXPLAIN ANALYZE**: EXPLAIN shows the estimated plan; ANALYZE also runs it and shows the actual time and rows.
* **Sargable**: a predicate the index can use. `date_trunc('month', created_at) = …` is not sargable; `created_at >= … AND created_at < …` is.
* **Join algorithms**: nested loop (small or indexed inner side), hash join (large unsorted inputs, equality), merge join (both sides sorted).
* **Functional dependency X → Y**: equal X values imply equal Y values. **Trivial**: Y ⊆ X. **Full**: depends on the whole key. **Partial**: on part of a composite key. **Transitive**: X → Y → Z through a non-key.
* **Attribute closure X⁺**: everything X determines (repeatedly apply FDs). X is a super key if X⁺ contains all attributes.
* **Normal forms**: 1NF (atomic values) → 2NF (no partial dependency) → 3NF (no transitive dependency of non-prime attributes) → BCNF (every determinant is a super key) → 4NF (no non-trivial multivalued dependency) → 5NF (no join dependency not implied by keys).
* **Lossless join**: joining the decomposed tables gives back exactly the original (the lab verifies it with EXCEPT in both directions returning 0 rows). **Dependency preservation**: every FD can still be checked inside one table. 3NF synthesis always gives both; BCNF may lose dependency preservation (shown by the CampDuty example).

### Unit 4

* **Transaction**: a logical unit of work that is all-or-nothing.
* **Schedule / serializability**: a concurrent execution is correct if equivalent to some serial order; PostgreSQL's SERIALIZABLE guarantees this.
* **Locking**: shared (read) and exclusive (write) locks; two-phase locking (acquire, then release at commit) gives serializability. PostgreSQL holds row locks until COMMIT.
* **Deadlock**: a cycle of waits; handled by detection (PostgreSQL) and prevention (fixed lock order in ReliefFlow).
* **MVCC**: PostgreSQL keeps row versions, so readers don't block writers (the `xmin` column used for optimistic locking is the version id).
* **NoSQL families**: key-value (Redis), document (MongoDB), column-family (Cassandra, not used), graph (Neo4j), plus vector stores (pgvector).
* **CAP / BASE (short answer)**: distributed systems trade consistency against availability during network partitions. NoSQL systems often choose availability with eventual consistency (BASE). ReliefFlow keeps critical data in a strongly consistent single PostgreSQL instance; the NoSQL copies are derived and may lag (eventual consistency, by design).

---

## 17. A 10-minute viva demo script

1. **Login** as admin → **Command Center**: point out KPIs, charts, critical shortages, and the "served from cache" note (Redis).
2. **Map**: disasters coloured by severity with dashed lines to affected locations; camps and warehouses.
3. **Resource Requests** → open a PENDING request → show the **pipeline stepper** → **Approve**.
4. **Plan allocation**: show the explained recommendations (distance, stays above threshold) → **Allocate** → toast "stock deducted atomically".
5. **Inventory** → the quantity dropped; **Stock Movements** → the trigger-written row.
6. **Allocations** → **Plan delivery** (vehicle, driver, crew) → **Deliveries** → Dispatch → Mark delivered → back to the request: **Delivered**.
7. **Data Change Log**: the JSON diffs written by the audit trigger.
8. **Lab → ER Explorer** (live catalog) → **Transactions → Concurrency → "Two coordinators allocate the same stock"**: T2 waits on the lock, then fails the CHECK. The lock observer shows the waiting session.
9. **Lab → Query Optimisation → "Sequential scan → index scan"**: measured plans.
10. **Lab → Normalisation**: load "RequestLine", show 1NF, the partial dependencies, the BCNF decomposition, and "Lossless".

If something is asked that you can demo, demo it rather than describe it.

---

## 18. Likely viva questions, with short answers

**About the project**

1. *Why two databases?* PostgreSQL for transactional, strongly related data that needs ACID; MongoDB for flexible incident documents. Each is used where it fits.
2. *What is the source of truth?* PostgreSQL. Redis, Neo4j and pgvector hold derived copies.
3. *How do you keep MongoDB consistent with PostgreSQL?* The disaster reference is validated in PostgreSQL before the insert; ownership is clear; no cross-database transaction is claimed.
4. *What happens if Redis or Neo4j is down?* The app degrades gracefully: the cache falls back to memory, and graph pages show a status message. This is tested automatically.
5. *How many tables?* 25 tables, 151 columns, 34 foreign keys, 5 views, 13 routines, 16 trigger attachments, 65 indexes.

**ER and design**

6. *Why is REQUEST ITEM a weak entity?* It has no identity of its own; it is identified by (request, resource), and its existence depends on the request (ON DELETE CASCADE).
7. *Why is `disaster_locations` a table and not a column?* AFFECTS is M:N (one disaster, many locations; one location, many disasters) and it has its own attributes.
8. *Total vs partial participation?* Total = every entity must participate (NOT NULL FK, e.g. request → camp). Partial = optional (manager_id may be NULL).
9. *Why surrogate keys?* Stable, compact and never change, unlike names. Natural keys (vehicle_number, email) are still enforced as UNIQUE alternate keys.
10. *What is a composite foreign key and where do you use one?* A FK made of several columns. `allocation_items(request_id, resource_id) → request_items` guarantees a line only covers a resource the same request asked for.

**SQL and logic**

11. *Where do you use a trigger, and why not just in code?* Stock deduction, validation, history and auditing. In the database, the rules hold even for direct SQL or other applications.
12. *BEFORE vs AFTER trigger?* BEFORE can validate or cancel the change; AFTER reacts to a completed change.
13. *Why a procedure for request status?* One authoritative rule used after allocation, cancellation and delivery, instead of three copies in the code.
14. *How do you prevent SQL injection?* Parameterised queries only; table names come from an allow-list.
15. *What does your full-text search do?* A generated `tsvector` column with a GIN index; `websearch_to_tsquery` supports quotes, OR and -exclusion; ranked with `ts_rank`.

**Transactions and concurrency**

16. *Two coordinators allocate the last 70 units at once. What happens?* The first locks the stock row (FOR UPDATE), deducts and commits; the second waits, re-reads 30 and is rejected by the check, so stock never goes negative. Tested.
17. *How do you avoid deadlocks?* Always lock in the same order (request → lines → stock by warehouse, resource); PostgreSQL detects any remaining cycle.
18. *What isolation level do you use?* READ COMMITTED plus explicit row locks and atomic updates; the lab demonstrates REPEATABLE READ and its 40001 error.
19. *Optimistic vs pessimistic locking?* Pessimistic: lock first (allocations). Optimistic: check the version at save time (edit forms using `xmin`).
20. *What is a savepoint?* A marker inside a transaction you can roll back to without abandoning the whole transaction.

**Normalisation and optimisation**

21. *Is your schema normalised?* Operational tables are in BCNF. For example, `inventory(warehouse_id, resource_id → quantity, threshold, updated)`: the only determinant is the key. Status columns and derived values are computed, not duplicated.
22. *Did you denormalise anything?* Generated `search_vector` columns (derived, maintained by PostgreSQL), and `allocation_items.request_id`, which is deliberately repeated so composite FKs can enforce integrity.
23. *Show that an index helped.* Demo "seq scan → index scan": about 13 ms → 1.6 ms on 300k rows, measured live.
24. *What is an index-only scan?* The index contains every needed column and the visibility map is up to date, so the table (heap) is never read.

**NoSQL**

25. *Embed or reference in MongoDB?* Embed what is read together and owned by the document (location, update notes); reference what has its own life elsewhere (disaster, user).
26. *What is a graph database good for here?* Multi-hop relationship questions (shortest path, shared resources) that would need many joins in SQL.
27. *What is cosine similarity?* The angle between two vectors: 1 = same direction (very similar), 0 = unrelated. pgvector's `<=>` returns the cosine distance, 1 − similarity.
28. *Is your vector search semantic?* Only when an embedding API key is configured. Otherwise it is a labelled lexical fallback, stated openly on the page.

**Security and testing**

29. *How are passwords stored?* bcrypt hashes with cost 12; login throttling; sessions store only token hashes.
30. *How did you test it?* 25 unit tests, 28 end-to-end integration checks on fresh test databases (including concurrency, rollback, security and a Playwright browser run over all screens), and 4 live tests of the optional services.

---

## 19. Numbers to remember

| | |
|---|---|
| PostgreSQL tables | 25 |
| Columns | 151 |
| Foreign keys | 34 |
| Views | 5 |
| Functions + procedure | 12 functions (incl. 8 trigger functions) + 1 procedure |
| Trigger attachments | 16 |
| Indexes | 65 |
| Lab SQL demos | 70 |
| Concurrency scenarios | 9 |
| MongoDB lab demos | 6 |
| Tests | 25 unit · 28 integration · 4 service |
| Roles | 4 |
| Migrations | 001–007 |

(Counts reflect the schema when this guide was written; the diagrams' subtitles always show the live numbers.)

---

## 20. Commands cheat sheet

| Purpose | Command |
|---|---|
| Start databases | `docker compose up -d` |
| Start optional services | `docker compose --profile optional up -d --no-deps redis neo4j vectordb` |
| Apply migrations | `npm run db:migrate` |
| MongoDB validator and indexes | `npm run mongo:indexes` |
| Build lab sandbox | `npm run lab:setup` |
| Demo data (additive) | `npm run db:demo` |
| Run the app | `npm run dev` → http://localhost:3000 |
| Unit tests | `npm test` |
| Integration tests | `npm run build` then `npm run test:integration` |
| Optional services test | `npm run test:services` |
| Regenerate these diagrams | `npm run viva:diagrams` |

---

## 21. Limitations (state them honestly if asked)

* Semantic vector search needs an embedding API key; without it a labelled lexical fallback is used.
* Neo4j and the vector store are refreshed on demand, not in real time.
* No distributed transaction spans PostgreSQL and MongoDB; the incident's disaster reference is checked by the application.
* Map tiles need internet access.
* Three legacy rows violate newer rules (camp #3 closed with occupants; two duplicate warehouses; two duplicate disasters). They were preserved, not silently edited.
* Single PostgreSQL instance: no replication or sharding was in scope.

---

## 22. Glossary (A–Z)

* **ACID**: Atomicity, Consistency, Isolation, Durability.
* **Advisory lock**: an application-named lock (`pg_advisory_xact_lock`), used by the duplicate-check trigger.
* **Aggregation pipeline**: MongoDB's stage-by-stage data processing ($match, $group, $lookup…).
* **Alternate key**: a candidate key not chosen as the primary key.
* **Audit log**: a record of who did what and when.
* **B-tree**: the default balanced-tree index.
* **BCNF**: Boyce–Codd normal form: every determinant is a super key.
* **BSON**: binary JSON, MongoDB's storage format with extra types (ObjectId, Date).
* **Candidate key**: a minimal set of attributes that identifies a row.
* **Cardinality**: how many entities can relate (1:1, 1:N, M:N).
* **CASCADE / RESTRICT / SET NULL**: referential actions on delete.
* **CHECK constraint**: a row-level rule.
* **Cosine similarity**: similarity of direction between two vectors.
* **CSRF**: cross-site request forgery.
* **CTE**: common table expression (`WITH`).
* **Cypher**: Neo4j's query language.
* **Deadlock**: transactions waiting on each other in a cycle.
* **Derived attribute**: computed from other data.
* **Embedding**: a numeric vector representing text.
* **EXPLAIN ANALYZE**: shows and runs the query plan.
* **Foreign key**: a column (or columns) referencing a key in another table.
* **Functional dependency**: X determines Y.
* **GIN**: generalised inverted index (full-text, arrays, trigram).
* **HNSW**: graph-based approximate nearest-neighbour index for vectors.
* **Idempotent migration**: safe to run again (`IF NOT EXISTS`, `CREATE OR REPLACE`).
* **Identifying relationship**: links a weak entity to its owner.
* **Isolation level**: how much concurrent transactions can see of each other.
* **Lossless join**: decomposition that can be joined back exactly.
* **MVCC**: multi-version concurrency control.
* **NOT VALID**: constraint enforced for new rows only.
* **Optimistic locking**: detect conflicting edits at save time.
* **Parameterised query**: SQL with `$1` placeholders; prevents injection.
* **Partial index**: an index with a WHERE condition.
* **Participation (total/partial)**: whether every entity must take part.
* **Pessimistic locking**: lock before changing (`FOR UPDATE`).
* **Primary key**: the chosen unique identifier.
* **Procedure**: a stored routine invoked with CALL.
* **Rate limiting**: capping requests per time window.
* **Sargable**: a predicate that can use an index.
* **Savepoint**: a rollback point inside a transaction.
* **Session**: a signed-in state identified by a cookie token.
* **Surrogate key**: a generated, meaningless identifier.
* **Trigger**: automatic database code on data changes.
* **tsvector / tsquery**: PostgreSQL full-text document and query types.
* **View**: a stored query.
* **WAL**: write-ahead log (durability and crash recovery).
* **Weak entity**: an entity identified through its owner.
* **Window function**: a calculation over related rows without collapsing them.
* **xmin**: PostgreSQL's hidden row-version column (used for optimistic locking).
* **Zod**: TypeScript validation library used at the API boundary.
