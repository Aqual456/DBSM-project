<div class="titlepage">
<div class="tp-uni">PES University</div>
<div class="tp-dept">Department of Computer Science and Engineering · DBMS Experiential Learning, Level 3</div>
<div class="tp-title">ReliefFlow</div>
<div class="tp-subtitle">The Database, Explained<br/>Every table, every relationship, the DDL that creates them, the DML that changes them, and every trigger, view, function and procedure</div>
<table class="tp-team"><thead><tr><th>Member</th><th>SRN</th></tr></thead><tbody>
<tr><td>SUJAL Y</td><td>PES1UG24CS475</td></tr>
<tr><td>SUJAN H</td><td>PES1UG24CS477</td></tr>
</tbody></table>
<div class="tp-meta">Generated from the live PostgreSQL catalog on 19 November 2026</div>
</div>

# ReliefFlow — The Database, Explained

## 1. How to read this document

This document explains the whole PostgreSQL database of ReliefFlow, one piece at a time.

* **Section 2** gives the big picture: what the database stores and how the tables are grouped.
* **Section 3** explains every **relationship** (foreign key): what it means in plain English, its cardinality, and what happens on delete.
* **Section 4** is the **DDL**: which files create the database, in what order, and then every table with its exact `CREATE TABLE` statement, columns, constraints, indexes and triggers.
* **Section 5** covers the other DDL objects: **views, functions, the procedure, indexes, roles and row-level security**.
* **Section 6** explains every **trigger**: when it fires, what it does step by step, and its source code.
* **Section 7** is the **DML**: which INSERT / UPDATE / DELETE / SELECT statements the application runs, table by table and as one complete workflow, including which triggers fire.

> Everything structural here (columns, types, constraints, indexes, trigger and function source) is read directly from the running database, so it is exactly what is installed, not a copy that can go out of date.

| What | Count |
|---|---|
| Tables | 25 |
| Columns | 151 |
| Primary keys / foreign keys | 25 / 34 |
| UNIQUE / CHECK constraints | 9 / 42 |
| Indexes | 65 |
| Views / functions / procedures | 5 / 5 / 1 |
| Trigger functions / trigger attachments | 8 / 16 |
| Database roles / row-level security policies | 4 / 4 |

## 2. The big picture

ReliefFlow coordinates disaster relief. The data follows the real workflow:

```
Disaster ──affects──▶ Locations ◀── Relief camp ──raises──▶ Resource request ──contains──▶ Request items
                                                         │ PENDING → APPROVED
                                                         ▼
      Warehouse ──holds──▶ Inventory (stock line) ──▶ Allocation + allocation items   (stock deducted by trigger)
                                                         ▼
                    Vehicle + driver + volunteers ──▶ Delivery: PLANNED → IN_TRANSIT → DELIVERED
                                                         ▼
                         request status recomputed by the procedure refresh_request_status
```

The 25 tables fall into eight groups:

| Group | Tables | What it is for |
|---|---|---|
| **Users and security** | `roles`, `app_users`, `sessions`, `login_attempts` | Who can sign in, with which role, and how sign-in is protected. |
| **Disasters and places** | `locations`, `disasters`, `disaster_locations` | The events being responded to and the places they affect. |
| **Shelters** | `relief_camps` | Relief camps that house affected people and raise requests. |
| **Stock** | `resource_categories`, `resources`, `warehouses`, `inventory`, `inventory_movements` | What relief items exist, where they are stored and how much is left. |
| **Requests** | `resource_requests`, `request_items` | What a camp asks for: one header row and one line per resource. |
| **Allocation** | `allocations`, `allocation_items` | Stock committed from warehouses to a request. |
| **Logistics** | `vehicles`, `volunteers`, `deliveries`, `delivery_volunteers` | Getting allocated stock to the camp: vehicles, drivers, volunteer crews. |
| **History and system** | `audit_logs`, `data_change_log`, `integration_sync_runs`, `schema_migrations` | Audit trails and bookkeeping tables. |

Design rules used throughout:

* Every table has a **primary key**; most use a surrogate key `GENERATED ALWAYS AS IDENTITY` (an auto-number the application cannot override).
* Natural uniqueness is still enforced with **UNIQUE** (e-mail, vehicle number, category name, role name).
* Rules the data must always obey are **CHECK constraints** inside the database (stock ≥ 0, occupancy ≤ capacity, status values, e-mail format), so no program can break them.
* History is never deleted: users are deactivated, camps closed, requests cancelled. Foreign keys use **RESTRICT** to protect history and **CASCADE** only for detail rows owned by their parent.
* The schema is in **3NF/BCNF**: each fact is stored once (a location's name lives only in `locations`, a resource's unit only in `resources`).

## 3. How the tables are related

There are 34 foreign keys. Each one is a relationship between a **child** table (which holds the foreign key column) and a **parent** table (whose primary key it refers to).

How to read the cardinality:

* **1 : N** — one parent row can have many child rows; each child row points to one parent.
* **mandatory** — the FK column is NOT NULL, so every child row must have a parent (total participation in the ER diagram).
* **optional** — the FK column is nullable (partial participation).

### 3.1 Special relationship patterns

* **Many-to-many (M:N)** relationships become their own table with a composite primary key:
  * `disaster_locations` (Disaster AFFECTS Location) — also stores impact_level, affected_population, reported_at.
  * `delivery_volunteers` (Delivery CREWED BY Volunteer) — also stores assigned_role.
* **Weak entities** — rows identified through their owner:
  * `request_items` (PK request_id + resource_id): a request line has no meaning without its request.
  * `inventory` (PK warehouse_id + resource_id): a stock line is "resource X in warehouse Y".
* **Composite foreign keys** in `allocation_items`:
  * `(request_id, resource_id) → request_items`: you can only allocate a resource **that the request asked for**.
  * `(warehouse_id, resource_id) → inventory`: you can only draw it **from a warehouse that stocks that resource**.
  * `(allocation_id, request_id) → allocations`: the line's allocation must belong to the same request.
  * A single-column FK could not express any of these rules.
* **Several relationships to the same parent**: `deliveries` refers to `locations` twice (source and destination); `app_users` is referenced by eight tables (who created, requested, allocated, drove, managed…).

### 3.2 Every foreign key

#### Users and security

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `app_users(role_id)` | `roles(role_id)` | 1 : N, mandatory | RESTRICT | Every app_users row must refer to one roles row; one roles row can have many app_users rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `sessions(user_id)` | `app_users(user_id)` | 1 : N, mandatory | CASCADE | Every sessions row must refer to one app_users row; one app_users row can have many sessions rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |

#### Disasters and places

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `disasters(created_by)` | `app_users(user_id)` | 1 : N, mandatory | RESTRICT | Every disasters row must refer to one app_users row; one app_users row can have many disasters rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `disasters(event_location_id)` | `locations(location_id)` | 1 : N, optional | NO ACTION | A disasters row may refer to one locations row; one locations row can have many disasters rows. ON DELETE NO ACTION: the parent row cannot be deleted while child rows refer to it (checked at the end of the statement). |
| `disaster_locations(disaster_id)` | `disasters(disaster_id)` | 1 : N, mandatory | CASCADE | Every disaster_locations row must refer to one disasters row; one disasters row can have many disaster_locations rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |
| `disaster_locations(location_id)` | `locations(location_id)` | 1 : N, mandatory | RESTRICT | Every disaster_locations row must refer to one locations row; one locations row can have many disaster_locations rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |

#### Shelters

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `relief_camps(location_id)` | `locations(location_id)` | 1 : N, mandatory | RESTRICT | Every relief_camps row must refer to one locations row; one locations row can have many relief_camps rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `relief_camps(manager_id)` | `app_users(user_id)` | 1 : N, optional | SET NULL | A relief_camps row may refer to one app_users row; one app_users row can have many relief_camps rows. ON DELETE SET NULL: deleting the parent row sets this reference to NULL (the child row stays). |

#### Stock

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `resources(category_id)` | `resource_categories(category_id)` | 1 : N, mandatory | RESTRICT | Every resources row must refer to one resource_categories row; one resource_categories row can have many resources rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `warehouses(location_id)` | `locations(location_id)` | 1 : N, mandatory | RESTRICT | Every warehouses row must refer to one locations row; one locations row can have many warehouses rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `warehouses(manager_id)` | `app_users(user_id)` | 1 : N, optional | SET NULL | A warehouses row may refer to one app_users row; one app_users row can have many warehouses rows. ON DELETE SET NULL: deleting the parent row sets this reference to NULL (the child row stays). |
| `inventory(resource_id)` | `resources(resource_id)` | 1 : N, mandatory | RESTRICT | Every inventory row must refer to one resources row; one resources row can have many inventory rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `inventory(warehouse_id)` | `warehouses(warehouse_id)` | 1 : N, mandatory | RESTRICT | Every inventory row must refer to one warehouses row; one warehouses row can have many inventory rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `inventory_movements(warehouse_id, resource_id)` | `inventory(warehouse_id, resource_id)` | 1 : N, mandatory | NO ACTION | Every inventory_movements row must refer to one inventory row; one inventory row can have many inventory_movements rows. ON DELETE NO ACTION: the parent row cannot be deleted while child rows refer to it (checked at the end of the statement). |

#### Requests

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `resource_requests(camp_id)` | `relief_camps(camp_id)` | 1 : N, mandatory | RESTRICT | Every resource_requests row must refer to one relief_camps row; one relief_camps row can have many resource_requests rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `resource_requests(disaster_id)` | `disasters(disaster_id)` | 1 : N, mandatory | RESTRICT | Every resource_requests row must refer to one disasters row; one disasters row can have many resource_requests rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `resource_requests(requested_by)` | `app_users(user_id)` | 1 : N, mandatory | RESTRICT | Every resource_requests row must refer to one app_users row; one app_users row can have many resource_requests rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `request_items(request_id)` | `resource_requests(request_id)` | 1 : N, mandatory | CASCADE | Every request_items row must refer to one resource_requests row; one resource_requests row can have many request_items rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |
| `request_items(resource_id)` | `resources(resource_id)` | 1 : N, mandatory | RESTRICT | Every request_items row must refer to one resources row; one resources row can have many request_items rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |

#### Allocation

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `allocations(allocated_by)` | `app_users(user_id)` | 1 : N, mandatory | RESTRICT | Every allocations row must refer to one app_users row; one app_users row can have many allocations rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `allocations(request_id)` | `resource_requests(request_id)` | 1 : N, mandatory | RESTRICT | Every allocations row must refer to one resource_requests row; one resource_requests row can have many allocations rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `allocation_items(allocation_id, request_id)` | `allocations(allocation_id, request_id)` | 1 : N, mandatory | CASCADE | Every allocation_items row must refer to one allocations row; one allocations row can have many allocation_items rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |
| `allocation_items(request_id, resource_id)` | `request_items(request_id, resource_id)` | 1 : N, mandatory | RESTRICT | Every allocation_items row must refer to one request_items row; one request_items row can have many allocation_items rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `allocation_items(warehouse_id, resource_id)` | `inventory(warehouse_id, resource_id)` | 1 : N, mandatory | RESTRICT | Every allocation_items row must refer to one inventory row; one inventory row can have many allocation_items rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |

#### Logistics

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `vehicles(current_location_id)` | `locations(location_id)` | 1 : N, optional | SET NULL | A vehicles row may refer to one locations row; one locations row can have many vehicles rows. ON DELETE SET NULL: deleting the parent row sets this reference to NULL (the child row stays). |
| `deliveries(allocation_id)` | `allocations(allocation_id)` | 1 : N, mandatory | RESTRICT | Every deliveries row must refer to one allocations row; one allocations row can have many deliveries rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `deliveries(destination_location_id)` | `locations(location_id)` | 1 : N, mandatory | RESTRICT | Every deliveries row must refer to one locations row; one locations row can have many deliveries rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `deliveries(driver_id)` | `app_users(user_id)` | 1 : N, mandatory | RESTRICT | Every deliveries row must refer to one app_users row; one app_users row can have many deliveries rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `deliveries(source_location_id)` | `locations(location_id)` | 1 : N, mandatory | RESTRICT | Every deliveries row must refer to one locations row; one locations row can have many deliveries rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `deliveries(vehicle_id)` | `vehicles(vehicle_id)` | 1 : N, mandatory | RESTRICT | Every deliveries row must refer to one vehicles row; one vehicles row can have many deliveries rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `delivery_volunteers(delivery_id)` | `deliveries(delivery_id)` | 1 : N, mandatory | CASCADE | Every delivery_volunteers row must refer to one deliveries row; one deliveries row can have many delivery_volunteers rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |
| `delivery_volunteers(volunteer_id)` | `volunteers(volunteer_id)` | 1 : N, mandatory | CASCADE | Every delivery_volunteers row must refer to one volunteers row; one volunteers row can have many delivery_volunteers rows. ON DELETE CASCADE: deleting the parent row deletes these child rows too. |

#### History and system

| Child (FK columns) | → Parent | Cardinality | ON DELETE | Meaning |
|---|---|---|---|---|
| `audit_logs(user_id)` | `app_users(user_id)` | 1 : N, optional | RESTRICT | A audit_logs row may refer to one app_users row; one app_users row can have many audit_logs rows. ON DELETE RESTRICT: the parent row cannot be deleted while child rows refer to it. |
| `integration_sync_runs(triggered_by)` | `app_users(user_id)` | 1 : N, optional | SET NULL | A integration_sync_runs row may refer to one app_users row; one app_users row can have many integration_sync_runs rows. ON DELETE SET NULL: deleting the parent row sets this reference to NULL (the child row stays). |

---

## 4. DDL — how the database is created

DDL (Data Definition Language) is the part of SQL that defines structure: `CREATE`, `ALTER`, `DROP`, `COMMENT`, `GRANT`. ReliefFlow's DDL lives in `db/postgres/`. The base schema is run once on a new database; after that, **incremental migrations** are applied by `npm run db:migrate` (`scripts/migrate.ts`), each exactly once, recorded in `schema_migrations`. They only add things (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT … NOT VALID`), so existing data is never dropped or rewritten.

