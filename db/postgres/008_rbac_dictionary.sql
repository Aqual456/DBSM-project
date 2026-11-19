-- ReliefFlow — migration 008: role-based access control INSIDE PostgreSQL, extra integrity
-- checks and an in-database data dictionary. Re-runnable; changes no existing rows.
--
-- How RBAC works end to end:
--   1. The application authenticates the user (session) and knows their app role.
--   2. Every API transaction runs  SET LOCAL ROLE rf_<role>  (see src/lib/api.ts), so
--      PostgreSQL itself checks table/column privileges and row-level security.
--   3. Even a bug in the API cannot let a driver touch another driver's delivery or let a
--      field officer change stock: the database refuses with "permission denied".

-- ---------------------------------------------------------------------------
-- 1. Database roles (one per application role; NOLOGIN = used only via SET ROLE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['rf_admin','rf_coordinator','rf_field_officer','rf_driver'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', r);
    END IF;
  END LOOP;
END $$;

-- Start from a clean slate for these roles so the grants below are the complete truth.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rf_admin, rf_coordinator, rf_field_officer, rf_driver;
GRANT USAGE ON SCHEMA public TO rf_admin, rf_coordinator, rf_field_officer, rf_driver;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rf_admin, rf_coordinator, rf_field_officer, rf_driver;

-- Administrator: full control of every table.
GRANT ALL ON ALL TABLES IN SCHEMA public TO rf_admin;

-- Everyone (except admin, who has ALL) may read operational reference data and the views.
GRANT SELECT ON roles, locations, disasters, disaster_locations, relief_camps, resource_categories, resources,
                warehouses, inventory, resource_requests, request_items, allocations, allocation_items,
                vehicles, volunteers, deliveries, delivery_volunteers,
                v_low_stock, v_request_fulfillment, v_warehouse_inventory_summary, v_resource_demand, v_disaster_response_summary
  TO rf_coordinator, rf_field_officer, rf_driver;
-- Column-level privilege: nobody but the admin role can read password hashes, e-mails or phones.
GRANT SELECT (user_id, role_id, full_name, is_active, created_at) ON app_users TO rf_coordinator, rf_field_officer, rf_driver;
-- Every role writes its own audit entries; only managers may read the audit trail.
GRANT INSERT ON audit_logs TO rf_coordinator, rf_field_officer, rf_driver;
GRANT SELECT ON audit_logs, data_change_log, inventory_movements, integration_sync_runs TO rf_coordinator;

-- Relief coordinator: runs operations (but cannot manage users or roles).
GRANT INSERT, UPDATE, DELETE ON disasters, disaster_locations, relief_camps, warehouses, locations, vehicles, volunteers,
                                resources, resource_categories, inventory, resource_requests, request_items,
                                allocations, allocation_items, deliveries, delivery_volunteers
  TO rf_coordinator;

-- Field officer: raises requests and records camp admissions/discharges only.
GRANT INSERT ON resource_requests, request_items TO rf_field_officer;
GRANT UPDATE (current_population, status) ON relief_camps TO rf_field_officer;

-- Driver: may only progress deliveries (column-level UPDATE) and the statuses that follow from it.
GRANT UPDATE (status, departure_time, actual_arrival) ON deliveries TO rf_driver;
GRANT UPDATE (status) ON allocations TO rf_driver;
GRANT UPDATE (status, current_location_id) ON vehicles TO rf_driver;
GRANT UPDATE (availability_status) ON volunteers TO rf_driver;
GRANT UPDATE (status) ON resource_requests TO rf_driver;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO rf_admin, rf_coordinator, rf_field_officer, rf_driver;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO rf_admin, rf_coordinator, rf_field_officer, rf_driver;

-- ---------------------------------------------------------------------------
-- 2. Row-level security: a driver sees and updates only their own deliveries
-- ---------------------------------------------------------------------------
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deliveries_staff_all ON deliveries;
CREATE POLICY deliveries_staff_all ON deliveries FOR ALL TO rf_admin, rf_coordinator USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS deliveries_officer_read ON deliveries;
CREATE POLICY deliveries_officer_read ON deliveries FOR SELECT TO rf_field_officer USING (true);
DROP POLICY IF EXISTS deliveries_driver_own ON deliveries;
CREATE POLICY deliveries_driver_own ON deliveries FOR SELECT TO rf_driver
  USING (driver_id = NULLIF(current_setting('reliefflow.user_id', true), '')::BIGINT);
DROP POLICY IF EXISTS deliveries_driver_update_own ON deliveries;
CREATE POLICY deliveries_driver_update_own ON deliveries FOR UPDATE TO rf_driver
  USING (driver_id = NULLIF(current_setting('reliefflow.user_id', true), '')::BIGINT)
  WITH CHECK (driver_id = NULLIF(current_setting('reliefflow.user_id', true), '')::BIGINT);
-- (The table owner, used by the server for non-role-scoped reads and migrations, bypasses RLS.)

-- ---------------------------------------------------------------------------
-- 3. History must not be forgeable: history triggers run with the owner's rights
--    (SECURITY DEFINER), so application roles need no INSERT on the history tables.
-- ---------------------------------------------------------------------------
ALTER FUNCTION log_row_change() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION record_inventory_movement() SECURITY DEFINER SET search_path = public;

-- Parent checks for request creation without granting UPDATE on camps/disasters to officers:
-- the definer function takes the FOR SHARE locks on their behalf.
CREATE OR REPLACE FUNCTION lock_request_parents(p_camp BIGINT, p_disaster BIGINT)
RETURNS TABLE(camp_status TEXT, disaster_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT (SELECT c.status::TEXT FROM relief_camps c WHERE c.camp_id = p_camp FOR SHARE),
         (SELECT d.status::TEXT FROM disasters d WHERE d.disaster_id = p_disaster FOR SHARE);
END $$;
REVOKE ALL ON FUNCTION lock_request_parents(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_request_parents(BIGINT, BIGINT) TO rf_admin, rf_coordinator, rf_field_officer;

-- ---------------------------------------------------------------------------
-- 4. More validation at the database level (NOT VALID keeps any legacy rows untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_email_format;
ALTER TABLE app_users ADD CONSTRAINT app_users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
ALTER TABLE volunteers DROP CONSTRAINT IF EXISTS volunteers_phone_format;
ALTER TABLE volunteers ADD CONSTRAINT volunteers_phone_format CHECK (phone ~ '^\+?[0-9 -]{7,25}$') NOT VALID;
ALTER TABLE volunteers DROP CONSTRAINT IF EXISTS volunteers_email_format;
ALTER TABLE volunteers ADD CONSTRAINT volunteers_email_format CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') NOT VALID;
ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_nonblank;
ALTER TABLE resources ADD CONSTRAINT resources_nonblank CHECK (length(btrim(resource_name)) >= 2 AND length(btrim(unit)) >= 1) NOT VALID;
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_nonblank;
ALTER TABLE locations ADD CONSTRAINT locations_nonblank CHECK (length(btrim(location_name)) >= 2) NOT VALID;
ALTER TABLE resource_requests DROP CONSTRAINT IF EXISTS resource_requests_priority_consistency;
ALTER TABLE resource_requests ADD CONSTRAINT resource_requests_priority_consistency
  CHECK (NOT (priority_level = 'CRITICAL' AND priority_score < 50)) NOT VALID;

-- ---------------------------------------------------------------------------
-- 5. Data dictionary stored in the catalog (read by the ER explorer and the report)
-- ---------------------------------------------------------------------------
COMMENT ON TABLE roles IS 'Application roles (ADMIN, RELIEF_COORDINATOR, FIELD_OFFICER, DRIVER).';
COMMENT ON COLUMN roles.role_id IS 'Surrogate primary key.';
COMMENT ON COLUMN roles.role_name IS 'Unique role code used for authorisation.';
COMMENT ON COLUMN roles.description IS 'Human-readable description of the role.';

COMMENT ON TABLE app_users IS 'People who can sign in. Passwords are stored only as bcrypt hashes.';
COMMENT ON COLUMN app_users.user_id IS 'Surrogate primary key.';
COMMENT ON COLUMN app_users.role_id IS 'FK to roles: the user''s single role.';
COMMENT ON COLUMN app_users.full_name IS 'Display name.';
COMMENT ON COLUMN app_users.email IS 'Login e-mail (alternate key, format-checked).';
COMMENT ON COLUMN app_users.password_hash IS 'bcrypt hash (cost 12); readable only by rf_admin.';
COMMENT ON COLUMN app_users.phone IS 'Optional unique phone number.';
COMMENT ON COLUMN app_users.is_active IS 'FALSE blocks sign-in and invalidates sessions.';
COMMENT ON COLUMN app_users.created_at IS 'When the account was created.';

COMMENT ON TABLE sessions IS 'Server-side sessions. Only the SHA-256 hash of the cookie token is stored.';
COMMENT ON COLUMN sessions.token_hash IS 'SHA-256 of the random session token (primary key).';
COMMENT ON COLUMN sessions.user_id IS 'FK to app_users (cascade delete).';
COMMENT ON COLUMN sessions.expires_at IS 'Absolute expiry (8 hours after sign-in).';

COMMENT ON TABLE login_attempts IS 'Login throttling window per e-mail.';
COMMENT ON COLUMN login_attempts.email IS 'Normalised e-mail being attempted (primary key).';
COMMENT ON COLUMN login_attempts.attempts IS 'Failed attempts in the current window.';
COMMENT ON COLUMN login_attempts.window_start IS 'Start of the 15-minute window.';

COMMENT ON TABLE audit_logs IS 'Application audit trail, written in the same transaction as each change.';
COMMENT ON COLUMN audit_logs.audit_id IS 'Surrogate primary key.';
COMMENT ON COLUMN audit_logs.user_id IS 'FK to the acting user.';
COMMENT ON COLUMN audit_logs.action IS 'Operation code, e.g. ALLOCATIONS, DELIVERY_STATUS.';
COMMENT ON COLUMN audit_logs.details IS 'JSON input and result of the operation (passwords removed).';
COMMENT ON COLUMN audit_logs.created_at IS 'When the action happened.';

COMMENT ON TABLE data_change_log IS 'Row-level change history written by the log_row_change() trigger.';
COMMENT ON COLUMN data_change_log.change_id IS 'Surrogate primary key.';
COMMENT ON COLUMN data_change_log.table_name IS 'Table that changed.';
COMMENT ON COLUMN data_change_log.operation IS 'INSERT, UPDATE or DELETE.';
COMMENT ON COLUMN data_change_log.row_data IS 'Row after (or before, for DELETE) the change, without secrets.';
COMMENT ON COLUMN data_change_log.changed_fields IS 'JSON diff {field: {from, to}} for UPDATEs.';
COMMENT ON COLUMN data_change_log.changed_by IS 'Acting user id taken from the reliefflow.user_id session setting.';
COMMENT ON COLUMN data_change_log.txid IS 'Transaction id, groups changes made together.';
COMMENT ON COLUMN data_change_log.changed_at IS 'When the change happened.';

COMMENT ON TABLE integration_sync_runs IS 'One row per Neo4j / vector synchronisation run.';
COMMENT ON COLUMN integration_sync_runs.run_id IS 'Surrogate primary key.';
COMMENT ON COLUMN integration_sync_runs.target IS 'neo4j or vector.';
COMMENT ON COLUMN integration_sync_runs.status IS 'RUNNING, SUCCEEDED or FAILED.';
COMMENT ON COLUMN integration_sync_runs.attempts IS 'Attempts used (max 3).';
COMMENT ON COLUMN integration_sync_runs.records_synced IS 'Records written to the target.';
COMMENT ON COLUMN integration_sync_runs.detail IS 'Summary or failure reason.';
COMMENT ON COLUMN integration_sync_runs.triggered_by IS 'FK to the user who started the sync.';
COMMENT ON COLUMN integration_sync_runs.started_at IS 'Start time.';
COMMENT ON COLUMN integration_sync_runs.finished_at IS 'End time (NULL while running).';

COMMENT ON TABLE schema_migrations IS 'Applied migration files (each runs once).';
COMMENT ON COLUMN schema_migrations.filename IS 'Migration file name (primary key).';
COMMENT ON COLUMN schema_migrations.applied_at IS 'When it was applied.';

COMMENT ON TABLE locations IS 'Places: districts, camp areas, depots. Coordinates drive the map and distances.';
COMMENT ON COLUMN locations.location_id IS 'Surrogate primary key.';
COMMENT ON COLUMN locations.location_name IS 'Name of the place.';
COMMENT ON COLUMN locations.location_type IS 'DISTRICT, CAMP_AREA, DEPOT, WARD, ...';
COMMENT ON COLUMN locations.address IS 'Postal/landmark address.';
COMMENT ON COLUMN locations.latitude IS 'WGS-84 latitude (-90..90).';
COMMENT ON COLUMN locations.longitude IS 'WGS-84 longitude (-180..180).';

COMMENT ON TABLE disasters IS 'Disaster events being responded to.';
COMMENT ON COLUMN disasters.disaster_id IS 'Surrogate primary key.';
COMMENT ON COLUMN disasters.disaster_name IS 'Event name (duplicate events rejected by trigger).';
COMMENT ON COLUMN disasters.disaster_type IS 'FLOOD, CYCLONE, EARTHQUAKE, ...';
COMMENT ON COLUMN disasters.severity IS 'LOW, MODERATE, HIGH or CRITICAL.';
COMMENT ON COLUMN disasters.started_at IS 'When the event started.';
COMMENT ON COLUMN disasters.ended_at IS 'When it was closed (must be after started_at).';
COMMENT ON COLUMN disasters.status IS 'ACTIVE, CONTAINED or CLOSED.';
COMMENT ON COLUMN disasters.description IS 'Free-text situation summary.';
COMMENT ON COLUMN disasters.created_by IS 'FK to the coordinator who registered it.';
COMMENT ON COLUMN disasters.created_at IS 'Registration time.';
COMMENT ON COLUMN disasters.event_location_id IS 'FK to the main event location.';
COMMENT ON COLUMN disasters.search_vector IS 'Generated tsvector for full-text search (GIN indexed).';

COMMENT ON TABLE disaster_locations IS 'M:N: which locations a disaster affects, with impact attributes.';
COMMENT ON COLUMN disaster_locations.disaster_id IS 'PK part / FK to disasters.';
COMMENT ON COLUMN disaster_locations.location_id IS 'PK part / FK to locations.';
COMMENT ON COLUMN disaster_locations.impact_level IS 'LOW, MODERATE, HIGH or SEVERE.';
COMMENT ON COLUMN disaster_locations.affected_population IS 'People affected at this location (>= 0).';
COMMENT ON COLUMN disaster_locations.reported_at IS 'When the impact was reported.';

COMMENT ON TABLE relief_camps IS 'Shelters with capacity and current occupancy.';
COMMENT ON COLUMN relief_camps.camp_id IS 'Surrogate primary key.';
COMMENT ON COLUMN relief_camps.location_id IS 'FK to the camp location.';
COMMENT ON COLUMN relief_camps.camp_name IS 'Camp name.';
COMMENT ON COLUMN relief_camps.capacity IS 'Maximum people (> 0).';
COMMENT ON COLUMN relief_camps.current_population IS 'People sheltered now (0..capacity).';
COMMENT ON COLUMN relief_camps.manager_id IS 'Optional FK to the managing user.';
COMMENT ON COLUMN relief_camps.status IS 'OPEN, FULL (= at capacity) or CLOSED (= empty).';
COMMENT ON COLUMN relief_camps.established_at IS 'Opening date.';

COMMENT ON TABLE resource_categories IS 'Groups of resources (FOOD, WATER, MEDICAL, ...).';
COMMENT ON COLUMN resource_categories.category_id IS 'Surrogate primary key.';
COMMENT ON COLUMN resource_categories.category_name IS 'Unique category code.';
COMMENT ON COLUMN resource_categories.description IS 'Description.';

COMMENT ON TABLE resources IS 'Catalogue of relief items, each with a unit of measure.';
COMMENT ON COLUMN resources.resource_id IS 'Surrogate primary key.';
COMMENT ON COLUMN resources.category_id IS 'FK to resource_categories.';
COMMENT ON COLUMN resources.resource_name IS 'Item name (unique within its category).';
COMMENT ON COLUMN resources.unit IS 'Unit of measure: kg, litre, kit, piece ...';
COMMENT ON COLUMN resources.description IS 'Optional notes.';
COMMENT ON COLUMN resources.is_perishable IS 'TRUE for items with limited shelf life.';

COMMENT ON TABLE warehouses IS 'Storage sites holding stock.';
COMMENT ON COLUMN warehouses.warehouse_id IS 'Surrogate primary key.';
COMMENT ON COLUMN warehouses.location_id IS 'FK to the warehouse location.';
COMMENT ON COLUMN warehouses.warehouse_name IS 'Name (unique per location via trigger).';
COMMENT ON COLUMN warehouses.manager_id IS 'Optional FK to the managing user.';
COMMENT ON COLUMN warehouses.capacity IS 'Storage capacity (> 0).';
COMMENT ON COLUMN warehouses.status IS 'ACTIVE, INACTIVE or MAINTENANCE; only ACTIVE supplies stock.';

COMMENT ON TABLE inventory IS 'Stock line: quantity of one resource in one warehouse (weak entity).';
COMMENT ON COLUMN inventory.warehouse_id IS 'PK part / FK to warehouses.';
COMMENT ON COLUMN inventory.resource_id IS 'PK part / FK to resources.';
COMMENT ON COLUMN inventory.quantity_available IS 'Units on hand (CHECK >= 0).';
COMMENT ON COLUMN inventory.minimum_threshold IS 'Low-stock alert level.';
COMMENT ON COLUMN inventory.last_updated IS 'Time of the last stock change.';

COMMENT ON TABLE inventory_movements IS 'Every stock change with its reason (written by trigger).';
COMMENT ON COLUMN inventory_movements.movement_id IS 'Surrogate primary key.';
COMMENT ON COLUMN inventory_movements.warehouse_id IS 'Composite FK part to inventory.';
COMMENT ON COLUMN inventory_movements.resource_id IS 'Composite FK part to inventory.';
COMMENT ON COLUMN inventory_movements.delta IS 'Signed change (+ received, - dispatched).';
COMMENT ON COLUMN inventory_movements.reason IS 'Why stock changed.';
COMMENT ON COLUMN inventory_movements.created_at IS 'When it changed.';

COMMENT ON TABLE resource_requests IS 'A camp''s request for resources (header).';
COMMENT ON COLUMN resource_requests.request_id IS 'Surrogate primary key.';
COMMENT ON COLUMN resource_requests.camp_id IS 'FK to the requesting camp.';
COMMENT ON COLUMN resource_requests.disaster_id IS 'FK to the disaster it relates to.';
COMMENT ON COLUMN resource_requests.requested_by IS 'FK to the field officer who raised it (taken from the session).';
COMMENT ON COLUMN resource_requests.requested_at IS 'When it was raised.';
COMMENT ON COLUMN resource_requests.need_by IS 'Deadline (must be after requested_at).';
COMMENT ON COLUMN resource_requests.priority_score IS 'Priority 0..100.';
COMMENT ON COLUMN resource_requests.priority_level IS 'LOW, MEDIUM, HIGH or CRITICAL.';
COMMENT ON COLUMN resource_requests.status IS 'PENDING → APPROVED → PARTIALLY_FULFILLED/ALLOCATED → IN_TRANSIT → DELIVERED, or REJECTED/CANCELLED.';
COMMENT ON COLUMN resource_requests.medical_emergency IS 'Flag that moves the request to the top.';
COMMENT ON COLUMN resource_requests.remarks IS 'Situation notes.';
COMMENT ON COLUMN resource_requests.search_vector IS 'Generated tsvector over remarks (GIN indexed).';

COMMENT ON TABLE request_items IS 'Lines of a request: resource and quantity (weak entity).';
COMMENT ON COLUMN request_items.request_id IS 'PK part / FK to resource_requests (cascade).';
COMMENT ON COLUMN request_items.resource_id IS 'PK part / FK to resources.';
COMMENT ON COLUMN request_items.quantity_requested IS 'Quantity asked for (> 0).';

COMMENT ON TABLE allocations IS 'Commitment of stock to a request.';
COMMENT ON COLUMN allocations.allocation_id IS 'Surrogate primary key.';
COMMENT ON COLUMN allocations.request_id IS 'FK to the request being fulfilled.';
COMMENT ON COLUMN allocations.allocated_by IS 'FK to the coordinator who allocated.';
COMMENT ON COLUMN allocations.allocated_at IS 'When stock was committed.';
COMMENT ON COLUMN allocations.status IS 'ALLOCATED → IN_TRANSIT → DELIVERED, or ALLOCATED → CANCELLED (stock restored).';
COMMENT ON COLUMN allocations.remarks IS 'Optional notes.';

COMMENT ON TABLE allocation_items IS 'Allocation lines: how much of which resource from which warehouse (immutable).';
COMMENT ON COLUMN allocation_items.allocation_item_id IS 'Surrogate primary key.';
COMMENT ON COLUMN allocation_items.allocation_id IS 'Composite FK (allocation_id, request_id) to allocations.';
COMMENT ON COLUMN allocation_items.request_id IS 'Shared by two composite FKs: ties the line to its request line.';
COMMENT ON COLUMN allocation_items.resource_id IS 'Composite FK part to request_items and inventory.';
COMMENT ON COLUMN allocation_items.warehouse_id IS 'Composite FK part to inventory (the stock drawn from).';
COMMENT ON COLUMN allocation_items.quantity_allocated IS 'Quantity committed (> 0, <= stock and outstanding demand).';

COMMENT ON TABLE vehicles IS 'Fleet used for deliveries.';
COMMENT ON COLUMN vehicles.vehicle_id IS 'Surrogate primary key.';
COMMENT ON COLUMN vehicles.vehicle_number IS 'Registration number (alternate key).';
COMMENT ON COLUMN vehicles.vehicle_type IS 'TRUCK, VAN, BOAT, ...';
COMMENT ON COLUMN vehicles.capacity IS 'Load capacity (> 0).';
COMMENT ON COLUMN vehicles.status IS 'AVAILABLE, IN_USE or MAINTENANCE.';
COMMENT ON COLUMN vehicles.current_location_id IS 'Optional FK to the last known location.';

COMMENT ON TABLE volunteers IS 'Volunteers who can crew deliveries.';
COMMENT ON COLUMN volunteers.volunteer_id IS 'Surrogate primary key.';
COMMENT ON COLUMN volunteers.full_name IS 'Name.';
COMMENT ON COLUMN volunteers.phone IS 'Unique phone (format-checked).';
COMMENT ON COLUMN volunteers.email IS 'Optional unique e-mail (format-checked).';
COMMENT ON COLUMN volunteers.skills IS 'Free-text skills.';
COMMENT ON COLUMN volunteers.availability_status IS 'AVAILABLE, ASSIGNED or UNAVAILABLE.';
COMMENT ON COLUMN volunteers.registered_at IS 'Registration time.';

COMMENT ON TABLE deliveries IS 'Transport of one allocation (row-level security: drivers see only their own).';
COMMENT ON COLUMN deliveries.delivery_id IS 'Surrogate primary key.';
COMMENT ON COLUMN deliveries.allocation_id IS 'FK to the allocation transported (one active delivery each).';
COMMENT ON COLUMN deliveries.vehicle_id IS 'FK to the vehicle (one active delivery each).';
COMMENT ON COLUMN deliveries.driver_id IS 'FK to the driver (one active delivery each).';
COMMENT ON COLUMN deliveries.source_location_id IS 'FK: pickup location (warehouse).';
COMMENT ON COLUMN deliveries.destination_location_id IS 'FK: drop location (camp).';
COMMENT ON COLUMN deliveries.departure_time IS 'Set when dispatched.';
COMMENT ON COLUMN deliveries.expected_arrival IS 'Planned arrival.';
COMMENT ON COLUMN deliveries.actual_arrival IS 'Set when delivered.';
COMMENT ON COLUMN deliveries.status IS 'PLANNED → IN_TRANSIT ↔ DELAYED → DELIVERED, or PLANNED → CANCELLED (trigger-enforced).';

COMMENT ON TABLE delivery_volunteers IS 'M:N: volunteers crewing a delivery.';
COMMENT ON COLUMN delivery_volunteers.delivery_id IS 'PK part / FK to deliveries (cascade).';
COMMENT ON COLUMN delivery_volunteers.volunteer_id IS 'PK part / FK to volunteers (cascade).';
COMMENT ON COLUMN delivery_volunteers.assigned_role IS 'Role on the delivery, e.g. LOADING_SUPPORT.';
