-- ReliefFlow 2.0 — incremental, re-runnable migration.
-- Adds: foreign-key indexes, database-enforced logistics rules, analytical views,
-- stored functions/procedures, row-level change auditing, full-text search and
-- integration sync bookkeeping. No existing rows are modified or deleted.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Indexes on foreign keys and hot filter columns (joins + ON DELETE checks)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_allocations_request ON allocations(request_id);
CREATE INDEX IF NOT EXISTS idx_allocation_items_allocation ON allocation_items(allocation_id);
CREATE INDEX IF NOT EXISTS idx_allocation_items_stock ON allocation_items(warehouse_id, resource_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_allocation ON deliveries(allocation_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_vehicle ON deliveries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_delivery_volunteers_volunteer ON delivery_volunteers(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_relief_camps_location ON relief_camps(location_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_location ON warehouses(location_id);
CREATE INDEX IF NOT EXISTS idx_request_items_resource ON request_items(resource_id);
CREATE INDEX IF NOT EXISTS idx_requests_disaster ON resource_requests(disaster_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_stock ON inventory_movements(warehouse_id, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_locations_name_trgm ON locations USING gin (location_name gin_trgm_ops);

-- One active delivery per allocation / vehicle / driver, enforced by the database
-- (closes the race window that application checks alone cannot close).
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_delivery_allocation ON deliveries(allocation_id) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_delivery_vehicle ON deliveries(vehicle_id) WHERE status IN ('PLANNED','IN_TRANSIT','DELAYED');
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_delivery_driver ON deliveries(driver_id) WHERE status IN ('PLANNED','IN_TRANSIT','DELAYED');

-- ---------------------------------------------------------------------------
-- 2. Business-rule triggers
-- ---------------------------------------------------------------------------
-- Delivery lifecycle is a state machine; enforce it below the API.
CREATE OR REPLACE FUNCTION delivery_status_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS delivery_status_guard ON deliveries;
CREATE TRIGGER delivery_status_guard BEFORE UPDATE OF status ON deliveries
FOR EACH ROW EXECUTE FUNCTION delivery_status_guard();

-- A delivery may only be planned with a vehicle that is not under maintenance.
CREATE OR REPLACE FUNCTION delivery_vehicle_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM vehicles WHERE vehicle_id = NEW.vehicle_id FOR UPDATE;
  IF v_status = 'MAINTENANCE' THEN RAISE EXCEPTION 'Vehicle is under maintenance'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS delivery_vehicle_guard ON deliveries;
CREATE TRIGGER delivery_vehicle_guard BEFORE INSERT ON deliveries
FOR EACH ROW EXECUTE FUNCTION delivery_vehicle_guard();

-- ---------------------------------------------------------------------------
-- 3. Row-level change log (trigger-based auditing, complements app audit_logs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_change_log (
  change_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_data    JSONB,
  changed_fields JSONB,
  changed_by  BIGINT,
  txid        BIGINT NOT NULL DEFAULT txid_current(),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_change_log_table ON data_change_log(table_name, changed_at DESC);

CREATE OR REPLACE FUNCTION log_row_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['disasters','relief_camps','warehouses','vehicles','volunteers','resource_requests','app_users','deliveries'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS row_change_log ON %I', t);
    EXECUTE format('CREATE TRIGGER row_change_log AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_row_change()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Full-text search (generated tsvector + GIN)
-- ---------------------------------------------------------------------------
ALTER TABLE disasters ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(disaster_name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(disaster_type,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_disasters_fts ON disasters USING gin (search_vector);

ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(remarks,''))) STORED;
CREATE INDEX IF NOT EXISTS idx_requests_fts ON resource_requests USING gin (search_vector);

-- ---------------------------------------------------------------------------
-- 5. Analytical views
-- ---------------------------------------------------------------------------
-- Stock position per warehouse, with committed (allocated, not yet delivered) stock.
CREATE OR REPLACE VIEW v_warehouse_inventory_summary AS
SELECT w.warehouse_id, w.warehouse_name, w.status, l.location_name,
       COUNT(i.resource_id)                                        AS resource_lines,
       COALESCE(SUM(i.quantity_available), 0)                      AS units_available,
       COUNT(*) FILTER (WHERE i.quantity_available <= i.minimum_threshold) AS low_stock_lines,
       MAX(i.last_updated)                                         AS last_stock_change
FROM warehouses w
JOIN locations l ON l.location_id = w.location_id
LEFT JOIN inventory i ON i.warehouse_id = w.warehouse_id
GROUP BY w.warehouse_id, w.warehouse_name, w.status, l.location_name;

-- Demand versus supply per resource (outstanding demand only counts open requests).
CREATE OR REPLACE VIEW v_resource_demand AS
WITH demand AS (
  SELECT f.resource_id, SUM(f.quantity_remaining) AS outstanding
  FROM v_request_fulfillment f
  JOIN resource_requests rr ON rr.request_id = f.request_id
  WHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')
  GROUP BY f.resource_id
), supply AS (
  SELECT i.resource_id, SUM(i.quantity_available) AS available
  FROM inventory i JOIN warehouses w USING (warehouse_id)
  WHERE w.status = 'ACTIVE'
  GROUP BY i.resource_id
)
SELECT r.resource_id, r.resource_name, r.unit, c.category_name,
       COALESCE(d.outstanding, 0) AS outstanding_demand,
       COALESCE(s.available, 0)   AS available_stock,
       COALESCE(s.available, 0) - COALESCE(d.outstanding, 0) AS net_position
FROM resources r
JOIN resource_categories c USING (category_id)
LEFT JOIN demand d USING (resource_id)
LEFT JOIN supply s USING (resource_id);

-- One row per disaster with its response footprint.
CREATE OR REPLACE VIEW v_disaster_response_summary AS
SELECT d.disaster_id, d.disaster_name, d.disaster_type, d.severity, d.status, d.started_at,
       (SELECT COUNT(*) FROM disaster_locations dl WHERE dl.disaster_id = d.disaster_id)                 AS affected_locations,
       (SELECT COALESCE(SUM(dl.affected_population),0) FROM disaster_locations dl WHERE dl.disaster_id = d.disaster_id) AS affected_population,
       (SELECT COUNT(*) FROM resource_requests rr WHERE rr.disaster_id = d.disaster_id)                  AS total_requests,
       (SELECT COUNT(*) FROM resource_requests rr WHERE rr.disaster_id = d.disaster_id
                                               AND rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')) AS open_requests,
       (SELECT COALESCE(SUM(ai.quantity_allocated),0)
          FROM allocation_items ai JOIN allocations a USING (allocation_id)
          JOIN resource_requests rr ON rr.request_id = a.request_id
         WHERE rr.disaster_id = d.disaster_id AND a.status <> 'CANCELLED')                              AS units_allocated
FROM disasters d;

-- ---------------------------------------------------------------------------
-- 6. Functions and procedures
-- ---------------------------------------------------------------------------
-- Total stock of a resource across ACTIVE warehouses.
CREATE OR REPLACE FUNCTION resource_availability(p_resource_id BIGINT)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(SUM(i.quantity_available), 0)
  FROM inventory i JOIN warehouses w USING (warehouse_id)
  WHERE i.resource_id = p_resource_id AND w.status = 'ACTIVE';
$$;

-- Percentage (0-100) of requested quantity covered by non-cancelled allocations.
CREATE OR REPLACE FUNCTION request_fulfillment_pct(p_request_id BIGINT)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT CASE WHEN SUM(quantity_requested) = 0 THEN 0
              ELSE ROUND(100 * SUM(quantity_allocated) / SUM(quantity_requested), 1) END
  FROM v_request_fulfillment WHERE request_id = p_request_id;
$$;

-- Set-returning summary used by reports and the lab.
CREATE OR REPLACE FUNCTION operational_summary()
RETURNS TABLE(metric TEXT, value NUMERIC) LANGUAGE SQL STABLE AS $$
  SELECT 'active_disasters', COUNT(*)::NUMERIC FROM disasters WHERE status = 'ACTIVE'
  UNION ALL SELECT 'affected_population', COALESCE(SUM(dl.affected_population),0)
            FROM disaster_locations dl JOIN disasters d USING (disaster_id) WHERE d.status <> 'CLOSED'
  UNION ALL SELECT 'open_camps', COUNT(*) FROM relief_camps WHERE status <> 'CLOSED'
  UNION ALL SELECT 'open_requests', COUNT(*) FROM resource_requests WHERE status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')
  UNION ALL SELECT 'low_stock_lines', COUNT(*) FROM v_low_stock
  UNION ALL SELECT 'active_deliveries', COUNT(*) FROM deliveries WHERE status IN ('PLANNED','IN_TRANSIT','DELAYED');
$$;

-- Single source of truth for derived request status (called by the API after
-- allocation, cancellation and delivery changes).
CREATE OR REPLACE PROCEDURE refresh_request_status(p_request_id BIGINT)
LANGUAGE plpgsql AS $$
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
END $$;

-- ---------------------------------------------------------------------------
-- 7. Integration bookkeeping (graph / vector synchronisation status)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_sync_runs (
  run_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target         TEXT NOT NULL CHECK (target IN ('neo4j','vector')),
  status         TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  attempts       INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  records_synced INTEGER NOT NULL DEFAULT 0 CHECK (records_synced >= 0),
  detail         TEXT,
  triggered_by   BIGINT REFERENCES app_users(user_id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_target ON integration_sync_runs(target, started_at DESC);

-- Registry of applied migrations (maintained by scripts/migrate.ts).
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