| File | What it does |
|---|---|
| `001_schema.sql` | Base schema: the 18 core tables with primary keys, foreign keys, CHECK constraints, the first indexes and the allocation triggers. |
| `002_seed.sql` | Reference data: the four roles and starter categories (INSERT). |
| `003_sql_demonstrations.sql` | Coursework examples of DDL/DML/queries (run manually; not part of the live schema). |
| `004_operational_demo.sql` | Optional demo data (INSERT only, safe to re-run). |
| `005_integrity_security.sql` | Hardening: sessions, login_attempts, audit_logs, inventory_movements; stricter CHECKs (NOT VALID), the reworked validation trigger and stock ledger trigger. |
| `006_allocation_history.sql` | Makes allocation history immutable and adds the allocation state-machine trigger with exact-once stock restoration. |
| `007_dbms_engineering.sql` | Foreign-key indexes, partial unique indexes against double booking, delivery triggers, the five views, functions and procedure, field-level audit (data_change_log), full-text search columns, integration_sync_runs and schema_migrations. |
| `008_rbac_dictionary.sql` | Database roles rf_admin / rf_coordinator / rf_field_officer / rf_driver with table and column GRANTs, row-level security on deliveries, SECURITY DEFINER history triggers, extra format CHECKs and COMMENT ON for every table and column. |

DDL techniques used, with an example of each:

