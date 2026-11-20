/* =====================================================================
   ReliefFlow 2.0 - pgAdmin Query Tool demo script
   Database: reliefflow   (Servers > ReliefFlow > ReliefFlow (PostgreSQL 16))

   HOW TO RUN
   - pgAdmin shows the result grid of the LAST statement only, so run one
     step at a time: highlight a step (from its SELECT to its semicolon) and
     press F5 (Execute). The results appear in "Data Output".
   - Steps 15-21 are trigger demos written as DO blocks. Their output is in
     the "Messages" tab (RAISE NOTICE lines).
   - Nothing in this script changes your data. Every write is rolled back
     inside its own block, and step 22 ends with ROLLBACK. The only lasting
     effect is that sequences skip a few ids, which is harmless.
   ===================================================================== */


/* ---------- PART A: WHAT IS IN THE DATABASE ---------- */

-- STEP 1. Dashboard numbers (stored function operational_summary)
SELECT * FROM operational_summary();

-- STEP 2. Every table with its exact row count
SELECT table_name,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]::text::int AS row_count
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
 ORDER BY table_name;

-- STEP 3. Disasters with the locations they hit (JOIN + GROUP BY)
SELECT d.disaster_name, d.disaster_type, d.severity, d.status,
       count(dl.location_id)            AS affected_locations,
       sum(dl.affected_population)      AS affected_population,
       string_agg(l.location_name, ', ' ORDER BY l.location_name) AS locations
  FROM disasters d
  LEFT JOIN disaster_locations dl ON dl.disaster_id = d.disaster_id
  LEFT JOIN locations l           ON l.location_id = dl.location_id
 GROUP BY d.disaster_id
 ORDER BY affected_population DESC NULLS LAST;

-- STEP 4. The same picture from a VIEW
SELECT disaster_name, severity, status, affected_locations, affected_population,
       total_requests, open_requests, units_allocated
  FROM v_disaster_response_summary
 ORDER BY affected_population DESC NULLS LAST;

-- STEP 5. Relief camps: occupancy and manager
SELECT c.camp_name, l.location_name, c.status,
       c.current_population, c.capacity,
       round(100.0 * c.current_population / NULLIF(c.capacity, 0), 1) AS occupancy_pct,
       u.full_name AS manager
  FROM relief_camps c
  JOIN locations l      ON l.location_id = c.location_id
  LEFT JOIN app_users u ON u.user_id = c.manager_id
 ORDER BY occupancy_pct DESC;

-- STEP 6. Warehouse stock summary (VIEW)
SELECT * FROM v_warehouse_inventory_summary ORDER BY warehouse_name;

-- STEP 7. Low-stock alerts (VIEW): stock below the minimum threshold
SELECT * FROM v_low_stock ORDER BY quantity_available;


/* ---------- PART B: REQUESTS, ALLOCATIONS, DELIVERIES ---------- */

-- STEP 8. Every request with its fulfilment % (stored function request_fulfillment_pct)
SELECT rr.request_id, c.camp_name, d.disaster_name, rr.priority_level,
       rr.medical_emergency, rr.status,
       request_fulfillment_pct(rr.request_id) AS fulfilled_pct
  FROM resource_requests rr
  JOIN relief_camps c USING (camp_id)
  JOIN disasters d    USING (disaster_id)
 ORDER BY rr.priority_score DESC;

-- STEP 9. Line by line: requested vs allocated vs still outstanding (VIEW)
SELECT f.request_id, f.resource_name, f.quantity_requested, f.quantity_allocated, f.quantity_remaining
  FROM v_request_fulfillment f
 WHERE f.quantity_remaining > 0
 ORDER BY f.request_id, f.resource_name;

-- STEP 10. Demand vs stock per item; negative net_position = shortage (VIEW)
SELECT resource_name, unit, category_name, outstanding_demand, available_stock, net_position
  FROM v_resource_demand
 ORDER BY net_position;

-- STEP 11. Deliveries with vehicle, driver, route (5-table JOIN)
SELECT dl.delivery_id, dl.status, v.vehicle_number, v.vehicle_type,
       u.full_name AS driver, src.location_name AS from_location,
       dst.location_name AS to_location, dl.departure_time, dl.expected_arrival, dl.actual_arrival
  FROM deliveries dl
  JOIN vehicles v    ON v.vehicle_id = dl.vehicle_id
  JOIN app_users u   ON u.user_id = dl.driver_id
  JOIN locations src ON src.location_id = dl.source_location_id
  JOIN locations dst ON dst.location_id = dl.destination_location_id
 ORDER BY dl.delivery_id;

