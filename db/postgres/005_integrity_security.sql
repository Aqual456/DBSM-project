BEGIN;
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES app_users ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs(audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id BIGINT REFERENCES app_users ON DELETE RESTRICT, action TEXT NOT NULL,details JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS inventory_movements(movement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,warehouse_id BIGINT NOT NULL,resource_id BIGINT NOT NULL,delta NUMERIC(14,3) NOT NULL,reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(warehouse_id,resource_id) REFERENCES inventory);
ALTER TABLE disasters ADD COLUMN IF NOT EXISTS event_location_id BIGINT REFERENCES locations;
ALTER TABLE resource_requests DROP CONSTRAINT IF EXISTS resource_requests_status_check;
ALTER TABLE resource_requests ADD CONSTRAINT resource_requests_status_check CHECK(status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED','FULFILLED','ALLOCATED','IN_TRANSIT','DELIVERED','REJECTED','CANCELLED'));
-- Triggers check duplicates without modifying existing duplicates. Advisory locks serialize concurrent checks.
CREATE OR REPLACE FUNCTION prevent_operational_duplicate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
END $$;
DROP TRIGGER IF EXISTS operational_duplicate ON warehouses;
CREATE TRIGGER operational_duplicate BEFORE INSERT OR UPDATE OF warehouse_name,location_id ON warehouses FOR EACH ROW EXECUTE FUNCTION prevent_operational_duplicate();
DROP TRIGGER IF EXISTS operational_duplicate ON disasters;
CREATE TRIGGER operational_duplicate BEFORE INSERT OR UPDATE OF disaster_name,disaster_type,started_at,event_location_id ON disasters FOR EACH ROW EXECUTE FUNCTION prevent_operational_duplicate();
CREATE OR REPLACE FUNCTION record_inventory_movement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO inventory_movements(warehouse_id,resource_id,delta,reason) VALUES(NEW.warehouse_id,NEW.resource_id,NEW.quantity_available-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantity_available END,COALESCE(NULLIF(current_setting('reliefflow.reason',true),''),'Stock adjustment'));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_history ON inventory;
CREATE TRIGGER inventory_history AFTER INSERT OR UPDATE OF quantity_available ON inventory FOR EACH ROW EXECUTE FUNCTION record_inventory_movement();
-- Lock request first, then inventory; enforce immutable historical allocation lines.
CREATE OR REPLACE FUNCTION validate_allocation_item() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
END $$;

-- Additional rules are validated without rewriting existing historical rows.
ALTER TABLE relief_camps DROP CONSTRAINT IF EXISTS camp_status_occupancy;
ALTER TABLE relief_camps ADD CONSTRAINT camp_status_occupancy CHECK((status='CLOSED' AND current_population=0) OR (status='FULL' AND current_population=capacity) OR (status='OPEN' AND current_population<capacity)) NOT VALID;
ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouse_nonblank;
ALTER TABLE warehouses ADD CONSTRAINT warehouse_nonblank CHECK(length(btrim(warehouse_name))>=2) NOT VALID;
ALTER TABLE disasters DROP CONSTRAINT IF EXISTS disaster_nonblank;
ALTER TABLE disasters ADD CONSTRAINT disaster_nonblank CHECK(length(btrim(disaster_name))>=2) NOT VALID;

COMMIT;