| Technique | Example in ReliefFlow |
|---|---|
| `CREATE TABLE` with PK, FK, CHECK, UNIQUE, DEFAULT | every table below |
| Identity column | `allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| Generated (computed) column | `search_vector tsvector GENERATED ALWAYS AS (to_tsvector(...)) STORED` on disasters and resource_requests |
| `ALTER TABLE … ADD COLUMN IF NOT EXISTS` | disasters.event_location_id, search_vector (migration 007) |
| `ALTER TABLE … ADD CONSTRAINT … NOT VALID` | format and consistency checks added to a live database without rejecting old rows (005, 008) |
| `DROP … IF EXISTS` then re-create | triggers and constraints are re-created idempotently (`DROP TRIGGER IF EXISTS …; CREATE TRIGGER …`) |
| `CREATE INDEX` / `CREATE UNIQUE INDEX … WHERE` | FK indexes, GIN full-text and trigram indexes, partial unique indexes against double booking |
| `CREATE VIEW`, `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE TRIGGER` | Sections 5 and 6 |
| `CREATE ROLE`, `GRANT`, `REVOKE`, `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` | Section 5.5 (migration 008) |
| `COMMENT ON TABLE / COLUMN` | the data dictionary: every description in this document comes from these comments |

### 4.1 Every table

For each table: why it exists, its exact `CREATE TABLE` statement as it is installed now (reconstructed from the catalog, including constraints added later by ALTER), the columns explained, its indexes and triggers, who may access it, and the DML the application performs on it.

### Users and security

Who can sign in, with which role, and how sign-in is protected.

#### roles

**Purpose:** Application roles (ADMIN, RELIEF_COORDINATOR, FIELD_OFFICER, DRIVER).

**Why it exists:** Lists the four application roles. Every user points to exactly one role, so permissions can be decided from a single join.

Created in `001_schema.sql`.

```sql
CREATE TABLE roles (
  role_id bigint GENERATED ALWAYS AS IDENTITY,
  role_name character varying(40) NOT NULL,
  description text,
  CONSTRAINT roles_pkey PRIMARY KEY (role_id),
  CONSTRAINT roles_role_name_key UNIQUE (role_name)
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `role_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `role_name` | character varying(40) | UQ | NOT NULL | Unique role code used for authorisation. |
| `description` | text |  | nullable | Human-readable description of the role. |

**Indexes:**

* `roles_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON roles USING btree (role_id)`
* `roles_role_name_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON roles USING btree (role_name)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: SELECT
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT: the four rows are created once by the seed script (002_seed.sql).
* SELECT: joined to app_users on every request to know the signed-in user's role.
* No UPDATE or DELETE: roles are fixed; deleting one is blocked by the FK from app_users (RESTRICT).

#### app_users

**Purpose:** People who can sign in. Passwords are stored only as bcrypt hashes.

**Why it exists:** Everyone who can sign in. The password is never stored, only a bcrypt hash. Users are deactivated, never deleted, so the history of who did what stays intact.

Created in `001_schema.sql`.

```sql
CREATE TABLE app_users (
  user_id bigint GENERATED ALWAYS AS IDENTITY,
  role_id bigint NOT NULL,
  full_name character varying(120) NOT NULL,
  email character varying(254) NOT NULL,
  password_hash text NOT NULL,
  phone character varying(25),
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT app_users_pkey PRIMARY KEY (user_id),
  CONSTRAINT app_users_email_key UNIQUE (email),
  CONSTRAINT app_users_phone_key UNIQUE (phone),
  CONSTRAINT app_users_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT app_users_email_format CHECK (((email)::text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)) NOT VALID
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `user_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `role_id` | bigint | FK | NOT NULL | FK to roles: the user's single role. |
| `full_name` | character varying(120) |  | NOT NULL | Display name. |
| `email` | character varying(254) | UQ | NOT NULL | Login e-mail (alternate key, format-checked). |
| `password_hash` | text |  | NOT NULL | bcrypt hash (cost 12); readable only by rf_admin. |
| `phone` | character varying(25) | UQ | nullable | Optional unique phone number. |
| `is_active` | boolean |  | NOT NULL | FALSE blocks sign-in and invalidates sessions. |
| `created_at` | timestamp with time zone |  | NOT NULL | When the account was created. |

**CHECK constraints** (rules the database itself enforces):

* `app_users_email_format`: `CHECK (((email)::text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)) NOT VALID`

**Indexes:**

* `app_users_email_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON app_users USING btree (email)`
* `app_users_phone_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON app_users USING btree (phone)`
* `app_users_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON app_users USING btree (user_id)`

**Triggers on this table:**

* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: SELECT only on columns (created_at, full_name, is_active, role_id, user_id)
* `rf_driver`: SELECT only on columns (created_at, full_name, is_active, role_id, user_id)
* `rf_field_officer`: SELECT only on columns (created_at, full_name, is_active, role_id, user_id)
* Column privilege: only rf_admin may read password_hash; other database roles can read only user_id, role_id, full_name, is_active, created_at.

**DML performed on this table:**

* INSERT: an administrator creates a user (Administration → Users).
* UPDATE: change role, deactivate/reactivate, reset password. Each of these also DELETEs that user's sessions so the change takes effect immediately.
* No DELETE in the application (deactivate instead); RESTRICT FKs from requests, allocations, deliveries and logs would block it anyway.
* Trigger row_change_log records every change (without the password hash) in data_change_log.

#### sessions

**Purpose:** Server-side sessions. Only the SHA-256 hash of the cookie token is stored.

**Why it exists:** Server-side sessions. The browser cookie holds a random 256-bit token; the table holds only its SHA-256 hash, so a stolen database copy cannot be used to log in.

Created in `005_integrity_security.sql`.

```sql
CREATE TABLE sessions (
  token_hash text NOT NULL,
  user_id bigint NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (token_hash),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `token_hash` | text | PK | NOT NULL | SHA-256 of the random session token (primary key). |
| `user_id` | bigint | FK | NOT NULL | FK to app_users (cascade delete). |
| `expires_at` | timestamp with time zone |  | NOT NULL | Absolute expiry (8 hours after sign-in). |

**Indexes:**

* `idx_sessions_expiry` (B-tree): `ON sessions USING btree (expires_at)`
* `idx_sessions_user` (B-tree): `ON sessions USING btree (user_id)`
* `sessions_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON sessions USING btree (token_hash)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

**DML performed on this table:**

* INSERT: on successful sign-in (expires_at = now() + 8 hours).
* DELETE: on sign-out, on role change, deactivation and password reset (all of the user's sessions), and expired sessions are cleaned up at sign-in.
* SELECT: on every API call to authenticate the cookie (sessions ⋈ app_users ⋈ roles).

#### login_attempts

**Purpose:** Login throttling window per e-mail.

**Why it exists:** Brute-force protection: counts failed sign-ins per e-mail inside a 15-minute window.

Created in `005_integrity_security.sql`.

```sql
CREATE TABLE login_attempts (
  email text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  window_start timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT login_attempts_pkey PRIMARY KEY (email)
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `email` | text | PK | NOT NULL | Normalised e-mail being attempted (primary key). |
| `attempts` | integer |  | NOT NULL | Failed attempts in the current window. |
| `window_start` | timestamp with time zone |  | NOT NULL | Start of the 15-minute window. |

**Indexes:**

* `login_attempts_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON login_attempts USING btree (email)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

**DML performed on this table:**

* INSERT … ON CONFLICT DO NOTHING: creates the counter row for an e-mail.
* SELECT … FOR UPDATE: locks the counter so parallel guesses are counted correctly.
* UPDATE: attempts = attempts + 1 on failure, or reset when the window has expired.
* DELETE: on successful sign-in.

### Disasters and places

The events being responded to and the places they affect.

#### locations

**Purpose:** Places: districts, camp areas, depots. Coordinates drive the map and distances.

**Why it exists:** Every place in the system (districts, camp sites, depots) with optional coordinates. Camps, warehouses, disasters, deliveries and vehicles all point here, so a place is stored once.

Created in `001_schema.sql`.

```sql
CREATE TABLE locations (
  location_id bigint GENERATED ALWAYS AS IDENTITY,
  location_name character varying(160) NOT NULL,
  location_type character varying(40) NOT NULL,
  address text NOT NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  CONSTRAINT locations_pkey PRIMARY KEY (location_id),
  CONSTRAINT locations_latitude_check CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
  CONSTRAINT locations_longitude_check CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
  CONSTRAINT locations_nonblank CHECK ((length(btrim((location_name)::text)) >= 2)) NOT VALID
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `location_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `location_name` | character varying(160) |  | NOT NULL | Name of the place. |
| `location_type` | character varying(40) |  | NOT NULL | DISTRICT, CAMP_AREA, DEPOT, WARD, ... |
| `address` | text |  | NOT NULL | Postal/landmark address. |
| `latitude` | numeric(9,6) |  | nullable | WGS-84 latitude (-90..90). |
| `longitude` | numeric(9,6) |  | nullable | WGS-84 longitude (-180..180). |

**CHECK constraints** (rules the database itself enforces):

* `locations_latitude_check`: `CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)))`
* `locations_longitude_check`: `CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)))`
* `locations_nonblank`: `CHECK ((length(btrim((location_name)::text)) >= 2)) NOT VALID`

**Indexes:**

* `idx_locations_name_trgm` (GIN): `ON locations USING gin (location_name gin_trgm_ops)`
* `locations_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON locations USING btree (location_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT / UPDATE: management screen (Locations).
* DELETE: allowed only while nothing refers to the location — every FK to locations is RESTRICT or SET NULL.

#### disasters

**Purpose:** Disaster events being responded to.

**Why it exists:** The events being responded to. Severity and status drive the dashboard; search_vector is a generated full-text column for searching.

Created in `001_schema.sql`.

```sql
CREATE TABLE disasters (
  disaster_id bigint GENERATED ALWAYS AS IDENTITY,
  disaster_name character varying(160) NOT NULL,
  disaster_type character varying(50) NOT NULL,
  severity character varying(20) NOT NULL,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
  description text,
  created_by bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  event_location_id bigint,
  search_vector tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, (COALESCE(disaster_name, ''::character varying))::text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, (COALESCE(disaster_type, ''::character varying))::text), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'C'::"char"))) STORED,
  CONSTRAINT disasters_pkey PRIMARY KEY (disaster_id),
  CONSTRAINT disasters_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT disasters_event_location_id_fkey FOREIGN KEY (event_location_id) REFERENCES locations(location_id),
  CONSTRAINT disaster_nonblank CHECK ((length(btrim((disaster_name)::text)) >= 2)) NOT VALID,
  CONSTRAINT disasters_check CHECK (((ended_at IS NULL) OR (ended_at >= started_at))),
  CONSTRAINT disasters_severity_check CHECK (((severity)::text = ANY ((ARRAY['LOW'::character varying, 'MODERATE'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
  CONSTRAINT disasters_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'CONTAINED'::character varying, 'CLOSED'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `disaster_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `disaster_name` | character varying(160) |  | NOT NULL | Event name (duplicate events rejected by trigger). |
| `disaster_type` | character varying(50) |  | NOT NULL | FLOOD, CYCLONE, EARTHQUAKE, ... |
| `severity` | character varying(20) |  | NOT NULL | LOW, MODERATE, HIGH or CRITICAL. |
| `started_at` | timestamp with time zone |  | NOT NULL | When the event started. |
| `ended_at` | timestamp with time zone |  | nullable | When it was closed (must be after started_at). |
| `status` | character varying(20) |  | NOT NULL | ACTIVE, CONTAINED or CLOSED. |
| `description` | text |  | nullable | Free-text situation summary. |
| `created_by` | bigint | FK | NOT NULL | FK to the coordinator who registered it. |
| `created_at` | timestamp with time zone |  | NOT NULL | Registration time. |
| `event_location_id` | bigint | FK | nullable | FK to the main event location. |
| `search_vector` | tsvector (generated) |  | nullable | Generated tsvector for full-text search (GIN indexed). |

**CHECK constraints** (rules the database itself enforces):

* `disaster_nonblank`: `CHECK ((length(btrim((disaster_name)::text)) >= 2)) NOT VALID`
* `disasters_check`: `CHECK (((ended_at IS NULL) OR (ended_at >= started_at)))`
* `disasters_severity_check`: `CHECK (((severity)::text = ANY ((ARRAY['LOW'::character varying, 'MODERATE'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[])))`
* `disasters_status_check`: `CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'CONTAINED'::character varying, 'CLOSED'::character varying])::text[])))`

**Indexes:**

* `disasters_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON disasters USING btree (disaster_id)`
* `idx_disasters_fts` (GIN): `ON disasters USING gin (search_vector)`
* `idx_disasters_status_severity` (B-tree): `ON disasters USING btree (status, severity)`

**Triggers on this table:**

* `operational_duplicate` → function `prevent_operational_duplicate()`: Stops the same disaster or warehouse being entered twice with slightly different spelling. (`BEFORE INSERT OR UPDATE OF disaster_name, disaster_type, started_at, event_location_id FOR EACH ROW`)
* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT: Disasters → New, in the same transaction as its disaster_locations rows.
* UPDATE: edit details or close the disaster (with optimistic locking on xmin).
* No DELETE: requests and incident reports refer to disasters (RESTRICT).
* Triggers: operational_duplicate rejects the same event entered twice; row_change_log keeps field-level history.

#### disaster_locations

**Purpose:** M:N: which locations a disaster affects, with impact attributes.

**Why it exists:** Resolves the many-to-many relationship Disaster AFFECTS Location. The relationship has its own attributes (impact level, affected population, reported time), which is why it is a table.

Created in `001_schema.sql`.

```sql
CREATE TABLE disaster_locations (
  disaster_id bigint NOT NULL,
  location_id bigint NOT NULL,
  impact_level character varying(20) NOT NULL,
  affected_population integer DEFAULT 0 NOT NULL,
  reported_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT disaster_locations_pkey PRIMARY KEY (disaster_id, location_id),
  CONSTRAINT disaster_locations_disaster_id_fkey FOREIGN KEY (disaster_id) REFERENCES disasters(disaster_id) ON DELETE CASCADE,
  CONSTRAINT disaster_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE RESTRICT,
  CONSTRAINT disaster_locations_affected_population_check CHECK ((affected_population >= 0)),
  CONSTRAINT disaster_locations_impact_level_check CHECK (((impact_level)::text = ANY ((ARRAY['LOW'::character varying, 'MODERATE'::character varying, 'HIGH'::character varying, 'SEVERE'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `disaster_id` | bigint | PK, FK | NOT NULL | PK part / FK to disasters. |
| `location_id` | bigint | PK, FK | NOT NULL | PK part / FK to locations. |
| `impact_level` | character varying(20) |  | NOT NULL | LOW, MODERATE, HIGH or SEVERE. |
| `affected_population` | integer |  | NOT NULL | People affected at this location (>= 0). |
| `reported_at` | timestamp with time zone |  | NOT NULL | When the impact was reported. |

**CHECK constraints** (rules the database itself enforces):

* `disaster_locations_affected_population_check`: `CHECK ((affected_population >= 0))`
* `disaster_locations_impact_level_check`: `CHECK (((impact_level)::text = ANY ((ARRAY['LOW'::character varying, 'MODERATE'::character varying, 'HIGH'::character varying, 'SEVERE'::character varying])::text[])))`

**Indexes:**

* `disaster_locations_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON disaster_locations USING btree (disaster_id, location_id)`
* `idx_disaster_locations_location` (B-tree): `ON disaster_locations USING btree (location_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT: when a disaster is created, and later via 'add affected location'.
* Deleted automatically with its disaster (ON DELETE CASCADE).

### Shelters

Relief camps that house affected people and raise requests.

#### relief_camps

**Purpose:** Shelters with capacity and current occupancy.

**Why it exists:** Shelters. CHECK constraints keep occupancy between 0 and capacity and keep status consistent with occupancy (FULL only when full, CLOSED only when empty).

Created in `001_schema.sql`.

```sql
CREATE TABLE relief_camps (
  camp_id bigint GENERATED ALWAYS AS IDENTITY,
  location_id bigint NOT NULL,
  camp_name character varying(160) NOT NULL,
  capacity integer NOT NULL,
  current_population integer DEFAULT 0 NOT NULL,
  manager_id bigint,
  status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
  established_at date DEFAULT CURRENT_DATE NOT NULL,
  CONSTRAINT relief_camps_pkey PRIMARY KEY (camp_id),
  CONSTRAINT relief_camps_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE RESTRICT,
  CONSTRAINT relief_camps_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES app_users(user_id) ON DELETE SET NULL,
  CONSTRAINT camp_status_occupancy CHECK (((((status)::text = 'CLOSED'::text) AND (current_population = 0)) OR (((status)::text = 'FULL'::text) AND (current_population = capacity)) OR (((status)::text = 'OPEN'::text) AND (current_population < capacity)))) NOT VALID,
  CONSTRAINT relief_camps_capacity_check CHECK ((capacity > 0)),
  CONSTRAINT relief_camps_check CHECK (((current_population >= 0) AND (current_population <= capacity))),
  CONSTRAINT relief_camps_status_check CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'FULL'::character varying, 'CLOSED'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `camp_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `location_id` | bigint | FK | NOT NULL | FK to the camp location. |
| `camp_name` | character varying(160) |  | NOT NULL | Camp name. |
| `capacity` | integer |  | NOT NULL | Maximum people (> 0). |
| `current_population` | integer |  | NOT NULL | People sheltered now (0..capacity). |
| `manager_id` | bigint | FK | nullable | Optional FK to the managing user. |
| `status` | character varying(20) |  | NOT NULL | OPEN, FULL (= at capacity) or CLOSED (= empty). |
| `established_at` | date |  | NOT NULL | Opening date. |

**CHECK constraints** (rules the database itself enforces):

* `camp_status_occupancy`: `CHECK (((((status)::text = 'CLOSED'::text) AND (current_population = 0)) OR (((status)::text = 'FULL'::text) AND (current_population = capacity)) OR (((status)::text = 'OPEN'::text) AND (current_population < capacity)))) NOT VALID`
* `relief_camps_capacity_check`: `CHECK ((capacity > 0))`
* `relief_camps_check`: `CHECK (((current_population >= 0) AND (current_population <= capacity)))`
* `relief_camps_status_check`: `CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'FULL'::character varying, 'CLOSED'::character varying])::text[])))`

**Indexes:**

* `idx_relief_camps_location` (B-tree): `ON relief_camps USING btree (location_id)`
* `relief_camps_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON relief_camps USING btree (camp_id)`

**Triggers on this table:**

* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT
* `rf_field_officer`: UPDATE only on columns (current_population, status)
* Column privilege: a field officer (rf_field_officer) may UPDATE only current_population and status.

**DML performed on this table:**

* INSERT / UPDATE: management screen (with xmin optimistic locking).
* UPDATE (admit / discharge): an atomic relative update — SET current_population = current_population + $n, status recomputed in the same statement — so 12 simultaneous admissions are all counted.
* No DELETE: camps are closed (status = CLOSED); requests refer to them (RESTRICT).
* Trigger row_change_log records changes.

### Stock

What relief items exist, where they are stored and how much is left.

#### resource_categories

**Purpose:** Groups of resources (FOOD, WATER, MEDICAL, ...).

**Why it exists:** Groups resources (FOOD, WATER, MEDICAL, SHELTER, HYGIENE, ENERGY) for filtering and analytics.

Created in `001_schema.sql`.

```sql
CREATE TABLE resource_categories (
  category_id bigint GENERATED ALWAYS AS IDENTITY,
  category_name character varying(80) NOT NULL,
  description text,
  CONSTRAINT resource_categories_pkey PRIMARY KEY (category_id),
  CONSTRAINT resource_categories_category_name_key UNIQUE (category_name)
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `category_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `category_name` | character varying(80) | UQ | NOT NULL | Unique category code. |
| `description` | text |  | nullable | Description. |

**Indexes:**

* `resource_categories_category_name_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON resource_categories USING btree (category_name)`
* `resource_categories_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON resource_categories USING btree (category_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT / UPDATE / DELETE: management screen. DELETE is refused while resources use the category (RESTRICT).

#### resources

**Purpose:** Catalogue of relief items, each with a unit of measure.

**Why it exists:** The catalogue of relief items, each with a unit of measure (litre, packet, kit…). A resource exists once; stock of it lives in inventory.

Created in `001_schema.sql`.

```sql
CREATE TABLE resources (
  resource_id bigint GENERATED ALWAYS AS IDENTITY,
  category_id bigint NOT NULL,
  resource_name character varying(120) NOT NULL,
  unit character varying(30) NOT NULL,
  description text,
  is_perishable boolean DEFAULT false NOT NULL,
  CONSTRAINT resources_pkey PRIMARY KEY (resource_id),
  CONSTRAINT resources_category_id_resource_name_key UNIQUE (category_id, resource_name),
  CONSTRAINT resources_category_id_fkey FOREIGN KEY (category_id) REFERENCES resource_categories(category_id) ON DELETE RESTRICT,
  CONSTRAINT resources_nonblank CHECK (((length(btrim((resource_name)::text)) >= 2) AND (length(btrim((unit)::text)) >= 1))) NOT VALID
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `resource_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `category_id` | bigint | FK | NOT NULL | FK to resource_categories. |
| `resource_name` | character varying(120) |  | NOT NULL | Item name (unique within its category). |
| `unit` | character varying(30) |  | NOT NULL | Unit of measure: kg, litre, kit, piece ... |
| `description` | text |  | nullable | Optional notes. |
| `is_perishable` | boolean |  | NOT NULL | TRUE for items with limited shelf life. |

**CHECK constraints** (rules the database itself enforces):

* `resources_nonblank`: `CHECK (((length(btrim((resource_name)::text)) >= 2) AND (length(btrim((unit)::text)) >= 1))) NOT VALID`

**Indexes:**

* `resources_category_id_resource_name_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON resources USING btree (category_id, resource_name)`
* `resources_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON resources USING btree (resource_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT / UPDATE / DELETE: management screen. DELETE is refused once the resource is stocked or requested (RESTRICT).

#### warehouses

**Purpose:** Storage sites holding stock.

**Why it exists:** Storage sites. A warehouse must be ACTIVE to supply stock (checked by the allocation trigger).

Created in `001_schema.sql`.

```sql
CREATE TABLE warehouses (
  warehouse_id bigint GENERATED ALWAYS AS IDENTITY,
  location_id bigint NOT NULL,
  warehouse_name character varying(160) NOT NULL,
  manager_id bigint,
  capacity numeric(14,2) NOT NULL,
  status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
  CONSTRAINT warehouses_pkey PRIMARY KEY (warehouse_id),
  CONSTRAINT warehouses_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(location_id) ON DELETE RESTRICT,
  CONSTRAINT warehouses_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES app_users(user_id) ON DELETE SET NULL,
  CONSTRAINT warehouse_nonblank CHECK ((length(btrim((warehouse_name)::text)) >= 2)) NOT VALID,
  CONSTRAINT warehouses_capacity_check CHECK ((capacity > (0)::numeric)),
  CONSTRAINT warehouses_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'MAINTENANCE'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `warehouse_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `location_id` | bigint | FK | NOT NULL | FK to the warehouse location. |
| `warehouse_name` | character varying(160) |  | NOT NULL | Name (unique per location via trigger). |
| `manager_id` | bigint | FK | nullable | Optional FK to the managing user. |
| `capacity` | numeric(14,2) |  | NOT NULL | Storage capacity (> 0). |
| `status` | character varying(20) |  | NOT NULL | ACTIVE, INACTIVE or MAINTENANCE; only ACTIVE supplies stock. |

**CHECK constraints** (rules the database itself enforces):

* `warehouse_nonblank`: `CHECK ((length(btrim((warehouse_name)::text)) >= 2)) NOT VALID`
* `warehouses_capacity_check`: `CHECK ((capacity > (0)::numeric))`
* `warehouses_status_check`: `CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'MAINTENANCE'::character varying])::text[])))`

**Indexes:**

* `idx_warehouses_location` (B-tree): `ON warehouses USING btree (location_id)`
* `warehouses_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON warehouses USING btree (warehouse_id)`

**Triggers on this table:**

* `operational_duplicate` → function `prevent_operational_duplicate()`: Stops the same disaster or warehouse being entered twice with slightly different spelling. (`BEFORE INSERT OR UPDATE OF warehouse_name, location_id FOR EACH ROW`)
* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT / UPDATE: management screen; status INACTIVE instead of delete.
* Triggers: operational_duplicate (same name at the same location → rejected), row_change_log.

#### inventory

**Purpose:** Stock line: quantity of one resource in one warehouse (weak entity).

**Why it exists:** A stock line: how much of one resource one warehouse holds. It is a weak entity — identified by (warehouse_id, resource_id) — and the quantity can never go negative (CHECK).

Created in `001_schema.sql`.

```sql
CREATE TABLE inventory (
  warehouse_id bigint NOT NULL,
  resource_id bigint NOT NULL,
  quantity_available numeric(14,3) DEFAULT 0 NOT NULL,
  minimum_threshold numeric(14,3) DEFAULT 0 NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT inventory_pkey PRIMARY KEY (warehouse_id, resource_id),
  CONSTRAINT inventory_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_minimum_threshold_check CHECK ((minimum_threshold >= (0)::numeric)),
  CONSTRAINT inventory_quantity_available_check CHECK ((quantity_available >= (0)::numeric))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `warehouse_id` | bigint | PK, FK | NOT NULL | PK part / FK to warehouses. |
| `resource_id` | bigint | PK, FK | NOT NULL | PK part / FK to resources. |
| `quantity_available` | numeric(14,3) |  | NOT NULL | Units on hand (CHECK >= 0). |
| `minimum_threshold` | numeric(14,3) |  | NOT NULL | Low-stock alert level. |
| `last_updated` | timestamp with time zone |  | NOT NULL | Time of the last stock change. |

**CHECK constraints** (rules the database itself enforces):

* `inventory_minimum_threshold_check`: `CHECK ((minimum_threshold >= (0)::numeric))`
* `inventory_quantity_available_check`: `CHECK ((quantity_available >= (0)::numeric))`

**Indexes:**

* `idx_inventory_resource` (B-tree): `ON inventory USING btree (resource_id)`
* `inventory_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON inventory USING btree (warehouse_id, resource_id)`

**Triggers on this table:**

* `inventory_history` → function `record_inventory_movement()`: Writes the stock ledger: every change of inventory.quantity_available becomes a row in inventory_movements. (`AFTER INSERT OR UPDATE OF quantity_available FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT … ON CONFLICT DO NOTHING: creates the stock line the first time a resource is stocked in a warehouse.
* UPDATE (adjust stock): locks the line FOR UPDATE, checks the expected quantity (optimistic concurrency), sets the new quantity with a reason.
* UPDATE by triggers: allocation lines deduct stock (trg_adjust_inventory); a cancelled allocation restores it (allocation_status_guard).
* Trigger inventory_history writes every change to inventory_movements.

#### inventory_movements

**Purpose:** Every stock change with its reason (written by trigger).

**Why it exists:** Every stock change with its delta and reason — the full stock ledger.

Created in `005_integrity_security.sql`.

```sql
CREATE TABLE inventory_movements (
  movement_id bigint GENERATED ALWAYS AS IDENTITY,
  warehouse_id bigint NOT NULL,
  resource_id bigint NOT NULL,
  delta numeric(14,3) NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT inventory_movements_pkey PRIMARY KEY (movement_id),
  CONSTRAINT inventory_movements_warehouse_id_resource_id_fkey FOREIGN KEY (warehouse_id, resource_id) REFERENCES inventory(warehouse_id, resource_id)
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `movement_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `warehouse_id` | bigint | FK | NOT NULL | Composite FK part to inventory. |
| `resource_id` | bigint | FK | NOT NULL | Composite FK part to inventory. |
| `delta` | numeric(14,3) |  | NOT NULL | Signed change (+ received, - dispatched). |
| `reason` | text |  | NOT NULL | Why stock changed. |
| `created_at` | timestamp with time zone |  | NOT NULL | When it changed. |

**Indexes:**

* `idx_inventory_movements_created` (B-tree): `ON inventory_movements USING btree (created_at)`
* `idx_inventory_movements_stock` (B-tree): `ON inventory_movements USING btree (warehouse_id, resource_id, created_at DESC)`
* `inventory_movements_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON inventory_movements USING btree (movement_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: SELECT

**DML performed on this table:**

* INSERT: only by the trigger record_inventory_movement. No database role may write it directly (no INSERT grant), so the ledger cannot be forged.
* SELECT: Stock movements screen and analytics.

### Requests

What a camp asks for: one header row and one line per resource.

#### resource_requests

**Purpose:** A camp's request for resources (header).

**Why it exists:** The header of a camp's request: who raised it, when it is needed, priority and status. Status follows a state machine and is recomputed by the procedure refresh_request_status.

Created in `001_schema.sql`.

```sql
CREATE TABLE resource_requests (
  request_id bigint GENERATED ALWAYS AS IDENTITY,
  camp_id bigint NOT NULL,
  disaster_id bigint NOT NULL,
  requested_by bigint NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  need_by timestamp with time zone NOT NULL,
  priority_score numeric(5,2) DEFAULT 0 NOT NULL,
  priority_level character varying(20) DEFAULT 'MEDIUM'::character varying NOT NULL,
  status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
  medical_emergency boolean DEFAULT false NOT NULL,
  remarks text,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(remarks, ''::text))) STORED,
  CONSTRAINT resource_requests_pkey PRIMARY KEY (request_id),
  CONSTRAINT resource_requests_camp_id_fkey FOREIGN KEY (camp_id) REFERENCES relief_camps(camp_id) ON DELETE RESTRICT,
  CONSTRAINT resource_requests_disaster_id_fkey FOREIGN KEY (disaster_id) REFERENCES disasters(disaster_id) ON DELETE RESTRICT,
  CONSTRAINT resource_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT resource_requests_check CHECK ((need_by >= requested_at)),
  CONSTRAINT resource_requests_priority_consistency CHECK ((NOT (((priority_level)::text = 'CRITICAL'::text) AND (priority_score < (50)::numeric)))) NOT VALID,
  CONSTRAINT resource_requests_priority_level_check CHECK (((priority_level)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
  CONSTRAINT resource_requests_priority_score_check CHECK (((priority_score >= (0)::numeric) AND (priority_score <= (100)::numeric))),
  CONSTRAINT resource_requests_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'PARTIALLY_FULFILLED'::character varying, 'FULFILLED'::character varying, 'ALLOCATED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `request_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `camp_id` | bigint | FK | NOT NULL | FK to the requesting camp. |
| `disaster_id` | bigint | FK | NOT NULL | FK to the disaster it relates to. |
| `requested_by` | bigint | FK | NOT NULL | FK to the field officer who raised it (taken from the session). |
| `requested_at` | timestamp with time zone |  | NOT NULL | When it was raised. |
| `need_by` | timestamp with time zone |  | NOT NULL | Deadline (must be after requested_at). |
| `priority_score` | numeric(5,2) |  | NOT NULL | Priority 0..100. |
| `priority_level` | character varying(20) |  | NOT NULL | LOW, MEDIUM, HIGH or CRITICAL. |
| `status` | character varying(20) |  | NOT NULL | PENDING → APPROVED → PARTIALLY_FULFILLED/ALLOCATED → IN_TRANSIT → DELIVERED, or REJECTED/CANCELLED. |
| `medical_emergency` | boolean |  | NOT NULL | Flag that moves the request to the top. |
| `remarks` | text |  | nullable | Situation notes. |
| `search_vector` | tsvector (generated) |  | nullable | Generated tsvector over remarks (GIN indexed). |

**CHECK constraints** (rules the database itself enforces):

* `resource_requests_check`: `CHECK ((need_by >= requested_at))`
* `resource_requests_priority_consistency`: `CHECK ((NOT (((priority_level)::text = 'CRITICAL'::text) AND (priority_score < (50)::numeric)))) NOT VALID`
* `resource_requests_priority_level_check`: `CHECK (((priority_level)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[])))`
* `resource_requests_priority_score_check`: `CHECK (((priority_score >= (0)::numeric) AND (priority_score <= (100)::numeric)))`
* `resource_requests_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'PARTIALLY_FULFILLED'::character varying, 'FULFILLED'::character varying, 'ALLOCATED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[])))`

**Indexes:**

* `idx_requests_camp` (B-tree): `ON resource_requests USING btree (camp_id)`
* `idx_requests_disaster` (B-tree): `ON resource_requests USING btree (disaster_id)`
* `idx_requests_fts` (GIN): `ON resource_requests USING gin (search_vector)`
* `idx_requests_status_priority` (B-tree): `ON resource_requests USING btree (status, priority_level, need_by)`
* `resource_requests_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON resource_requests USING btree (request_id)`

**Triggers on this table:**

* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: INSERT, SELECT
* `rf_driver`: UPDATE only on columns (status)

**DML performed on this table:**

* INSERT: New request (with its request_items in the same transaction). Before inserting, lock_request_parents() checks with FOR SHARE that the camp is open and the disaster active.
* UPDATE: approve / reject / cancel (only legal transitions), and CALL refresh_request_status() after allocations and deliveries.
* No DELETE (cancel instead).
* Trigger row_change_log records changes.

#### request_items

**Purpose:** Lines of a request: resource and quantity (weak entity).

**Why it exists:** The lines of a request (weak entity): which resource and how much. PK (request_id, resource_id) means a resource can appear only once per request.

Created in `001_schema.sql`.

```sql
CREATE TABLE request_items (
  request_id bigint NOT NULL,
  resource_id bigint NOT NULL,
  quantity_requested numeric(14,3) NOT NULL,
  CONSTRAINT request_items_pkey PRIMARY KEY (request_id, resource_id),
  CONSTRAINT request_items_request_id_fkey FOREIGN KEY (request_id) REFERENCES resource_requests(request_id) ON DELETE CASCADE,
  CONSTRAINT request_items_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE RESTRICT,
  CONSTRAINT request_items_quantity_requested_check CHECK ((quantity_requested > (0)::numeric))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `request_id` | bigint | PK, FK | NOT NULL | PK part / FK to resource_requests (cascade). |
| `resource_id` | bigint | PK, FK | NOT NULL | PK part / FK to resources. |
| `quantity_requested` | numeric(14,3) |  | NOT NULL | Quantity asked for (> 0). |

**CHECK constraints** (rules the database itself enforces):

* `request_items_quantity_requested_check`: `CHECK ((quantity_requested > (0)::numeric))`

**Indexes:**

* `idx_request_items_resource` (B-tree): `ON request_items USING btree (resource_id)`
* `request_items_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON request_items USING btree (request_id, resource_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: INSERT, SELECT

**DML performed on this table:**

* INSERT: together with the request header, via INSERT … SELECT FROM unnest($ids, $quantities).
* Deleted automatically with the request (ON DELETE CASCADE).

### Allocation

Stock committed from warehouses to a request.

#### allocations

**Purpose:** Commitment of stock to a request.

**Why it exists:** A commitment of stock to a request. Status: ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED.

Created in `001_schema.sql`.

```sql
CREATE TABLE allocations (
  allocation_id bigint GENERATED ALWAYS AS IDENTITY,
  request_id bigint NOT NULL,
  allocated_by bigint NOT NULL,
  allocated_at timestamp with time zone DEFAULT now() NOT NULL,
  status character varying(20) DEFAULT 'ALLOCATED'::character varying NOT NULL,
  remarks text,
  CONSTRAINT allocations_pkey PRIMARY KEY (allocation_id),
  CONSTRAINT allocations_allocation_id_request_id_key UNIQUE (allocation_id, request_id),
  CONSTRAINT allocations_allocated_by_fkey FOREIGN KEY (allocated_by) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT allocations_request_id_fkey FOREIGN KEY (request_id) REFERENCES resource_requests(request_id) ON DELETE RESTRICT,
  CONSTRAINT allocations_status_check CHECK (((status)::text = ANY ((ARRAY['ALLOCATED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'CANCELLED'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `allocation_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `request_id` | bigint | FK | NOT NULL | FK to the request being fulfilled. |
| `allocated_by` | bigint | FK | NOT NULL | FK to the coordinator who allocated. |
| `allocated_at` | timestamp with time zone |  | NOT NULL | When stock was committed. |
| `status` | character varying(20) |  | NOT NULL | ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED (stock restored). |
| `remarks` | text |  | nullable | Optional notes. |

**CHECK constraints** (rules the database itself enforces):

* `allocations_status_check`: `CHECK (((status)::text = ANY ((ARRAY['ALLOCATED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'CANCELLED'::character varying])::text[])))`

**Indexes:**

* `allocations_allocation_id_request_id_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON allocations USING btree (allocation_id, request_id)`
* `allocations_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON allocations USING btree (allocation_id)`
* `idx_allocations_request` (B-tree): `ON allocations USING btree (request_id)`

**Triggers on this table:**

* `allocation_status_guard` → function `allocation_status_guard()`: State machine for allocations, and exact-once stock restoration on cancellation. (`BEFORE UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT
* `rf_driver`: UPDATE only on columns (status)

**DML performed on this table:**

* INSERT: Plan allocation (with its allocation_items in the same transaction).
* UPDATE status: by the delivery flow (IN_TRANSIT, DELIVERED) or a cancellation (CANCELLED). The trigger allocation_status_guard enforces the state machine and restores stock on cancellation.
* No DELETE: the FK from allocation_items and the immutability rules keep allocation history.

#### allocation_items

**Purpose:** Allocation lines: how much of which resource from which warehouse (immutable).

**Why it exists:** The lines of an allocation: how much of which resource from which warehouse. Three composite foreign keys guarantee that you can only allocate a resource the request asked for, from a warehouse that stocks it.

Created in `001_schema.sql`.

```sql
CREATE TABLE allocation_items (
  allocation_item_id bigint GENERATED ALWAYS AS IDENTITY,
  allocation_id bigint NOT NULL,
  request_id bigint NOT NULL,
  resource_id bigint NOT NULL,
  warehouse_id bigint NOT NULL,
  quantity_allocated numeric(14,3) NOT NULL,
  CONSTRAINT allocation_items_pkey PRIMARY KEY (allocation_item_id),
  CONSTRAINT allocation_items_allocation_id_request_id_fkey FOREIGN KEY (allocation_id, request_id) REFERENCES allocations(allocation_id, request_id) ON DELETE CASCADE,
  CONSTRAINT allocation_items_request_id_resource_id_fkey FOREIGN KEY (request_id, resource_id) REFERENCES request_items(request_id, resource_id) ON DELETE RESTRICT,
  CONSTRAINT allocation_items_warehouse_id_resource_id_fkey FOREIGN KEY (warehouse_id, resource_id) REFERENCES inventory(warehouse_id, resource_id) ON DELETE RESTRICT,
  CONSTRAINT allocation_items_quantity_allocated_check CHECK ((quantity_allocated > (0)::numeric))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `allocation_item_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `allocation_id` | bigint | FK | NOT NULL | Composite FK (allocation_id, request_id) to allocations. |
| `request_id` | bigint | FK | NOT NULL | Shared by two composite FKs: ties the line to its request line. |
| `resource_id` | bigint | FK | NOT NULL | Composite FK part to request_items and inventory. |
| `warehouse_id` | bigint | FK | NOT NULL | Composite FK part to inventory (the stock drawn from). |
| `quantity_allocated` | numeric(14,3) |  | NOT NULL | Quantity committed (> 0, <= stock and outstanding demand). |

**CHECK constraints** (rules the database itself enforces):

* `allocation_items_quantity_allocated_check`: `CHECK ((quantity_allocated > (0)::numeric))`

**Indexes:**

* `allocation_items_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON allocation_items USING btree (allocation_item_id)`
* `idx_allocation_items_allocation` (B-tree): `ON allocation_items USING btree (allocation_id)`
* `idx_allocation_items_request` (B-tree): `ON allocation_items USING btree (request_id, resource_id)`
* `idx_allocation_items_stock` (B-tree): `ON allocation_items USING btree (warehouse_id, resource_id)`

**Triggers on this table:**

* `trg_adjust_inventory` → function `adjust_inventory_for_allocation()`: Keeps stock in step with allocation lines automatically, in the same transaction. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)
* `trg_validate_allocation_item` → function `validate_allocation_item()`: Guards every allocation line before it is written: the request must be approved, the allocation active, the warehouse active, and the quantity must not exceed the stock or the outstanding demand. (`BEFORE INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT only. The BEFORE trigger validate_allocation_item checks stock and outstanding demand; the AFTER trigger trg_adjust_inventory deducts the stock.
* No UPDATE or DELETE: both are rejected by the trigger ('Allocation lines are immutable'), so allocation history cannot be rewritten.

### Logistics

Getting allocated stock to the camp: vehicles, drivers, volunteer crews.

#### vehicles

**Purpose:** Fleet used for deliveries.

**Why it exists:** The fleet. A vehicle has one current status and an optional last known location.

Created in `001_schema.sql`.

```sql
CREATE TABLE vehicles (
  vehicle_id bigint GENERATED ALWAYS AS IDENTITY,
  vehicle_number character varying(30) NOT NULL,
  vehicle_type character varying(50) NOT NULL,
  capacity numeric(14,2) NOT NULL,
  status character varying(20) DEFAULT 'AVAILABLE'::character varying NOT NULL,
  current_location_id bigint,
  CONSTRAINT vehicles_pkey PRIMARY KEY (vehicle_id),
  CONSTRAINT vehicles_vehicle_number_key UNIQUE (vehicle_number),
  CONSTRAINT vehicles_current_location_id_fkey FOREIGN KEY (current_location_id) REFERENCES locations(location_id) ON DELETE SET NULL,
  CONSTRAINT vehicles_capacity_check CHECK ((capacity > (0)::numeric)),
  CONSTRAINT vehicles_status_check CHECK (((status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'IN_USE'::character varying, 'MAINTENANCE'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `vehicle_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `vehicle_number` | character varying(30) | UQ | NOT NULL | Registration number (alternate key). |
| `vehicle_type` | character varying(50) |  | NOT NULL | TRUCK, VAN, BOAT, ... |
| `capacity` | numeric(14,2) |  | NOT NULL | Load capacity (> 0). |
| `status` | character varying(20) |  | NOT NULL | AVAILABLE, IN_USE or MAINTENANCE. |
| `current_location_id` | bigint | FK | nullable | Optional FK to the last known location. |

**CHECK constraints** (rules the database itself enforces):

* `vehicles_capacity_check`: `CHECK ((capacity > (0)::numeric))`
* `vehicles_status_check`: `CHECK (((status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'IN_USE'::character varying, 'MAINTENANCE'::character varying])::text[])))`

**Indexes:**

* `vehicles_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON vehicles USING btree (vehicle_id)`
* `vehicles_vehicle_number_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON vehicles USING btree (vehicle_number)`

**Triggers on this table:**

* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT
* `rf_driver`: UPDATE only on columns (current_location_id, status)
* Column privilege: a driver may UPDATE only status and current_location_id.

**DML performed on this table:**

* INSERT / UPDATE / DELETE: management screen (DELETE refused once used in a delivery).
* UPDATE status: set to IN_USE when a delivery is planned, back to AVAILABLE when it is delivered or cancelled.
* Trigger row_change_log records changes.

#### volunteers

**Purpose:** Volunteers who can crew deliveries.

**Why it exists:** People who can crew deliveries. availability_status prevents assigning the same volunteer twice.

Created in `001_schema.sql`.

```sql
CREATE TABLE volunteers (
  volunteer_id bigint GENERATED ALWAYS AS IDENTITY,
  full_name character varying(120) NOT NULL,
  phone character varying(25) NOT NULL,
  email character varying(254),
  skills text,
  availability_status character varying(20) DEFAULT 'AVAILABLE'::character varying NOT NULL,
  registered_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT volunteers_pkey PRIMARY KEY (volunteer_id),
  CONSTRAINT volunteers_email_key UNIQUE (email),
  CONSTRAINT volunteers_phone_key UNIQUE (phone),
  CONSTRAINT volunteers_availability_status_check CHECK (((availability_status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'ASSIGNED'::character varying, 'UNAVAILABLE'::character varying])::text[]))),
  CONSTRAINT volunteers_email_format CHECK (((email IS NULL) OR ((email)::text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))) NOT VALID,
  CONSTRAINT volunteers_phone_format CHECK (((phone)::text ~ '^\+?[0-9 -]{7,25}$'::text)) NOT VALID
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `volunteer_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `full_name` | character varying(120) |  | NOT NULL | Name. |
| `phone` | character varying(25) | UQ | NOT NULL | Unique phone (format-checked). |
| `email` | character varying(254) | UQ | nullable | Optional unique e-mail (format-checked). |
| `skills` | text |  | nullable | Free-text skills. |
| `availability_status` | character varying(20) |  | NOT NULL | AVAILABLE, ASSIGNED or UNAVAILABLE. |
| `registered_at` | timestamp with time zone |  | NOT NULL | Registration time. |

**CHECK constraints** (rules the database itself enforces):

* `volunteers_availability_status_check`: `CHECK (((availability_status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'ASSIGNED'::character varying, 'UNAVAILABLE'::character varying])::text[])))`
* `volunteers_email_format`: `CHECK (((email IS NULL) OR ((email)::text ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))) NOT VALID`
* `volunteers_phone_format`: `CHECK (((phone)::text ~ '^\+?[0-9 -]{7,25}$'::text)) NOT VALID`

**Indexes:**

* `volunteers_email_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON volunteers USING btree (email)`
* `volunteers_phone_key` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON volunteers USING btree (phone)`
* `volunteers_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON volunteers USING btree (volunteer_id)`

**Triggers on this table:**

* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT
* `rf_driver`: UPDATE only on columns (availability_status)

**DML performed on this table:**

* INSERT / UPDATE / DELETE: management screen.
* UPDATE availability: ASSIGNED when added to a delivery (only if currently AVAILABLE — a conditional UPDATE), AVAILABLE again when the delivery ends.
* Trigger row_change_log records changes.

#### deliveries

**Purpose:** Transport of one allocation (row-level security: drivers see only their own).

**Why it exists:** The transport of one allocation with a vehicle, a driver and a crew. Partial unique indexes allow only one active delivery per vehicle, per driver and per allocation. Row-level security lets a driver see only their own deliveries.

Created in `001_schema.sql`.

```sql
CREATE TABLE deliveries (
  delivery_id bigint GENERATED ALWAYS AS IDENTITY,
  allocation_id bigint NOT NULL,
  vehicle_id bigint NOT NULL,
  driver_id bigint NOT NULL,
  source_location_id bigint NOT NULL,
  destination_location_id bigint NOT NULL,
  departure_time timestamp with time zone,
  expected_arrival timestamp with time zone,
  actual_arrival timestamp with time zone,
  status character varying(20) DEFAULT 'PLANNED'::character varying NOT NULL,
  CONSTRAINT deliveries_pkey PRIMARY KEY (delivery_id),
  CONSTRAINT deliveries_allocation_id_fkey FOREIGN KEY (allocation_id) REFERENCES allocations(allocation_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES locations(location_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(location_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
  CONSTRAINT deliveries_check CHECK (((expected_arrival IS NULL) OR (departure_time IS NULL) OR (expected_arrival >= departure_time))),
  CONSTRAINT deliveries_check1 CHECK (((actual_arrival IS NULL) OR (departure_time IS NULL) OR (actual_arrival >= departure_time))),
  CONSTRAINT deliveries_status_check CHECK (((status)::text = ANY ((ARRAY['PLANNED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'DELAYED'::character varying, 'CANCELLED'::character varying])::text[])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `delivery_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `allocation_id` | bigint | FK | NOT NULL | FK to the allocation transported (one active delivery each). |
| `vehicle_id` | bigint | FK | NOT NULL | FK to the vehicle (one active delivery each). |
| `driver_id` | bigint | FK | NOT NULL | FK to the driver (one active delivery each). |
| `source_location_id` | bigint | FK | NOT NULL | FK: pickup location (warehouse). |
| `destination_location_id` | bigint | FK | NOT NULL | FK: drop location (camp). |
| `departure_time` | timestamp with time zone |  | nullable | Set when dispatched. |
| `expected_arrival` | timestamp with time zone |  | nullable | Planned arrival. |
| `actual_arrival` | timestamp with time zone |  | nullable | Set when delivered. |
| `status` | character varying(20) |  | NOT NULL | PLANNED → IN_TRANSIT ↔ DELAYED → DELIVERED, or PLANNED → CANCELLED (trigger-enforced). |

**CHECK constraints** (rules the database itself enforces):

* `deliveries_check`: `CHECK (((expected_arrival IS NULL) OR (departure_time IS NULL) OR (expected_arrival >= departure_time)))`
* `deliveries_check1`: `CHECK (((actual_arrival IS NULL) OR (departure_time IS NULL) OR (actual_arrival >= departure_time)))`
* `deliveries_status_check`: `CHECK (((status)::text = ANY ((ARRAY['PLANNED'::character varying, 'IN_TRANSIT'::character varying, 'DELIVERED'::character varying, 'DELAYED'::character varying, 'CANCELLED'::character varying])::text[])))`

**Indexes:**

* `deliveries_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON deliveries USING btree (delivery_id)`
* `idx_deliveries_allocation` (B-tree): `ON deliveries USING btree (allocation_id)`
* `idx_deliveries_driver` (B-tree): `ON deliveries USING btree (driver_id)`
* `idx_deliveries_status_eta` (B-tree): `ON deliveries USING btree (status, expected_arrival)`
* `idx_deliveries_vehicle` (B-tree): `ON deliveries USING btree (vehicle_id)`
* `uq_active_delivery_allocation` (B-tree, unique) — partial index (only rows matching the WHERE): `ON deliveries USING btree (allocation_id) WHERE ((status)::text <> 'CANCELLED'::text)`
* `uq_active_delivery_driver` (B-tree, unique) — partial index (only rows matching the WHERE): `ON deliveries USING btree (driver_id) WHERE ((status)::text = ANY ((ARRAY['PLANNED'::character varying, 'IN_TRANSIT'::character varying, 'DELAYED'::character varying])::text[]))`
* `uq_active_delivery_vehicle` (B-tree, unique) — partial index (only rows matching the WHERE): `ON deliveries USING btree (vehicle_id) WHERE ((status)::text = ANY ((ARRAY['PLANNED'::character varying, 'IN_TRANSIT'::character varying, 'DELAYED'::character varying])::text[]))`

**Triggers on this table:**

* `delivery_status_guard` → function `delivery_status_guard()`: State machine for deliveries. (`BEFORE UPDATE OF status FOR EACH ROW`)
* `delivery_vehicle_guard` → function `delivery_vehicle_guard()`: Refuses to plan a delivery with a vehicle that is under maintenance. (`BEFORE INSERT FOR EACH ROW`)
* `row_change_log` → function `log_row_change()`: Generic field-level audit trigger attached to eight tables. (`AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW`)

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT
* `rf_driver`: UPDATE only on columns (actual_arrival, departure_time, status)
* Row-level security: policies deliveries_driver_own / deliveries_driver_update_own (driver_id = current user), deliveries_officer_read, deliveries_staff_all.

**DML performed on this table:**

* INSERT: Plan delivery (with delivery_volunteers). Trigger delivery_vehicle_guard refuses a vehicle under maintenance.
* UPDATE status / departure_time / actual_arrival: dispatch, delay, deliver, cancel. Trigger delivery_status_guard allows only legal transitions.
* Trigger row_change_log records changes.

#### delivery_volunteers

**Purpose:** M:N: volunteers crewing a delivery.

**Why it exists:** Resolves the many-to-many relationship Delivery CREWED BY Volunteer, with the volunteer's role on that trip.

Created in `001_schema.sql`.

```sql
CREATE TABLE delivery_volunteers (
  delivery_id bigint NOT NULL,
  volunteer_id bigint NOT NULL,
  assigned_role character varying(60) NOT NULL,
  CONSTRAINT delivery_volunteers_pkey PRIMARY KEY (delivery_id, volunteer_id),
  CONSTRAINT delivery_volunteers_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES deliveries(delivery_id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_volunteer_volunteer FOREIGN KEY (volunteer_id) REFERENCES volunteers(volunteer_id) ON DELETE CASCADE
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `delivery_id` | bigint | PK, FK | NOT NULL | PK part / FK to deliveries (cascade). |
| `volunteer_id` | bigint | PK, FK | NOT NULL | PK part / FK to volunteers (cascade). |
| `assigned_role` | character varying(60) |  | NOT NULL | Role on the delivery, e.g. LOADING_SUPPORT. |

**Indexes:**

* `delivery_volunteers_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON delivery_volunteers USING btree (delivery_id, volunteer_id)`
* `idx_delivery_volunteers_volunteer` (B-tree): `ON delivery_volunteers USING btree (volunteer_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: DELETE, INSERT, SELECT, UPDATE
* `rf_driver`: SELECT
* `rf_field_officer`: SELECT

**DML performed on this table:**

* INSERT: when a delivery is planned.
* Deleted with the delivery or the volunteer (ON DELETE CASCADE).

### History and system

Audit trails and bookkeeping tables.

#### audit_logs

**Purpose:** Application audit trail, written in the same transaction as each change.

**Why it exists:** Business-level audit trail: who performed which action (approve, allocate, reset password…) with details as JSON, written in the same transaction as the change itself.

Created in `005_integrity_security.sql`.

```sql
CREATE TABLE audit_logs (
  audit_id bigint GENERATED ALWAYS AS IDENTITY,
  user_id bigint,
  action text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (audit_id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `audit_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `user_id` | bigint | FK | nullable | FK to the acting user. |
| `action` | text |  | NOT NULL | Operation code, e.g. ALLOCATIONS, DELIVERY_STATUS. |
| `details` | jsonb |  | NOT NULL | JSON input and result of the operation (passwords removed). |
| `created_at` | timestamp with time zone |  | NOT NULL | When the action happened. |

**Indexes:**

* `audit_logs_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON audit_logs USING btree (audit_id)`
* `idx_audit_logs_created` (B-tree): `ON audit_logs USING btree (created_at DESC)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: INSERT, SELECT
* `rf_driver`: INSERT
* `rf_field_officer`: INSERT

**DML performed on this table:**

* INSERT: by the API in the same transaction as each change. Never updated or deleted.

#### data_change_log

**Purpose:** Row-level change history written by the log_row_change() trigger.

**Why it exists:** Field-level change history (old → new value of every changed column), written automatically by the trigger log_row_change on eight operational tables.

Created in `007_dbms_engineering.sql`.

```sql
CREATE TABLE data_change_log (
  change_id bigint GENERATED ALWAYS AS IDENTITY,
  table_name text NOT NULL,
  operation text NOT NULL,
  row_data jsonb,
  changed_fields jsonb,
  changed_by bigint,
  txid bigint DEFAULT txid_current() NOT NULL,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT data_change_log_pkey PRIMARY KEY (change_id),
  CONSTRAINT data_change_log_operation_check CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `change_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `table_name` | text |  | NOT NULL | Table that changed. |
| `operation` | text |  | NOT NULL | INSERT, UPDATE or DELETE. |
| `row_data` | jsonb |  | nullable | Row after (or before, for DELETE) the change, without secrets. |
| `changed_fields` | jsonb |  | nullable | JSON diff {field: {from, to}} for UPDATEs. |
| `changed_by` | bigint |  | nullable | Acting user id taken from the reliefflow.user_id session setting. |
| `txid` | bigint |  | NOT NULL | Transaction id, groups changes made together. |
| `changed_at` | timestamp with time zone |  | NOT NULL | When the change happened. |

**CHECK constraints** (rules the database itself enforces):

* `data_change_log_operation_check`: `CHECK ((operation = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))`

**Indexes:**

* `data_change_log_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON data_change_log USING btree (change_id)`
* `idx_data_change_log_table` (B-tree): `ON data_change_log USING btree (table_name, changed_at DESC)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: SELECT

**DML performed on this table:**

* INSERT: only by the SECURITY DEFINER trigger log_row_change. No role may insert directly, so history cannot be forged.
* SELECT: Change history screen.

#### integration_sync_runs

**Purpose:** One row per Neo4j / vector synchronisation run.

**Why it exists:** One row per synchronisation run to Neo4j or the vector database: status, attempts, records synced, error detail.

Created in `007_dbms_engineering.sql`.

```sql
CREATE TABLE integration_sync_runs (
  run_id bigint GENERATED ALWAYS AS IDENTITY,
  target text NOT NULL,
  status text NOT NULL,
  attempts integer DEFAULT 1 NOT NULL,
  records_synced integer DEFAULT 0 NOT NULL,
  detail text,
  triggered_by bigint,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  CONSTRAINT integration_sync_runs_pkey PRIMARY KEY (run_id),
  CONSTRAINT integration_sync_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES app_users(user_id) ON DELETE SET NULL,
  CONSTRAINT integration_sync_runs_attempts_check CHECK ((attempts >= 1)),
  CONSTRAINT integration_sync_runs_check CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
  CONSTRAINT integration_sync_runs_records_synced_check CHECK ((records_synced >= 0)),
  CONSTRAINT integration_sync_runs_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text]))),
  CONSTRAINT integration_sync_runs_target_check CHECK ((target = ANY (ARRAY['neo4j'::text, 'vector'::text])))
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `run_id` | bigint (identity) | PK | NOT NULL | Surrogate primary key. |
| `target` | text |  | NOT NULL | neo4j or vector. |
| `status` | text |  | NOT NULL | RUNNING, SUCCEEDED or FAILED. |
| `attempts` | integer |  | NOT NULL | Attempts used (max 3). |
| `records_synced` | integer |  | NOT NULL | Records written to the target. |
| `detail` | text |  | nullable | Summary or failure reason. |
| `triggered_by` | bigint | FK | nullable | FK to the user who started the sync. |
| `started_at` | timestamp with time zone |  | NOT NULL | Start time. |
| `finished_at` | timestamp with time zone |  | nullable | End time (NULL while running). |

**CHECK constraints** (rules the database itself enforces):

* `integration_sync_runs_attempts_check`: `CHECK ((attempts >= 1))`
* `integration_sync_runs_check`: `CHECK (((finished_at IS NULL) OR (finished_at >= started_at)))`
* `integration_sync_runs_records_synced_check`: `CHECK ((records_synced >= 0))`
* `integration_sync_runs_status_check`: `CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text])))`
* `integration_sync_runs_target_check`: `CHECK ((target = ANY (ARRAY['neo4j'::text, 'vector'::text])))`

**Indexes:**

* `idx_sync_runs_target` (B-tree): `ON integration_sync_runs USING btree (target, started_at DESC)`
* `integration_sync_runs_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON integration_sync_runs USING btree (run_id)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
* `rf_coordinator`: SELECT

**DML performed on this table:**

* INSERT when a run starts; UPDATE when it succeeds or fails (with retry count).

#### schema_migrations

**Purpose:** Applied migration files (each runs once).

**Why it exists:** Which migration files have been applied, so each runs exactly once and existing data is never re-processed.

Created in `007_dbms_engineering.sql`.

```sql
CREATE TABLE schema_migrations (
  filename text NOT NULL,
  applied_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename)
);
```

| Column | Type | Key | Null | Meaning |
|---|---|---|---|---|
| `filename` | text | PK | NOT NULL | Migration file name (primary key). |
| `applied_at` | timestamp with time zone |  | NOT NULL | When it was applied. |

**Indexes:**

* `schema_migrations_pkey` (B-tree, unique) — created automatically by a PRIMARY KEY / UNIQUE constraint: `ON schema_migrations USING btree (filename)`

**Database access (GRANTs):**

* `rf_admin`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

**DML performed on this table:**

* INSERT: by scripts/migrate.ts after a file has run successfully.

---

## 5. Views, functions, procedure, indexes and security

### 5.1 Views

A view is a stored SELECT with a name. It stores no data; every time it is queried, PostgreSQL runs the query on the current rows. Views hide join complexity and give the application a stable interface.

#### v_disaster_response_summary

One row per disaster with correlated subqueries: affected locations and population, total and open requests, units allocated.

```sql
CREATE VIEW v_disaster_response_summary AS
 SELECT disaster_id,
    disaster_name,
    disaster_type,
    severity,
    status,
    started_at,
    ( SELECT count(*) AS count
           FROM disaster_locations dl
          WHERE (dl.disaster_id = d.disaster_id)) AS affected_locations,
    ( SELECT COALESCE(sum(dl.affected_population), (0)::bigint) AS "coalesce"
           FROM disaster_locations dl
          WHERE (dl.disaster_id = d.disaster_id)) AS affected_population,
    ( SELECT count(*) AS count
           FROM resource_requests rr
          WHERE (rr.disaster_id = d.disaster_id)) AS total_requests,
    ( SELECT count(*) AS count
           FROM resource_requests rr
          WHERE ((rr.disaster_id = d.disaster_id) AND ((rr.status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'PARTIALLY_FULFILLED'::character varying])::text[])))) AS open_requests,
    ( SELECT COALESCE(sum(ai.quantity_allocated), (0)::numeric) AS "coalesce"
           FROM ((allocation_items ai
             JOIN allocations a USING (allocation_id))
             JOIN resource_requests rr ON ((rr.request_id = a.request_id)))
          WHERE ((rr.disaster_id = d.disaster_id) AND ((a.status)::text <> 'CANCELLED'::text))) AS units_allocated
   FROM disasters d;
```

#### v_low_stock

Stock lines at or below their minimum threshold, with warehouse and resource names. Drives low-stock alerts.

```sql
CREATE VIEW v_low_stock AS
 SELECT w.warehouse_id,
    w.warehouse_name,
    r.resource_id,
    r.resource_name,
    i.quantity_available,
    i.minimum_threshold,
    r.unit
   FROM ((inventory i
     JOIN warehouses w ON ((w.warehouse_id = i.warehouse_id)))
     JOIN resources r ON ((r.resource_id = i.resource_id)))
  WHERE (i.quantity_available <= i.minimum_threshold);
```

#### v_request_fulfillment

For every request line: requested, allocated (ignoring cancelled allocations) and remaining quantity. The basis of fulfilment progress and of the procedure refresh_request_status.

```sql
CREATE VIEW v_request_fulfillment AS
 SELECT ri.request_id,
    ri.resource_id,
    r.resource_name,
    ri.quantity_requested,
    COALESCE(sum(
        CASE
            WHEN ((a.status)::text <> 'CANCELLED'::text) THEN ai.quantity_allocated
            ELSE (0)::numeric
        END), (0)::numeric) AS quantity_allocated,
    GREATEST((ri.quantity_requested - COALESCE(sum(
        CASE
            WHEN ((a.status)::text <> 'CANCELLED'::text) THEN ai.quantity_allocated
            ELSE (0)::numeric
        END), (0)::numeric)), (0)::numeric) AS quantity_remaining
   FROM (((request_items ri
     JOIN resources r ON ((r.resource_id = ri.resource_id)))
     LEFT JOIN allocation_items ai ON (((ai.request_id = ri.request_id) AND (ai.resource_id = ri.resource_id))))
     LEFT JOIN allocations a ON ((a.allocation_id = ai.allocation_id)))
  GROUP BY ri.request_id, ri.resource_id, r.resource_name, ri.quantity_requested;
```

#### v_resource_demand

Outstanding demand vs available stock per resource, using two CTEs (demand, supply). net_position < 0 means a shortage.

```sql
CREATE VIEW v_resource_demand AS
 WITH demand AS (
         SELECT f.resource_id,
            sum(f.quantity_remaining) AS outstanding
           FROM (v_request_fulfillment f
             JOIN resource_requests rr ON ((rr.request_id = f.request_id)))
          WHERE ((rr.status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'PARTIALLY_FULFILLED'::character varying])::text[]))
          GROUP BY f.resource_id
        ), supply AS (
         SELECT i.resource_id,
            sum(i.quantity_available) AS available
           FROM (inventory i
             JOIN warehouses w USING (warehouse_id))
          WHERE ((w.status)::text = 'ACTIVE'::text)
          GROUP BY i.resource_id
        )
 SELECT r.resource_id,
    r.resource_name,
    r.unit,
    c.category_name,
    COALESCE(d.outstanding, (0)::numeric) AS outstanding_demand,
    COALESCE(s.available, (0)::numeric) AS available_stock,
    (COALESCE(s.available, (0)::numeric) - COALESCE(d.outstanding, (0)::numeric)) AS net_position
   FROM (((resources r
     JOIN resource_categories c USING (category_id))
     LEFT JOIN demand d USING (resource_id))
     LEFT JOIN supply s USING (resource_id));
```

#### v_warehouse_inventory_summary

One row per warehouse: number of stock lines, units available, low-stock lines and last stock change (LEFT JOIN so empty warehouses appear too).

```sql
CREATE VIEW v_warehouse_inventory_summary AS
 SELECT w.warehouse_id,
    w.warehouse_name,
    w.status,
    l.location_name,
    count(i.resource_id) AS resource_lines,
    COALESCE(sum(i.quantity_available), (0)::numeric) AS units_available,
    count(*) FILTER (WHERE (i.quantity_available <= i.minimum_threshold)) AS low_stock_lines,
    max(i.last_updated) AS last_stock_change
   FROM ((warehouses w
     JOIN locations l ON ((l.location_id = w.location_id)))
     LEFT JOIN inventory i ON ((i.warehouse_id = w.warehouse_id)))
  GROUP BY w.warehouse_id, w.warehouse_name, w.status, l.location_name;
```

### 5.2 Functions and the stored procedure

* A **function** returns a value and is used inside SQL (`SELECT resource_availability(5)`).
* A **procedure** is executed with `CALL` and performs an action (`CALL refresh_request_status(12)`).
* `STABLE` means the function does not modify data and returns the same result within one statement, so the planner can optimise calls.
* `SECURITY DEFINER` means the function runs with the rights of its owner rather than the caller — used where a restricted role must perform one specific, controlled action.

#### refresh_request_status (procedure)

PROCEDURE (called with CALL). The single source of truth for a request's status: recomputes APPROVED / PARTIALLY_FULFILLED / ALLOCATED / IN_TRANSIT / DELIVERED from its allocations and v_request_fulfillment, and updates the row only if the status changed. Called by the API after every allocation, cancellation and delivery update.

```sql
CREATE OR REPLACE PROCEDURE public.refresh_request_status(IN p_request_id bigint)
 LANGUAGE plpgsql
AS $procedure$
DECLARE cur TEXT; nxt TEXT;
BEGIN
  SELECT status INTO cur FROM resource_requests WHERE request_id = p_request_id FOR UPDATE;
  IF cur IS NULL OR cur IN ('PENDING','REJECTED','CANCELLED') THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM allocations WHERE request_id = p_request_id AND status <> 'CANCELLED') THEN
    nxt := 'APPROVED';
  ELSIF EXISTS (SELECT 1 FROM v_request_fulfillment WHERE request_id = p_request_id AND quantity_remaining > 0) THEN
    nxt := 'PARTIALLY_FULFILLED';
  ELSIF NOT EXISTS (SELECT 1 FROM allocations WHERE request_id = p_request_id AND status NOT IN ('DELIVERED','CANCELLED')) THEN
    nxt := 'DELIVERED';
  ELSIF EXISTS (SELECT 1 FROM allocations WHERE request_id = p_request_id AND status = 'IN_TRANSIT') THEN
    nxt := 'IN_TRANSIT';
  ELSE
    nxt := 'ALLOCATED';
  END IF;
  IF nxt IS DISTINCT FROM cur THEN
    UPDATE resource_requests SET status = nxt WHERE request_id = p_request_id;
  END IF;
END $procedure$
```

#### resource_availability

Total stock of one resource across ACTIVE warehouses.

```sql
CREATE OR REPLACE FUNCTION public.resource_availability(p_resource_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(SUM(i.quantity_available), 0)
  FROM inventory i JOIN warehouses w USING (warehouse_id)
  WHERE i.resource_id = p_resource_id AND w.status = 'ACTIVE';
$function$
```

#### remaining_request_quantity

Outstanding quantity of one resource on one request (requested − allocated, never below 0).

```sql
CREATE OR REPLACE FUNCTION public.remaining_request_quantity(p_request_id bigint, p_resource_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT GREATEST(ri.quantity_requested - COALESCE(SUM(CASE WHEN a.status <> 'CANCELLED' THEN ai.quantity_allocated ELSE 0 END),0),0)
  FROM request_items ri
  LEFT JOIN allocation_items ai ON ai.request_id = ri.request_id AND ai.resource_id = ri.resource_id
  LEFT JOIN allocations a ON a.allocation_id = ai.allocation_id
  WHERE ri.request_id = p_request_id AND ri.resource_id = p_resource_id
  GROUP BY ri.quantity_requested;
$function$
```

#### request_fulfillment_pct

Percentage of a request's total quantity that has been allocated.

```sql
CREATE OR REPLACE FUNCTION public.request_fulfillment_pct(p_request_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE WHEN SUM(quantity_requested) = 0 THEN 0
              ELSE ROUND(100 * SUM(quantity_allocated) / SUM(quantity_requested), 1) END
  FROM v_request_fulfillment WHERE request_id = p_request_id;
$function$
```

#### operational_summary

Set-returning function: the dashboard KPIs (active disasters, affected population, open camps, open requests, low-stock lines, active deliveries) in one call.

```sql
CREATE OR REPLACE FUNCTION public.operational_summary()
 RETURNS TABLE(metric text, value numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 'active_disasters', COUNT(*)::NUMERIC FROM disasters WHERE status = 'ACTIVE'
  UNION ALL SELECT 'affected_population', COALESCE(SUM(dl.affected_population),0)
            FROM disaster_locations dl JOIN disasters d USING (disaster_id) WHERE d.status <> 'CLOSED'
  UNION ALL SELECT 'open_camps', COUNT(*) FROM relief_camps WHERE status <> 'CLOSED'
  UNION ALL SELECT 'open_requests', COUNT(*) FROM resource_requests WHERE status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')
  UNION ALL SELECT 'low_stock_lines', COUNT(*) FROM v_low_stock
  UNION ALL SELECT 'active_deliveries', COUNT(*) FROM deliveries WHERE status IN ('PLANNED','IN_TRANSIT','DELAYED');
$function$
```

#### lock_request_parents

SECURITY DEFINER. Locks the camp and disaster rows with FOR SHARE while a request is created and returns their status, so a camp cannot be closed (or a disaster closed) halfway through creating a request — even though a field officer has no UPDATE right on those tables.

```sql
CREATE OR REPLACE FUNCTION public.lock_request_parents(p_camp bigint, p_disaster bigint)
 RETURNS TABLE(camp_status text, disaster_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT (SELECT c.status::TEXT FROM relief_camps c WHERE c.camp_id = p_camp FOR SHARE),
         (SELECT d.status::TEXT FROM disasters d WHERE d.disaster_id = p_disaster FOR SHARE);
END $function$
```

### 5.3 Indexes

There are 65 indexes (34 created automatically by PRIMARY KEY / UNIQUE constraints). Each table's indexes are listed in Section 4.

| Kind | Count | Used for |
|---|---|---|
| B-tree | 62 | equality and range search, ORDER BY, joins on foreign keys |
| GIN | 3 | full-text search on tsvector columns, fuzzy name search (pg_trgm) |
| Partial (WHERE …) | 3 | e.g. only *active* deliveries must be unique per vehicle / driver / allocation — finished deliveries are ignored |

Why every foreign key has an index: joins use it, and when a parent row is deleted PostgreSQL must find child rows — without an index that is a full scan of the child table.

### 5.4 Constraint summary

| Constraint | Count | Example |
|---|---|---|
| PRIMARY KEY | 25 | `PRIMARY KEY (warehouse_id, resource_id)` on inventory |
| FOREIGN KEY | 34 | `FOREIGN KEY (request_id, resource_id) REFERENCES request_items` |
| UNIQUE | 9 | `UNIQUE (email)` on app_users |
| CHECK | 42 | `CHECK (quantity_available >= 0)` on inventory |
| NOT NULL | 123 columns | every mandatory attribute |

### 5.5 Database roles, GRANTs and row-level security

Authorisation is enforced by PostgreSQL itself, not only by the application:

1. The application authenticates the user and knows their role.
2. Every API transaction starts with `SET LOCAL ROLE rf_<role>` and `set_config('reliefflow.user_id', <id>, true)`.
3. From then on PostgreSQL checks every statement against that role's GRANTs and the row-level-security policies.

| Database role | Application role | In short |
|---|---|---|
| `rf_admin` | ADMIN | everything, including password hashes and user management |
| `rf_coordinator` | RELIEF_COORDINATOR | read and change all operational data; read history |
| `rf_field_officer` | FIELD_OFFICER | read operations, raise requests, update camp occupancy only |
| `rf_driver` | DRIVER | read operations; progress only their own deliveries |

Row-level security policies (a policy is a WHERE condition PostgreSQL adds to every query on the table for the given roles):

| Table | Policy | Command | Roles | Condition |
|---|---|---|---|---|
| deliveries | `deliveries_driver_own` | SELECT | rf_driver | `(driver_id = (NULLIF(current_setting('reliefflow.user_id'::text, true), ''::text))::bigint)` |
| deliveries | `deliveries_driver_update_own` | UPDATE | rf_driver | `(driver_id = (NULLIF(current_setting('reliefflow.user_id'::text, true), ''::text))::bigint)` |
| deliveries | `deliveries_officer_read` | SELECT | rf_field_officer | `true` |
| deliveries | `deliveries_staff_all` | ALL | rf_admin, rf_coordinator | `true` |

Effect: the same `SELECT * FROM deliveries` returns all rows for a coordinator but only the driver's own rows for a driver, and an `UPDATE` of another driver's delivery affects 0 rows.

```sql
BEGIN;
SELECT set_config('reliefflow.user_id', '11', true);
SET LOCAL ROLE rf_driver;
SELECT count(*) FROM deliveries;              -- only driver 11's deliveries
SELECT password_hash FROM app_users;          -- ERROR: permission denied for table app_users
UPDATE inventory SET quantity_available = 0;  -- ERROR: permission denied for table inventory
ROLLBACK;
```

---

## 6. Triggers — every one explained

A trigger makes PostgreSQL run a function automatically when rows are inserted, updated or deleted. ReliefFlow uses triggers for rules that must hold **no matter which program changes the data**.

* **BEFORE** triggers run before the row is written and can reject it (`RAISE EXCEPTION` → the whole transaction rolls back).
* **AFTER** triggers run once the row is written and are used for side effects (deduct stock, write history).
* **FOR EACH ROW** means the function runs once per affected row, with `OLD` (row before) and `NEW` (row after) available. `TG_OP` tells it whether this is INSERT, UPDATE or DELETE.
* A trigger runs **inside the same transaction** as the statement that fired it: if anything fails, the change and all its side effects are undone together.

| Trigger | Table | Timing | Events | Function |
|---|---|---|---|---|
| `trg_adjust_inventory` | allocation_items | AFTER | INSERT OR DELETE OR UPDATE | `adjust_inventory_for_allocation()` |
| `trg_validate_allocation_item` | allocation_items | BEFORE | INSERT OR DELETE OR UPDATE | `validate_allocation_item()` |
| `allocation_status_guard` | allocations | BEFORE | UPDATE | `allocation_status_guard()` |
| `row_change_log` | app_users | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `delivery_status_guard` | deliveries | BEFORE | UPDATE OF status | `delivery_status_guard()` |
| `delivery_vehicle_guard` | deliveries | BEFORE | INSERT | `delivery_vehicle_guard()` |
| `row_change_log` | deliveries | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `operational_duplicate` | disasters | BEFORE | INSERT OR UPDATE OF disaster_name, disaster_type, started_at, event_location_id | `prevent_operational_duplicate()` |
| `row_change_log` | disasters | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `inventory_history` | inventory | AFTER | INSERT OR UPDATE OF quantity_available | `record_inventory_movement()` |
| `row_change_log` | relief_camps | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `row_change_log` | resource_requests | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `row_change_log` | vehicles | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `row_change_log` | volunteers | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |
| `operational_duplicate` | warehouses | BEFORE | INSERT OR UPDATE OF warehouse_name, location_id | `prevent_operational_duplicate()` |
| `row_change_log` | warehouses | AFTER | INSERT OR DELETE OR UPDATE | `log_row_change()` |

### validate_allocation_item()

**Purpose:** Guards every allocation line before it is written: the request must be approved, the allocation active, the warehouse active, and the quantity must not exceed the stock or the outstanding demand.

**Attached to:** `allocation_items`

**What it does, step by step:**

1. If the operation is UPDATE or DELETE → error 'Allocation lines are immutable' (history cannot be rewritten).
2. Locks the request row (FOR UPDATE) and checks status is APPROVED or PARTIALLY_FULFILLED.
3. Checks the parent allocation is still ALLOCATED.
4. Locks the request line and the stock line (FOR UPDATE) — so two coordinators cannot both take the last units.
5. Checks the warehouse is ACTIVE.
6. Adds up what is already allocated for this request line (ignoring cancelled allocations).
7. If quantity > stock, or already allocated + quantity > requested → error 'Insufficient stock or allocation exceeds outstanding quantity'. The whole transaction rolls back.

**Example:** Allocating 500 litres when only 350 are outstanding → 409 Conflict, nothing is written.

```sql
CREATE OR REPLACE FUNCTION public.validate_allocation_item()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE stock NUMERIC; requested NUMERIC; used NUMERIC; state TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Allocation lines are immutable'; END IF;
 SELECT status INTO state FROM resource_requests WHERE request_id=NEW.request_id FOR UPDATE;
 IF state NOT IN ('APPROVED','PARTIALLY_FULFILLED') THEN RAISE EXCEPTION 'Request must be approved with outstanding demand'; END IF;
 IF NOT EXISTS(SELECT 1 FROM allocations WHERE allocation_id=NEW.allocation_id AND status='ALLOCATED') THEN RAISE EXCEPTION 'Allocation is not active'; END IF;
 SELECT quantity_requested INTO requested FROM request_items WHERE request_id=NEW.request_id AND resource_id=NEW.resource_id FOR UPDATE;
 SELECT quantity_available INTO stock FROM inventory WHERE warehouse_id=NEW.warehouse_id AND resource_id=NEW.resource_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM warehouses WHERE warehouse_id=NEW.warehouse_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Warehouse is not active'; END IF;
 SELECT COALESCE(sum(ai.quantity_allocated),0) INTO used FROM allocation_items ai JOIN allocations a USING(allocation_id) WHERE ai.request_id=NEW.request_id AND ai.resource_id=NEW.resource_id AND a.status<>'CANCELLED';
 IF stock IS NULL OR requested IS NULL OR NEW.quantity_allocated>stock OR used+NEW.quantity_allocated>requested THEN RAISE EXCEPTION 'Insufficient stock or allocation exceeds outstanding quantity'; END IF;
 RETURN NEW;
END $function$
```

### adjust_inventory_for_allocation()

**Purpose:** Keeps stock in step with allocation lines automatically, in the same transaction.

**Attached to:** `allocation_items`

**What it does, step by step:**

1. INSERT of a line → inventory.quantity_available − quantity_allocated.
2. DELETE → adds the quantity back. UPDATE → adds back the old and deducts the new (in practice lines are immutable).
3. Because the stock CHECK (quantity_available >= 0) is evaluated on this UPDATE, stock can never go negative even under concurrency.

```sql
CREATE OR REPLACE FUNCTION public.adjust_inventory_for_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE inventory SET quantity_available = quantity_available - NEW.quantity_allocated, last_updated = NOW()
    WHERE warehouse_id = NEW.warehouse_id AND resource_id = NEW.resource_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE inventory SET quantity_available = quantity_available + OLD.quantity_allocated, last_updated = NOW()
    WHERE warehouse_id = OLD.warehouse_id AND resource_id = OLD.resource_id;
    RETURN OLD;
  ELSE
    UPDATE inventory SET quantity_available = quantity_available + OLD.quantity_allocated, last_updated = NOW()
    WHERE warehouse_id = OLD.warehouse_id AND resource_id = OLD.resource_id;
    UPDATE inventory SET quantity_available = quantity_available - NEW.quantity_allocated, last_updated = NOW()
    WHERE warehouse_id = NEW.warehouse_id AND resource_id = NEW.resource_id;
    RETURN NEW;
  END IF;
END;
$function$
```

### allocation_status_guard()

**Purpose:** State machine for allocations, and exact-once stock restoration on cancellation.

**Attached to:** `allocations`

**What it does, step by step:**

1. request_id, allocated_by and allocated_at can never change ('Allocation identity is immutable').
2. Only ALLOCATED → IN_TRANSIT / CANCELLED and IN_TRANSIT → DELIVERED are allowed.
3. On CANCELLED: refuses if a non-cancelled delivery still exists; locks the affected stock lines in a fixed order; adds the allocated quantities back to inventory with the reason 'Allocation cancellation #id'.
4. Because the status can change to CANCELLED only once, stock is restored exactly once.

```sql
CREATE OR REPLACE FUNCTION public.allocation_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF NEW.request_id<>OLD.request_id OR NEW.allocated_by<>OLD.allocated_by OR NEW.allocated_at<>OLD.allocated_at THEN RAISE EXCEPTION 'Allocation identity is immutable'; END IF;
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 PERFORM 1 FROM resource_requests WHERE request_id=NEW.request_id FOR UPDATE;
 IF NOT ((OLD.status='ALLOCATED' AND NEW.status IN ('IN_TRANSIT','CANCELLED')) OR (OLD.status='IN_TRANSIT' AND NEW.status='DELIVERED')) THEN RAISE EXCEPTION 'Invalid allocation transition'; END IF;
 IF NEW.status='CANCELLED' THEN
  IF EXISTS(SELECT 1 FROM deliveries WHERE allocation_id=NEW.allocation_id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Cancel planned deliveries before cancelling allocation'; END IF;
  PERFORM set_config('reliefflow.reason','Allocation cancellation #'||NEW.allocation_id,true);
  PERFORM 1 FROM inventory i JOIN allocation_items ai USING(warehouse_id,resource_id) WHERE ai.allocation_id=NEW.allocation_id ORDER BY i.warehouse_id,i.resource_id FOR UPDATE OF i;
  UPDATE inventory i SET quantity_available=i.quantity_available+x.quantity,last_updated=now() FROM (SELECT warehouse_id,resource_id,sum(quantity_allocated) quantity FROM allocation_items WHERE allocation_id=NEW.allocation_id GROUP BY warehouse_id,resource_id) x WHERE i.warehouse_id=x.warehouse_id AND i.resource_id=x.resource_id;
 END IF;
 RETURN NEW;
END $function$
```

### delivery_status_guard()

**Purpose:** State machine for deliveries.

**Attached to:** `deliveries`

**What it does, step by step:**

1. Allowed: PLANNED → IN_TRANSIT / CANCELLED; IN_TRANSIT → DELAYED / DELIVERED; DELAYED → IN_TRANSIT / DELIVERED.
2. Anything else (e.g. DELIVERED → PLANNED) → error 'Invalid delivery transition X -> Y'.

```sql
CREATE OR REPLACE FUNCTION public.delivery_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
       (OLD.status = 'PLANNED'    AND NEW.status IN ('IN_TRANSIT','CANCELLED'))
    OR (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('DELAYED','DELIVERED'))
    OR (OLD.status = 'DELAYED'    AND NEW.status IN ('IN_TRANSIT','DELIVERED'))
  ) THEN
    RAISE EXCEPTION 'Invalid delivery transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $function$
```

### delivery_vehicle_guard()

**Purpose:** Refuses to plan a delivery with a vehicle that is under maintenance.

**Attached to:** `deliveries`

**What it does, step by step:**

1. Locks the vehicle row (FOR UPDATE) and reads its status.
2. If MAINTENANCE → error 'Vehicle is under maintenance'.

```sql
CREATE OR REPLACE FUNCTION public.delivery_vehicle_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM vehicles WHERE vehicle_id = NEW.vehicle_id FOR UPDATE;
  IF v_status = 'MAINTENANCE' THEN RAISE EXCEPTION 'Vehicle is under maintenance'; END IF;
  RETURN NEW;
END $function$
```

### prevent_operational_duplicate()

**Purpose:** Stops the same disaster or warehouse being entered twice with slightly different spelling.

**Attached to:** `disasters`, `warehouses`

**What it does, step by step:**

1. Compares names case-insensitively and ignoring surrounding spaces (lower(btrim(...))).
2. Disasters: same name + type + start date + location = duplicate. Warehouses: same name at the same location = duplicate.
3. Takes a transaction-level advisory lock first, so two simultaneous inserts of the same event cannot both pass the check.

```sql
CREATE OR REPLACE FUNCTION public.prevent_operational_duplicate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
 IF TG_TABLE_NAME='warehouses' THEN
  IF TG_OP='UPDATE' AND lower(btrim(OLD.warehouse_name))=lower(btrim(NEW.warehouse_name)) AND OLD.location_id=NEW.location_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(71001);
  IF EXISTS(SELECT 1 FROM warehouses WHERE lower(btrim(warehouse_name))=lower(btrim(NEW.warehouse_name)) AND location_id=NEW.location_id AND warehouse_id<>NEW.warehouse_id) THEN RAISE EXCEPTION 'Warehouse already exists at this location'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND lower(btrim(OLD.disaster_name))=lower(btrim(NEW.disaster_name)) AND lower(btrim(OLD.disaster_type))=lower(btrim(NEW.disaster_type)) AND (OLD.started_at AT TIME ZONE 'UTC')::date=(NEW.started_at AT TIME ZONE 'UTC')::date AND OLD.event_location_id IS NOT DISTINCT FROM NEW.event_location_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(71002);
  IF EXISTS(SELECT 1 FROM disasters WHERE lower(btrim(disaster_name))=lower(btrim(NEW.disaster_name)) AND lower(btrim(disaster_type))=lower(btrim(NEW.disaster_type)) AND (started_at AT TIME ZONE 'UTC')::date=(NEW.started_at AT TIME ZONE 'UTC')::date AND event_location_id IS NOT DISTINCT FROM NEW.event_location_id AND disaster_id<>NEW.disaster_id) THEN RAISE EXCEPTION 'Matching disaster event already exists'; END IF;
 END IF;
 RETURN NEW;
END $function$
```

### record_inventory_movement()

**Purpose:** Writes the stock ledger: every change of inventory.quantity_available becomes a row in inventory_movements.

**Attached to:** `inventory` · runs as SECURITY DEFINER

**What it does, step by step:**

1. delta = new quantity − old quantity (or the full quantity for a new line).
2. reason comes from the transaction setting reliefflow.reason (set by the API or by a cancellation), default 'Stock adjustment'.
3. SECURITY DEFINER: runs with the owner's rights, because no application role may write the ledger directly.

```sql
CREATE OR REPLACE FUNCTION public.record_inventory_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 INSERT INTO inventory_movements(warehouse_id,resource_id,delta,reason) VALUES(NEW.warehouse_id,NEW.resource_id,NEW.quantity_available-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantity_available END,COALESCE(NULLIF(current_setting('reliefflow.reason',true),''),'Stock adjustment'));
 RETURN NEW;
END $function$
```

### log_row_change()

**Purpose:** Generic field-level audit trigger attached to eight tables.

**Attached to:** `app_users`, `deliveries`, `disasters`, `relief_camps`, `resource_requests`, `vehicles`, `volunteers`, `warehouses` · runs as SECURITY DEFINER

**What it does, step by step:**

1. Converts the OLD and NEW rows to JSONB (dropping password_hash and search_vector).
2. For UPDATE, builds { column: { from, to } } for changed columns only; an UPDATE that changed nothing is not logged.
3. Inserts table name, operation, row data, changed fields and the acting user (from reliefflow.user_id, set by the API in each transaction).
4. SECURITY DEFINER, so history is written even though no role can write data_change_log directly.

```sql
CREATE OR REPLACE FUNCTION public.log_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_j JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' - 'search_vector' END;
  new_j JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' - 'search_vector' END;
  diff JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, jsonb_build_object('from', old_j -> n.key, 'to', n.value))
      INTO diff
      FROM jsonb_each(new_j) n
     WHERE old_j -> n.key IS DISTINCT FROM n.value;
    IF diff IS NULL THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO data_change_log(table_name, operation, row_data, changed_fields, changed_by)
  VALUES (TG_TABLE_NAME, TG_OP, COALESCE(new_j, old_j), diff,
          NULLIF(current_setting('reliefflow.user_id', true), '')::BIGINT);
  RETURN COALESCE(NEW, OLD);
END $function$
```

---

## 7. DML — how the data is changed and read

DML (Data Manipulation Language) is the part of SQL that works with the rows: `INSERT`, `UPDATE`, `DELETE` and `SELECT`. In ReliefFlow every DML statement:

* is **parameterised** (`$1, $2, …`) — user input is sent separately from the SQL text, so SQL injection is impossible;
* runs inside a **transaction** (`BEGIN … COMMIT`, or `ROLLBACK` on any error) as the user's **database role**;
* is checked by the database's constraints and triggers, in addition to the API's own validation.

### 7.1 DML statement types used

| Statement | How ReliefFlow uses it | Example |
|---|---|---|
| `INSERT … VALUES … RETURNING` | create a row and get its generated id back in one round trip | `INSERT INTO resource_requests(…) VALUES ($1, …) RETURNING request_id` |
| `INSERT … SELECT FROM unnest(…)` | insert many request lines in one statement | `INSERT INTO request_items(request_id, resource_id, quantity_requested) SELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) x(r, q)` |
| `INSERT … ON CONFLICT DO NOTHING` | create-if-missing (stock line, login counter) | `INSERT INTO inventory(warehouse_id, resource_id) VALUES ($1, $2) ON CONFLICT DO NOTHING` |
| `UPDATE … SET col = col + $n` | atomic relative change, no lost updates | camp admissions |
| `UPDATE … WHERE … AND condition RETURNING` | conditional update: succeeds only if the row is still in the expected state | `UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE'` |
| `UPDATE … WHERE xmin = $version` | optimistic locking: fails (0 rows) if someone else edited the row first | management edit forms |
| `DELETE … RETURNING` | delete reference data; refused by FK RESTRICT if still in use | `DELETE FROM resource_categories WHERE category_id = $1` |
| `SELECT … FOR UPDATE` / `FOR SHARE` | lock rows read inside a transaction | stock lines before allocating |
| `SELECT` with JOIN, GROUP BY, HAVING, subqueries, CTEs, window functions | every list, dashboard and report | see the Project Report §11 |
| `CALL procedure()` | run the status procedure | `CALL refresh_request_status($1)` |

### 7.2 DML by table

| Table | INSERT | UPDATE | DELETE | Fires triggers |
|---|---|---|---|---|
| `roles` | ✔ | — | — | — |
| `app_users` | ✔ | ✔ | — | `row_change_log` |
| `sessions` | ✔ | — | ✔ | — |
| `login_attempts` | ✔ | ✔ | ✔ | — |
| `locations` | ✔ | ✔ | ✔ | — |
| `disasters` | ✔ | ✔ | — | `operational_duplicate`, `row_change_log` |
| `disaster_locations` | ✔ | — | ✔ | — |
| `relief_camps` | ✔ | ✔ | — | `row_change_log` |
| `resource_categories` | ✔ | ✔ | ✔ | — |
| `resources` | ✔ | ✔ | ✔ | — |
| `warehouses` | ✔ | ✔ | — | `operational_duplicate`, `row_change_log` |
| `inventory` | ✔ | ✔ | — | `inventory_history` |
| `inventory_movements` | ✔ | — | — | — |
| `resource_requests` | ✔ | ✔ | — | `row_change_log` |
| `request_items` | ✔ | — | ✔ | — |
| `allocations` | ✔ | ✔ | — | `allocation_status_guard` |
| `allocation_items` | ✔ | — | — | `trg_adjust_inventory`, `trg_validate_allocation_item` |
| `vehicles` | ✔ | ✔ | ✔ | `row_change_log` |
| `volunteers` | ✔ | ✔ | ✔ | `row_change_log` |
| `deliveries` | ✔ | ✔ | — | `delivery_status_guard`, `delivery_vehicle_guard`, `row_change_log` |
| `delivery_volunteers` | ✔ | — | ✔ | — |
| `audit_logs` | ✔ | — | — | — |
| `data_change_log` | ✔ | — | — | — |
| `integration_sync_runs` | ✔ | ✔ | — | — |
| `schema_migrations` | ✔ | — | — | — |

(Details for each table are in Section 4 under *DML performed on this table*.)

### 7.3 One complete workflow, statement by statement

This is what happens in the database when a camp's request goes from creation to delivery. Each step is one API call = one transaction. The statements are the ones in `src/app/api/requests/route.ts` and `src/app/api/operations/route.ts`, slightly simplified (column lists shortened, `$…` are the parameters).

#### Step 1 — A field officer raises a request

```sql
BEGIN;
SET LOCAL ROLE rf_field_officer;                       -- database checks this role's GRANTs from now on
SELECT camp_status, disaster_status FROM lock_request_parents($camp, $disaster);  -- FOR SHARE: camp/disaster cannot close meanwhile
INSERT INTO resource_requests(camp_id, disaster_id, requested_by, need_by, priority_score, priority_level, medical_emergency, remarks)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING request_id;      -- status defaults to PENDING
INSERT INTO request_items(request_id, resource_id, quantity_requested)
SELECT $1, x.r, x.q FROM unnest($2::bigint[], $3::numeric[]) AS x(r, q);   -- PK stops the same resource twice
INSERT INTO audit_logs(user_id, action, details) VALUES ($user, 'REQUEST_CREATED', $json);
COMMIT;
```

Triggers fired: `row_change_log` (resource_requests INSERT → data_change_log).

#### Step 2 — A coordinator approves it

```sql
BEGIN;  SET LOCAL ROLE rf_coordinator;
SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE;      -- lock, check it is PENDING
UPDATE resource_requests SET status = 'APPROVED' WHERE request_id = $1;
INSERT INTO audit_logs(...) VALUES (...);
COMMIT;
```

Triggers fired: `row_change_log` (records status PENDING → APPROVED).

#### Step 3 — The coordinator allocates stock

```sql
BEGIN;  SET LOCAL ROLE rf_coordinator;
SELECT status FROM resource_requests WHERE request_id = $1 FOR UPDATE;      -- lock order: request → lines → stock
INSERT INTO allocations(request_id, allocated_by, remarks) VALUES ($1, $2, $3) RETURNING allocation_id;
INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
VALUES ($a, $1, $r, $w, $q);                                               -- one per line
CALL refresh_request_status($1);                                           -- → PARTIALLY_FULFILLED or ALLOCATED
COMMIT;
```

Triggers fired, in order, for each allocation line:

1. `trg_validate_allocation_item` (BEFORE INSERT) — locks the request line and stock line, checks stock and outstanding demand; rejects the whole transaction if either is exceeded.
2. The row is inserted.
3. `trg_adjust_inventory` (AFTER INSERT) — `UPDATE inventory SET quantity_available = quantity_available − q`.
4. That UPDATE fires `inventory_history` (AFTER UPDATE on inventory) — inserts the movement into inventory_movements.
5. `CALL refresh_request_status` updates the request status, which fires `row_change_log`.

If two coordinators allocate the last stock at the same moment, the second one waits on the row lock taken in step 1; when the first commits, the second re-reads the stock, the check fails, and only the first allocation exists.

#### Step 4 — A delivery is planned

```sql
BEGIN;  SET LOCAL ROLE rf_coordinator;
SELECT 1 FROM resource_requests WHERE request_id = $r FOR UPDATE;
SELECT 1 FROM allocations WHERE allocation_id = $a FOR UPDATE;
SELECT status FROM vehicles WHERE vehicle_id = $v FOR UPDATE;
INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id, expected_arrival)
VALUES (...) RETURNING delivery_id;                                -- status PLANNED
UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE' RETURNING volunteer_id;
INSERT INTO delivery_volunteers(delivery_id, volunteer_id, assigned_role) VALUES (...);
UPDATE vehicles SET status = 'IN_USE' WHERE vehicle_id = $v;
COMMIT;
```

Triggers fired: `delivery_vehicle_guard` (BEFORE INSERT — refuses a vehicle in maintenance), `row_change_log` on deliveries, volunteers and vehicles. The partial unique indexes reject a second active delivery for the same vehicle, driver or allocation.

#### Step 5 — The driver dispatches and delivers

```sql
BEGIN;
SELECT set_config('reliefflow.user_id', '11', true);  SET LOCAL ROLE rf_driver;   -- RLS: only driver 11's rows are visible
UPDATE deliveries SET status = 'IN_TRANSIT', departure_time = now() WHERE delivery_id = $1;
UPDATE allocations SET status = 'IN_TRANSIT' WHERE allocation_id = $a;
CALL refresh_request_status($r);
COMMIT;
-- later: status = 'DELIVERED', actual_arrival = now(); vehicle and volunteers set back to AVAILABLE; request → DELIVERED
```

Triggers fired: `delivery_status_guard` (only legal transitions), `allocation_status_guard` (allocation state machine), `row_change_log`.

#### Alternative — The allocation is cancelled before dispatch

```sql
UPDATE allocations SET status = 'CANCELLED' WHERE allocation_id = $1 RETURNING *;
CALL refresh_request_status($r);
```

`allocation_status_guard` refuses if a delivery is still active, otherwise locks the stock lines and adds the quantities back (firing `inventory_history` with the reason 'Allocation cancellation #id'). A second cancellation is impossible (CANCELLED → CANCELLED is not a transition), so stock is restored exactly once.

### 7.4 Important SELECT queries

The application reads data with joins, aggregates and subqueries. Examples (all from the code or the lab):

```sql
-- authentication on every request: 3-table join
SELECT u.user_id, u.full_name, r.role_name FROM sessions s JOIN app_users u USING (user_id) JOIN roles r USING (role_id)
 WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active;

-- request list: join + aggregate per request + function call
SELECT rr.request_id, c.camp_name, d.disaster_name, rr.priority_level, rr.status,
       count(ri.resource_id) AS lines, request_fulfillment_pct(rr.request_id) AS fulfilled_pct
  FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN disasters d USING (disaster_id)
  JOIN request_items ri USING (request_id)
 GROUP BY rr.request_id, c.camp_name, d.disaster_name ORDER BY rr.priority_score DESC;

-- shortages: from the view built on two CTEs
SELECT resource_name, outstanding_demand, available_stock FROM v_resource_demand WHERE net_position < 0;

-- camps with more than one request (GROUP BY + HAVING)
SELECT c.camp_name, count(*) FROM relief_camps c JOIN resource_requests rr USING (camp_id) GROUP BY c.camp_name HAVING count(*) > 1;

-- full-text search on disasters (GIN index on the generated tsvector column)
SELECT disaster_name, ts_rank(search_vector, q) FROM disasters, websearch_to_tsquery('english', $1) q
 WHERE search_vector @@ q ORDER BY 2 DESC;
```

## 8. Quick glossary

* **Primary key (PK):** the column(s) that identify a row; unique and not null.
* **Foreign key (FK):** a column that must match a primary key in another table.
* **Composite key:** a key made of more than one column.
* **Weak entity:** a table whose rows are identified through their owner's key.
* **CHECK constraint:** a condition every row must satisfy.
* **NOT VALID:** a constraint checked for new and changed rows only, so it can be added to a table with old rows.
* **Index:** a structure that finds rows quickly without scanning the table (B-tree, GIN, HNSW).
* **Partial index:** an index on only the rows matching a WHERE condition.
* **View:** a named, stored SELECT.
* **Function / procedure:** stored code; a function returns a value, a procedure is CALLed.
* **Trigger:** a function run automatically on INSERT / UPDATE / DELETE.
* **Transaction:** a group of statements that succeed or fail together (ACID).
* **FOR UPDATE / FOR SHARE:** row locks taken by a SELECT inside a transaction.
* **xmin:** PostgreSQL's row version, used for optimistic locking.
* **GRANT / REVOKE:** give or remove a role's privileges on tables or columns.
* **Row-level security (RLS):** policies that filter which rows a role can see or change.
* **SECURITY DEFINER:** a function that runs with its owner's privileges.
