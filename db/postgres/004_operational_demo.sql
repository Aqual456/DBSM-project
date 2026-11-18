
-- ReliefFlow operational demo data
-- Safe to re-run: uses stable names and request markers.

-- 1. Create demo disasters.
INSERT INTO disasters
    (disaster_name, disaster_type, severity, started_at, description, created_by)
SELECT
    v.disaster_name, v.disaster_type, v.severity,
    NOW() - v.age, v.description, u.user_id
FROM (
    VALUES
    ('Bengaluru Urban Flooding', 'FLOOD', 'CRITICAL',
     INTERVAL '2 days', 'Heavy rainfall causing urban flooding and displacement.'),
    ('North Bengaluru Water Shortage', 'DROUGHT', 'HIGH',
     INTERVAL '5 days', 'Water shortage affecting communities in northern Bengaluru.')
) AS v(disaster_name, disaster_type, severity, age, description)
CROSS JOIN app_users u
WHERE u.email = 'admin@reliefflow.local'
AND NOT EXISTS (
    SELECT 1 FROM disasters d WHERE d.disaster_name = v.disaster_name
);

-- 2. Link disasters to affected locations.
INSERT INTO disaster_locations
    (disaster_id, location_id, impact_level, affected_population)
SELECT d.disaster_id, l.location_id, v.impact_level, v.affected_population
FROM (
    VALUES
    ('Bengaluru Urban Flooding', 'Central Relief Zone', 'SEVERE', 2500),
    ('North Bengaluru Water Shortage', 'North Relief Camp Zone', 'HIGH', 1200)
) AS v(disaster_name, location_name, impact_level, affected_population)
JOIN disasters d ON d.disaster_name = v.disaster_name
JOIN locations l ON l.location_name = v.location_name
ON CONFLICT (disaster_id, location_id) DO NOTHING;

-- 3. Create relief camps.
INSERT INTO relief_camps
    (location_id, camp_name, capacity, current_population, manager_id, status)
SELECT l.location_id, v.camp_name, v.capacity, v.population, u.user_id, 'OPEN'
FROM (
    VALUES
    ('Central Relief Zone', 'Central Flood Relief Camp', 500, 320),
    ('North Relief Camp Zone', 'North Community Relief Camp', 300, 180)
) AS v(location_name, camp_name, capacity, population)
JOIN locations l ON l.location_name = v.location_name
CROSS JOIN app_users u
WHERE u.email = 'admin@reliefflow.local'
AND NOT EXISTS (
    SELECT 1 FROM relief_camps c WHERE c.camp_name = v.camp_name
);

-- 4. Create warehouses.
INSERT INTO warehouses
    (location_id, warehouse_name, manager_id, capacity, status)
SELECT l.location_id, v.warehouse_name, u.user_id, v.capacity, 'ACTIVE'
FROM (
    VALUES
    ('Central Relief Zone', 'Central Relief Warehouse', 10000.00),
    ('North Relief Camp Zone', 'North Supply Warehouse', 6000.00)
) AS v(location_name, warehouse_name, capacity)
JOIN locations l ON l.location_name = v.location_name
CROSS JOIN app_users u
WHERE u.email = 'admin@reliefflow.local'
AND NOT EXISTS (
    SELECT 1 FROM warehouses w WHERE w.warehouse_name = v.warehouse_name
);

-- 5. Populate warehouse inventory.
INSERT INTO inventory
    (warehouse_id, resource_id, quantity_available, minimum_threshold)
SELECT
    w.warehouse_id,
    r.resource_id,
    CASE r.resource_name
        WHEN 'Food Packet' THEN 800
        WHEN 'Drinking Water' THEN 120
        WHEN 'First Aid Kit' THEN 150
        WHEN 'Blanket' THEN 400
        ELSE 100
    END,
    CASE r.resource_name
        WHEN 'Food Packet' THEN 100
        WHEN 'Drinking Water' THEN 200
        WHEN 'First Aid Kit' THEN 30
        WHEN 'Blanket' THEN 50
        ELSE 20
    END
FROM warehouses w
CROSS JOIN resources r
WHERE w.warehouse_name IN (
    'Central Relief Warehouse',
    'North Supply Warehouse'
)
ON CONFLICT (warehouse_id, resource_id) DO NOTHING;

-- 6. Create resource requests.
INSERT INTO resource_requests
    (camp_id, disaster_id, requested_by, need_by,
     priority_score, priority_level, status, medical_emergency, remarks)
SELECT
    c.camp_id,
    d.disaster_id,
    u.user_id,
    NOW() + v.delivery_window,
    v.priority_score,
    v.priority_level,
    v.status,
    v.medical_emergency,
    v.marker
FROM (
    VALUES
    ('Central Flood Relief Camp', 'Bengaluru Urban Flooding',
     INTERVAL '12 hours', 95.00, 'CRITICAL', 'PENDING', TRUE,
     'DEMO-REQ-FLOOD-001'),
    ('Central Flood Relief Camp', 'Bengaluru Urban Flooding',
     INTERVAL '24 hours', 80.00, 'HIGH', 'PENDING', FALSE,
     'DEMO-REQ-FLOOD-002'),
    ('North Community Relief Camp', 'North Bengaluru Water Shortage',
     INTERVAL '18 hours', 75.00, 'HIGH', 'APPROVED', FALSE,
     'DEMO-REQ-WATER-001')
) AS v(camp_name, disaster_name, delivery_window,
       priority_score, priority_level, status, medical_emergency, marker)
JOIN relief_camps c ON c.camp_name = v.camp_name
JOIN disasters d ON d.disaster_name = v.disaster_name
CROSS JOIN app_users u
WHERE u.email = 'admin@reliefflow.local'
AND NOT EXISTS (
    SELECT 1 FROM resource_requests rr WHERE rr.remarks = v.marker
);

-- 7. Add requested resources to each request.
INSERT INTO request_items (request_id, resource_id, quantity_requested)
SELECT rr.request_id, r.resource_id, v.quantity
FROM (
    VALUES
    ('DEMO-REQ-FLOOD-001', 'Food Packet', 250.000),
    ('DEMO-REQ-FLOOD-001', 'Drinking Water', 500.000),
    ('DEMO-REQ-FLOOD-001', 'First Aid Kit', 40.000),
    ('DEMO-REQ-FLOOD-002', 'Blanket', 150.000),
    ('DEMO-REQ-WATER-001', 'Drinking Water', 350.000),
    ('DEMO-REQ-WATER-001', 'Food Packet', 100.000)
) AS v(marker, resource_name, quantity)
JOIN resource_requests rr ON rr.remarks = v.marker
JOIN resources r ON r.resource_name = v.resource_name
ON CONFLICT (request_id, resource_id) DO NOTHING;