-- STEP 12. Window function: rank warehouses by stock of each item
SELECT r.resource_name, w.warehouse_name, i.quantity_available,
       rank() OVER (PARTITION BY r.resource_id ORDER BY i.quantity_available DESC) AS stock_rank,
       resource_availability(r.resource_id) AS total_across_active_warehouses
  FROM inventory i
  JOIN resources r  USING (resource_id)
  JOIN warehouses w USING (warehouse_id)
 ORDER BY r.resource_name, stock_rank;

-- STEP 13. Correlated subquery: camps that have NOT received any delivery yet
SELECT c.camp_name, c.status, c.current_population
  FROM relief_camps c
 WHERE NOT EXISTS (
         SELECT 1
           FROM deliveries dl
           JOIN locations l ON l.location_id = dl.destination_location_id
          WHERE l.location_id = c.location_id AND dl.status = 'DELIVERED');

-- STEP 14. Search: full-text on request remarks + fuzzy (trigram) match on a misspelt name
SELECT 'full-text' AS method, request_id::text AS hit, remarks AS detail
  FROM resource_requests
 WHERE search_vector @@ plainto_tsquery('english', 'insulin')
UNION ALL
SELECT 'trigram', disaster_name, 'similarity ' || round(similarity(disaster_name, 'Periyar Rivr Flod')::numeric, 2)
  FROM disasters
 WHERE similarity(disaster_name, 'Periyar Rivr Flod') > 0.2;


/* ---------- PART C: TRIGGERS IN ACTION (see the Messages tab) ---------- */

-- STEP 15. List every trigger in the database
SELECT event_object_table AS on_table, trigger_name, action_timing AS timing,
       string_agg(event_manipulation, ', ') AS events
  FROM information_schema.triggers
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;

-- STEP 16. A valid allocation: stock goes down automatically, the movement is
--          logged and the request status is refreshed. Then everything is rolled back.
DO $$
DECLARE r record; who bigint; alloc bigint; qty numeric; stock_now numeric; st_before text; st_after text; mv text;
BEGIN
  SELECT f.request_id, f.resource_id, f.resource_name, f.quantity_remaining, i.warehouse_id, w.warehouse_name, i.quantity_available
    INTO r
    FROM v_request_fulfillment f
    JOIN resource_requests rr ON rr.request_id = f.request_id
    JOIN inventory i  ON i.resource_id = f.resource_id
    JOIN warehouses w ON w.warehouse_id = i.warehouse_id AND w.status = 'ACTIVE'
   WHERE rr.status IN ('APPROVED','PARTIALLY_FULFILLED') AND f.quantity_remaining > 0 AND i.quantity_available > 0
   ORDER BY i.quantity_available DESC LIMIT 1;
  IF NOT FOUND THEN RAISE NOTICE 'No approved request with stock available'; RETURN; END IF;
  SELECT u.user_id INTO who FROM app_users u JOIN roles USING (role_id)
   WHERE role_name IN ('ADMIN','RELIEF_COORDINATOR') ORDER BY u.user_id LIMIT 1;
  qty := LEAST(r.quantity_remaining, r.quantity_available, 10);

  BEGIN
    SELECT status INTO st_before FROM resource_requests WHERE request_id = r.request_id;
    RAISE NOTICE 'Request #% (% of %) status: %', r.request_id, qty, r.resource_name, st_before;
    RAISE NOTICE '% stock BEFORE: %', r.warehouse_name, r.quantity_available;

    INSERT INTO allocations(request_id, allocated_by, remarks)
    VALUES (r.request_id, who, 'pgAdmin demo') RETURNING allocation_id INTO alloc;
    INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
    VALUES (alloc, r.request_id, r.resource_id, r.warehouse_id, qty);   -- fires validate + adjust_inventory triggers

    SELECT quantity_available INTO stock_now FROM inventory WHERE warehouse_id = r.warehouse_id AND resource_id = r.resource_id;
    SELECT delta || ' (' || reason || ')' INTO mv FROM inventory_movements ORDER BY movement_id DESC LIMIT 1;
    CALL refresh_request_status(r.request_id);                          -- stored procedure
    SELECT status INTO st_after FROM resource_requests WHERE request_id = r.request_id;

    RAISE NOTICE '% stock AFTER:  %   (trigger adjust_inventory_for_allocation)', r.warehouse_name, stock_now;
    RAISE NOTICE 'Movement logged: %   (trigger record_inventory_movement)', mv;
    RAISE NOTICE 'Request status now: %   (procedure refresh_request_status)', st_after;
    RAISE EXCEPTION 'DEMO_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'DEMO_ROLLBACK' THEN RAISE; END IF;
  END;

  SELECT quantity_available INTO stock_now FROM inventory WHERE warehouse_id = r.warehouse_id AND resource_id = r.resource_id;
  RAISE NOTICE 'Rolled back. % stock is % again.', r.warehouse_name, stock_now;
