-- ReliefFlow PostgreSQL schema. Run against a fresh database.
CREATE TABLE IF NOT EXISTS roles (
  role_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name VARCHAR(40) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS app_users (
  user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone VARCHAR(25) UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disasters (
  disaster_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  disaster_name VARCHAR(160) NOT NULL,
  disaster_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONTAINED','CLOSED')),
  description TEXT,
  created_by BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS locations (
  location_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_name VARCHAR(160) NOT NULL,
  location_type VARCHAR(40) NOT NULL,
  address TEXT NOT NULL,
  latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS disaster_locations (
  disaster_id BIGINT NOT NULL REFERENCES disasters(disaster_id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  impact_level VARCHAR(20) NOT NULL CHECK (impact_level IN ('LOW','MODERATE','HIGH','SEVERE')),
  affected_population INTEGER NOT NULL DEFAULT 0 CHECK (affected_population >= 0),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (disaster_id, location_id)
);

CREATE TABLE IF NOT EXISTS relief_camps (
  camp_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  camp_name VARCHAR(160) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  current_population INTEGER NOT NULL DEFAULT 0 CHECK (current_population >= 0 AND current_population <= capacity),
  manager_id BIGINT REFERENCES app_users(user_id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FULL','CLOSED')),
  established_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS resource_categories (
  category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS resources (
  resource_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES resource_categories(category_id) ON DELETE RESTRICT,
  resource_name VARCHAR(120) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  description TEXT,
  is_perishable BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (category_id, resource_name)
);

CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  warehouse_name VARCHAR(160) NOT NULL,
  manager_id BIGINT REFERENCES app_users(user_id) ON DELETE SET NULL,
  capacity NUMERIC(14,2) NOT NULL CHECK (capacity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE'))
);

CREATE TABLE IF NOT EXISTS inventory (
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
  resource_id BIGINT NOT NULL REFERENCES resources(resource_id) ON DELETE RESTRICT,
  quantity_available NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  minimum_threshold NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (minimum_threshold >= 0),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id, resource_id)
);

CREATE TABLE IF NOT EXISTS resource_requests (
  request_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  camp_id BIGINT NOT NULL REFERENCES relief_camps(camp_id) ON DELETE RESTRICT,
  disaster_id BIGINT NOT NULL REFERENCES disasters(disaster_id) ON DELETE RESTRICT,
  requested_by BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  need_by TIMESTAMPTZ NOT NULL,
  priority_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (priority_score BETWEEN 0 AND 100),
  priority_level VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED','FULFILLED','REJECTED','CANCELLED')),
  medical_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  remarks TEXT,
  CHECK (need_by >= requested_at)
);

CREATE TABLE IF NOT EXISTS request_items (
  request_id BIGINT NOT NULL REFERENCES resource_requests(request_id) ON DELETE CASCADE,
  resource_id BIGINT NOT NULL REFERENCES resources(resource_id) ON DELETE RESTRICT,
  quantity_requested NUMERIC(14,3) NOT NULL CHECK (quantity_requested > 0),
  PRIMARY KEY (request_id, resource_id)
);

CREATE TABLE IF NOT EXISTS allocations (
  allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES resource_requests(request_id) ON DELETE RESTRICT,
  allocated_by BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN ('ALLOCATED','IN_TRANSIT','DELIVERED','CANCELLED')),
  remarks TEXT,
  UNIQUE (allocation_id, request_id)
);

CREATE TABLE IF NOT EXISTS allocation_items (
  allocation_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  allocation_id BIGINT NOT NULL,
  request_id BIGINT NOT NULL,
  resource_id BIGINT NOT NULL,
  warehouse_id BIGINT NOT NULL,
  quantity_allocated NUMERIC(14,3) NOT NULL CHECK (quantity_allocated > 0),
  FOREIGN KEY (allocation_id, request_id) REFERENCES allocations(allocation_id, request_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, resource_id) REFERENCES request_items(request_id, resource_id) ON DELETE RESTRICT,
  FOREIGN KEY (warehouse_id, resource_id) REFERENCES inventory(warehouse_id, resource_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_number VARCHAR(30) NOT NULL UNIQUE,
  vehicle_type VARCHAR(50) NOT NULL,
  capacity NUMERIC(14,2) NOT NULL CHECK (capacity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','IN_USE','MAINTENANCE')),
  current_location_id BIGINT REFERENCES locations(location_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  allocation_id BIGINT NOT NULL REFERENCES allocations(allocation_id) ON DELETE RESTRICT,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE RESTRICT,
  driver_id BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  source_location_id BIGINT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  destination_location_id BIGINT NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  departure_time TIMESTAMPTZ,
  expected_arrival TIMESTAMPTZ,
  actual_arrival TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_TRANSIT','DELIVERED','DELAYED','CANCELLED')),
  CHECK (expected_arrival IS NULL OR departure_time IS NULL OR expected_arrival >= departure_time),
  CHECK (actual_arrival IS NULL OR departure_time IS NULL OR actual_arrival >= departure_time)
);

CREATE TABLE IF NOT EXISTS delivery_volunteers (
  delivery_id BIGINT NOT NULL REFERENCES deliveries(delivery_id) ON DELETE CASCADE,
  volunteer_id BIGINT NOT NULL,
  assigned_role VARCHAR(60) NOT NULL,
  PRIMARY KEY (delivery_id, volunteer_id)
);

CREATE TABLE IF NOT EXISTS volunteers (
  volunteer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(25) NOT NULL UNIQUE,
  email VARCHAR(254) UNIQUE,
  skills TEXT,
  availability_status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE','ASSIGNED','UNAVAILABLE')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE delivery_volunteers DROP CONSTRAINT IF EXISTS fk_delivery_volunteer_volunteer;
ALTER TABLE delivery_volunteers
  ADD CONSTRAINT fk_delivery_volunteer_volunteer
  FOREIGN KEY (volunteer_id) REFERENCES volunteers(volunteer_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_disasters_status_severity ON disasters(status, severity);
CREATE INDEX IF NOT EXISTS idx_requests_status_priority ON resource_requests(status, priority_level, need_by);
CREATE INDEX IF NOT EXISTS idx_requests_camp ON resource_requests(camp_id);
CREATE INDEX IF NOT EXISTS idx_inventory_resource ON inventory(resource_id);
CREATE INDEX IF NOT EXISTS idx_allocation_items_request ON allocation_items(request_id, resource_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status_eta ON deliveries(status, expected_arrival);
CREATE INDEX IF NOT EXISTS idx_disaster_locations_location ON disaster_locations(location_id);

CREATE OR REPLACE VIEW v_low_stock AS
SELECT w.warehouse_id, w.warehouse_name, r.resource_id, r.resource_name,
       i.quantity_available, i.minimum_threshold, r.unit
FROM inventory i
JOIN warehouses w ON w.warehouse_id = i.warehouse_id
JOIN resources r ON r.resource_id = i.resource_id
WHERE i.quantity_available <= i.minimum_threshold;

CREATE OR REPLACE VIEW v_request_fulfillment AS
SELECT ri.request_id, ri.resource_id, r.resource_name, ri.quantity_requested,
       COALESCE(SUM(CASE WHEN a.status <> 'CANCELLED' THEN ai.quantity_allocated ELSE 0 END), 0) AS quantity_allocated,
       GREATEST(ri.quantity_requested - COALESCE(SUM(CASE WHEN a.status <> 'CANCELLED' THEN ai.quantity_allocated ELSE 0 END), 0), 0) AS quantity_remaining
FROM request_items ri
JOIN resources r ON r.resource_id = ri.resource_id
LEFT JOIN allocation_items ai ON ai.request_id = ri.request_id AND ai.resource_id = ri.resource_id
LEFT JOIN allocations a ON a.allocation_id = ai.allocation_id
GROUP BY ri.request_id, ri.resource_id, r.resource_name, ri.quantity_requested;

-- Trigger: prevent an allocation line from exceeding available stock or the outstanding request.
CREATE OR REPLACE FUNCTION validate_allocation_item() RETURNS TRIGGER AS $$
DECLARE
  stock NUMERIC(14,3);
  requested NUMERIC(14,3);
  already_allocated NUMERIC(14,3);
BEGIN
  SELECT quantity_available INTO stock
  FROM inventory
  WHERE warehouse_id = NEW.warehouse_id AND resource_id = NEW.resource_id
  FOR UPDATE;
  IF stock IS NULL THEN RAISE EXCEPTION 'No inventory row exists for warehouse %, resource %', NEW.warehouse_id, NEW.resource_id; END IF;

  SELECT quantity_requested INTO requested
  FROM request_items WHERE request_id = NEW.request_id AND resource_id = NEW.resource_id
  FOR UPDATE;

  SELECT COALESCE(SUM(quantity_allocated),0) INTO already_allocated
  FROM allocation_items
  WHERE request_id = NEW.request_id AND resource_id = NEW.resource_id
    AND (TG_OP = 'INSERT' OR allocation_item_id <> OLD.allocation_item_id);

  IF TG_OP = 'UPDATE' AND OLD.warehouse_id = NEW.warehouse_id AND OLD.resource_id = NEW.resource_id THEN
    stock := stock + OLD.quantity_allocated;
  END IF;
  IF NEW.quantity_allocated > stock THEN RAISE EXCEPTION 'Insufficient stock. Available: %, requested allocation: %', stock, NEW.quantity_allocated; END IF;
  IF already_allocated + NEW.quantity_allocated > requested THEN
    RAISE EXCEPTION 'Allocation exceeds requested quantity. Requested: %, already allocated: %, new: %', requested, already_allocated, NEW.quantity_allocated;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_allocation_item ON allocation_items;
CREATE TRIGGER trg_validate_allocation_item
BEFORE INSERT OR UPDATE ON allocation_items
FOR EACH ROW EXECUTE FUNCTION validate_allocation_item();

-- Trigger: decrement stock on insert; restore old stock and deduct new stock on update; restore on delete.
CREATE OR REPLACE FUNCTION adjust_inventory_for_allocation() RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_adjust_inventory ON allocation_items;
CREATE TRIGGER trg_adjust_inventory
AFTER INSERT OR UPDATE OR DELETE ON allocation_items
FOR EACH ROW EXECUTE FUNCTION adjust_inventory_for_allocation();

-- Stored function: return remaining quantity for one requested resource.
CREATE OR REPLACE FUNCTION remaining_request_quantity(p_request_id BIGINT, p_resource_id BIGINT)
RETURNS NUMERIC(14,3) LANGUAGE SQL STABLE AS $$
  SELECT GREATEST(ri.quantity_requested - COALESCE(SUM(CASE WHEN a.status <> 'CANCELLED' THEN ai.quantity_allocated ELSE 0 END),0),0)
  FROM request_items ri
  LEFT JOIN allocation_items ai ON ai.request_id = ri.request_id AND ai.resource_id = ri.resource_id
  LEFT JOIN allocations a ON a.allocation_id = ai.allocation_id
  WHERE ri.request_id = p_request_id AND ri.resource_id = p_resource_id
  GROUP BY ri.quantity_requested;
$$;