END $$;

-- STEP 17. Blocked: allocating more than the warehouse holds (trigger validate_allocation_item)
DO $$
DECLARE r record; who bigint; alloc bigint;
BEGIN
  SELECT f.request_id, f.resource_id, i.warehouse_id, i.quantity_available INTO r
    FROM v_request_fulfillment f
    JOIN resource_requests rr ON rr.request_id = f.request_id
    JOIN inventory i ON i.resource_id = f.resource_id
   WHERE rr.status IN ('APPROVED','PARTIALLY_FULFILLED') AND f.quantity_remaining > 0
   LIMIT 1;
  SELECT user_id INTO who FROM app_users ORDER BY user_id LIMIT 1;
  INSERT INTO allocations(request_id, allocated_by) VALUES (r.request_id, who) RETURNING allocation_id INTO alloc;
  INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
  VALUES (alloc, r.request_id, r.resource_id, r.warehouse_id, r.quantity_available + 100000);
  RAISE NOTICE 'Unexpected: insert succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM;
END $$;

-- STEP 18. Blocked: editing an allocation line after the fact (allocation lines are immutable)
DO $$
BEGIN
  UPDATE allocation_items SET quantity_allocated = quantity_allocated + 1
   WHERE allocation_item_id = (SELECT min(allocation_item_id) FROM allocation_items);
  RAISE NOTICE 'Unexpected: update succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM;
END $$;

-- STEP 19. Blocked: moving a DELIVERED allocation back to ALLOCATED (trigger allocation_status_guard)
DO $$
BEGIN
  UPDATE allocations SET status = 'ALLOCATED'
   WHERE allocation_id = (SELECT min(allocation_id) FROM allocations WHERE status = 'DELIVERED');
  RAISE NOTICE 'Unexpected: update succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM;
END $$;

-- STEP 20. Blocked: sending a truck that is under maintenance (trigger delivery_vehicle_guard)
DO $$
DECLARE a record; truck bigint;
BEGIN
  SELECT vehicle_id INTO truck FROM vehicles WHERE status = 'MAINTENANCE' LIMIT 1;
  SELECT d.allocation_id, d.driver_id, d.source_location_id, d.destination_location_id INTO a
    FROM deliveries d LIMIT 1;
  INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id)
  VALUES (a.allocation_id, truck, a.driver_id, a.source_location_id, a.destination_location_id);
  RAISE NOTICE 'Unexpected: insert succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM;
END $$;

-- STEP 21. Blocked: a duplicate warehouse at the same location, different spacing/case
--          (trigger prevent_operational_duplicate)
DO $$
DECLARE w record;
BEGIN
  SELECT warehouse_name, location_id, capacity INTO w FROM warehouses ORDER BY warehouse_id LIMIT 1;
  INSERT INTO warehouses(location_id, warehouse_name, capacity)
  VALUES (w.location_id, '  ' || upper(w.warehouse_name) || ' ', w.capacity);
  RAISE NOTICE 'Unexpected: insert succeeded';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'BLOCKED by trigger: %', SQLERRM;
END $$;


/* ---------- PART D: SECURITY AND AUDIT ---------- */

-- STEP 22. Row-level security: act as the DRIVER Ramesh Pillai.
--          Highlight these 4 lines and press F5: only his own deliveries come back.
BEGIN;
SELECT set_config('reliefflow.user_id', (SELECT user_id::text FROM app_users WHERE full_name = 'Ramesh Pillai'), true);
SET LOCAL ROLE rf_driver;
SELECT delivery_id, status, driver_id, current_user AS acting_as FROM deliveries;
-- ...then run this line on its own to switch back:
ROLLBACK;

-- STEP 23. Which database role may do what on the main tables
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE grantee LIKE 'rf\_%'
   AND table_name IN ('deliveries','resource_requests','allocations','inventory','app_users')
 GROUP BY grantee, table_name
 ORDER BY table_name, grantee;

-- STEP 24. Audit trail written by the log_row_change trigger (latest 20 changes)
SELECT change_id, table_name, operation, changed_fields, changed_by, changed_at
  FROM data_change_log
 ORDER BY change_id DESC
 LIMIT 20;

-- STEP 25. Stock movement history written by the record_inventory_movement trigger
SELECT m.created_at, w.warehouse_name, r.resource_name, m.delta, m.reason
  FROM inventory_movements m
  JOIN warehouses w USING (warehouse_id)
  JOIN resources r  USING (resource_id)
 ORDER BY m.movement_id DESC
 LIMIT 20;
