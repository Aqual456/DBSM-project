/**
 * Curated, executable DBMS demonstrations. Every demo runs against the sanitised lab
 * snapshot (reliefflow_lab) in a transaction that is always rolled back.
 * `steps` run in order in ONE transaction, so later steps see earlier changes.
 */
export type Demo = {
  id: string;
  unit: 1 | 2 | 3 | 4;
  section: string;
  title: string;
  explain: string;
  algebra?: string;
  steps: string[];
  plan?: boolean; // results contain EXPLAIN JSON
};

const D = (unit: Demo["unit"], section: string, id: string, title: string, explain: string, steps: string[], extra: Partial<Demo> = {}): Demo => ({
  id,
  unit,
  section,
  title,
  explain,
  steps,
  ...extra,
});

export const sections: Record<string, { unit: number; title: string; blurb: string }> = {
  "sql-basics": { unit: 1, title: "SQL fundamentals", blurb: "DDL, DML and query clauses on ReliefFlow data." },
  constraints: { unit: 1, title: "Keys & constraints", blurb: "Primary, candidate, composite and foreign keys enforced by PostgreSQL." },
  algebra: { unit: 1, title: "Relational algebra", blurb: "Each operator with its algebra expression, the equivalent SQL and live results." },
  aggregation: { unit: 1, title: "Aggregation & grouping", blurb: "Aggregate functions, GROUP BY and HAVING." },
  modification: { unit: 2, title: "Database modification", blurb: "INSERT … SELECT, UPDATE … FROM, DELETE with subqueries, UPSERT." },
  "set-ops": { unit: 2, title: "Set operations", blurb: "UNION, UNION ALL, INTERSECT and EXCEPT." },
  nulls: { unit: 2, title: "NULL values", blurb: "Three-valued logic, IS NULL, COALESCE, NULLIF and NULLs in aggregates." },
  subqueries: { unit: 2, title: "Nested & correlated subqueries", blurb: "Scalar, IN/EXISTS, correlated and ALL/ANY subqueries." },
  joins: { unit: 2, title: "Join expressions", blurb: "INNER, LEFT, RIGHT, FULL OUTER, CROSS and SELF joins." },
  views: { unit: 2, title: "Views", blurb: "Stored queries the application uses for stock and fulfilment." },
  triggers: { unit: 2, title: "Triggers", blurb: "Real ReliefFlow triggers: stock deduction, history, auditing and rule enforcement." },
  routines: { unit: 2, title: "Functions & procedures", blurb: "PL/pgSQL and SQL routines used by the API." },
  cte: { unit: 2, title: "Common table expressions", blurb: "Basic, chained and recursive CTEs." },
  windows: { unit: 2, title: "Window functions", blurb: "Ranking, offsets and running aggregates without collapsing rows." },
  fts: { unit: 2, title: "Full-text & fuzzy search", blurb: "tsvector/tsquery with GIN indexes and trigram similarity." },
  processing: { unit: 3, title: "Query processing", blurb: "How a query is parsed, rewritten, planned and executed." },
  optimization: { unit: 3, title: "Query optimisation", blurb: "Measured EXPLAIN ANALYZE comparisons on 300,000 synthetic rows." },
  normalization: { unit: 3, title: "Anomalies & decomposition", blurb: "Anomalies in a denormalised relation and lossless decomposition, verified in SQL." },
  transactions: { unit: 4, title: "Transactions", blurb: "Atomicity, consistency and savepoints with the allocation workflow." },
};

export const demos: Demo[] = [
  // ------------------------------------------------------------- UNIT 1: SQL
  D(1, "sql-basics", "select-where-order", "SELECT · WHERE · ORDER BY",
    "Filter rows with a predicate and sort the result. Here: open disasters, most severe first. ORDER BY on a CASE expression gives a domain-specific order instead of alphabetical.",
    [`SELECT disaster_id, disaster_name, disaster_type, severity, status
FROM disasters
WHERE status <> 'CLOSED'
ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MODERATE' THEN 3 ELSE 4 END, started_at DESC;`]),
  D(1, "sql-basics", "distinct-limit", "DISTINCT · LIMIT · OFFSET",
    "DISTINCT removes duplicate rows (SQL is a bag language; relational algebra is set-based). LIMIT/OFFSET page through a sorted result.",
    [`SELECT DISTINCT disaster_type FROM disasters ORDER BY 1;`,
     `SELECT w.warehouse_name, r.resource_name, i.quantity_available
FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
ORDER BY i.quantity_available DESC
LIMIT 5 OFFSET 0;`]),
  D(1, "sql-basics", "insert-update-delete", "INSERT · UPDATE · DELETE (with RETURNING)",
    "DML changes data. RETURNING shows the affected rows without a second query. The sandbox rolls everything back afterwards.",
    [`INSERT INTO locations(location_name, location_type, address, latitude, longitude)
VALUES ('Lab Test Ward', 'WARD', 'Sandbox only', 12.90, 77.60)
RETURNING location_id, location_name;`,
     `UPDATE locations SET address = 'Sandbox only (edited)'
WHERE location_name = 'Lab Test Ward'
RETURNING location_id, address;`,
     `DELETE FROM locations WHERE location_name = 'Lab Test Ward' RETURNING location_id;`,
     `SELECT count(*) AS remaining_lab_rows FROM locations WHERE location_name = 'Lab Test Ward';`]),
  D(1, "sql-basics", "ddl", "CREATE · ALTER · DROP",
    "DDL defines structure. A table is created, altered (new column + CHECK constraint), used, and dropped — PostgreSQL DDL is transactional, so even this is rolled back.",
    [`CREATE TABLE field_teams (
  team_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_name VARCHAR(80) NOT NULL UNIQUE
);`,
     `ALTER TABLE field_teams ADD COLUMN members INTEGER NOT NULL DEFAULT 4;`,
     `ALTER TABLE field_teams ADD CONSTRAINT team_size CHECK (members BETWEEN 2 AND 20);`,
     `INSERT INTO field_teams(team_name, members) VALUES ('Boat Rescue A', 6), ('Medical Unit 3', 4) RETURNING *;`,
     `SAVEPOINT before_bad_insert;`,
     `INSERT INTO field_teams(team_name, members) VALUES ('Too Big', 50);`,
     `ROLLBACK TO SAVEPOINT before_bad_insert;`,
     `DROP TABLE field_teams;`,
     `SELECT to_regclass('field_teams') AS table_after_drop;`]),
  D(1, "sql-basics", "truncate", "TRUNCATE vs DELETE",
    "TRUNCATE removes all rows at once without scanning (no per-row triggers, resets storage); DELETE removes rows one by one and can be filtered.",
    [`CREATE TABLE stock_copy AS SELECT * FROM inventory;`,
     `SELECT count(*) AS rows_before FROM stock_copy;`,
     `TRUNCATE stock_copy;`,
     `SELECT count(*) AS rows_after FROM stock_copy;`]),
  D(1, "constraints", "keys-catalog", "Primary, composite & alternate keys",
    "The system catalog describes every key. inventory and request_items use COMPOSITE primary keys; app_users.email and vehicles.vehicle_number are ALTERNATE (candidate) keys enforced with UNIQUE.",
    [`SELECT conrelid::regclass AS table_name,
       CASE contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE (alternate key)' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'c' THEN 'CHECK' END AS constraint_type,
       conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype IN ('p','u')
ORDER BY 1, 2;`]),
  D(1, "constraints", "violations", "Constraints rejecting bad data",
    "Each statement violates a different constraint. The database — not the UI — is the final guard. A SAVEPOINT lets later statements run after an error.",
    [`SAVEPOINT s;`,
     `INSERT INTO relief_camps(location_id, camp_name, capacity, current_population) VALUES ((SELECT min(location_id) FROM locations), 'Overfull', 10, 25);`,
     `ROLLBACK TO SAVEPOINT s;`,
     `INSERT INTO vehicles(vehicle_number, vehicle_type, capacity) SELECT vehicle_number, vehicle_type, capacity FROM vehicles LIMIT 1;`,
     `ROLLBACK TO SAVEPOINT s;`,
     `INSERT INTO resources(category_id, resource_name, unit) VALUES (999999, 'Ghost Resource', 'unit');`,
     `ROLLBACK TO SAVEPOINT s;`,
     `INSERT INTO inventory(warehouse_id, resource_id, quantity_available) SELECT warehouse_id, resource_id, -5 FROM inventory LIMIT 1;`,
     `ROLLBACK TO SAVEPOINT s;`,
     `DELETE FROM resource_categories WHERE category_id = (SELECT category_id FROM resources LIMIT 1);`]),
  D(1, "constraints", "fk-graph", "Foreign keys & referential actions",
    "Every foreign key, the table it references and what happens on delete (RESTRICT protects history; CASCADE removes dependent detail rows).",
    [`SELECT conrelid::regclass AS child, confrelid::regclass AS parent,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' END AS on_delete
FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY 1, 2;`]),

  // ------------------------------------------------------------- UNIT 1: Relational algebra
  D(1, "algebra", "ra-select", "Selection σ",
    "Selection keeps the tuples that satisfy a predicate (horizontal subset). It maps to WHERE.",
    [`SELECT * FROM disasters WHERE severity = 'CRITICAL';`], { algebra: "σ severity='CRITICAL' (disasters)" }),
  D(1, "algebra", "ra-project", "Projection π",
    "Projection keeps chosen attributes (vertical subset) and, being a set operation, removes duplicates — so the faithful SQL needs DISTINCT.",
    [`SELECT DISTINCT disaster_type, severity FROM disasters;`], { algebra: "π disaster_type, severity (disasters)" }),
  D(1, "algebra", "ra-union", "Union ∪",
    "Locations that host a camp OR a warehouse. Both operands must be union-compatible (same arity and domains).",
    [`SELECT location_id FROM relief_camps
UNION
SELECT location_id FROM warehouses
ORDER BY 1;`], { algebra: "π location_id (relief_camps) ∪ π location_id (warehouses)" }),
  D(1, "algebra", "ra-difference", "Set difference −",
    "Locations with a warehouse but no relief camp — candidate sites for new shelters near stock.",
    [`SELECT l.location_id, l.location_name FROM locations l
WHERE l.location_id IN (SELECT location_id FROM warehouses
                        EXCEPT
                        SELECT location_id FROM relief_camps);`], { algebra: "π location_id (warehouses) − π location_id (relief_camps)" }),
  D(1, "algebra", "ra-intersect", "Intersection ∩",
    "Locations that have BOTH a camp and a warehouse. R ∩ S = R − (R − S).",
    [`SELECT location_id FROM relief_camps
INTERSECT
SELECT location_id FROM warehouses;`], { algebra: "π location_id (relief_camps) ∩ π location_id (warehouses)" }),
  D(1, "algebra", "ra-product", "Cartesian product ×",
    "Every pairing of warehouses and resources: |W| × |R| tuples. It is the basis of every join (a join is a selection over a product).",
    [`SELECT (SELECT count(*) FROM warehouses) AS warehouses, (SELECT count(*) FROM resources) AS resources,
       (SELECT count(*) FROM warehouses CROSS JOIN resources) AS product_size;`,
     `SELECT w.warehouse_name, r.resource_name FROM warehouses w CROSS JOIN resources r ORDER BY 1, 2 LIMIT 12;`],
    { algebra: "warehouses × resources" }),
  D(1, "algebra", "ra-rename", "Rename ρ",
    "Rename lets one relation appear twice. Pairs of warehouses at the same location require two copies of warehouses: ρ W1 and ρ W2.",
    [`SELECT w1.warehouse_name AS warehouse_a, w2.warehouse_name AS warehouse_b, l.location_name
FROM warehouses AS w1
JOIN warehouses AS w2 ON w1.location_id = w2.location_id AND w1.warehouse_id < w2.warehouse_id
JOIN locations l ON l.location_id = w1.location_id;`],
    { algebra: "σ W1.location_id = W2.location_id ∧ W1.id < W2.id (ρ W1(warehouses) × ρ W2(warehouses))" }),
  D(1, "algebra", "ra-join", "Natural join ⋈ and theta join",
    "Natural join matches equal values of common attributes (camp_id). Theta join uses any comparison: here requests whose need_by falls within 2 days of the disaster start.",
    [`SELECT rr.request_id, c.camp_name, rr.status
FROM resource_requests rr NATURAL JOIN (SELECT camp_id, camp_name FROM relief_camps) c ORDER BY 1;`,
     `SELECT rr.request_id, d.disaster_name, rr.need_by - d.started_at AS response_window
FROM resource_requests rr JOIN disasters d
  ON rr.disaster_id = d.disaster_id AND rr.need_by <= d.started_at + interval '20 days'
ORDER BY response_window;`],
    { algebra: "resource_requests ⋈ relief_camps ;  R ⋈θ S where θ: need_by ≤ started_at + 20d" }),
  D(1, "algebra", "ra-outer", "Left outer join ⟕",
    "Keeps every warehouse even if it holds no stock (NULLs fill the missing side).",
    [`SELECT w.warehouse_name, count(i.resource_id) AS stocked_resources
FROM warehouses w LEFT JOIN inventory i ON i.warehouse_id = w.warehouse_id AND i.quantity_available > 0
GROUP BY w.warehouse_name ORDER BY 2, 1;`], { algebra: "warehouses ⟕ σ qty>0 (inventory)" }),
  D(1, "algebra", "ra-division", "Division ÷",
    "Which warehouses stock EVERY resource of the MEDICAL category? Division answers 'for all' questions. SQL has no ÷, so we use double negation: there is no medical resource that the warehouse does not stock.",
    [`SELECT w.warehouse_name
FROM warehouses w
WHERE NOT EXISTS (
  SELECT 1 FROM resources r JOIN resource_categories c USING (category_id)
  WHERE c.category_name = 'MEDICAL'
    AND NOT EXISTS (SELECT 1 FROM inventory i
                    WHERE i.warehouse_id = w.warehouse_id AND i.resource_id = r.resource_id AND i.quantity_available > 0));`,
     `-- Same question with grouping: count matches must equal the divisor size
SELECT w.warehouse_name, count(*) AS medical_lines,
       (SELECT count(*) FROM resources JOIN resource_categories USING (category_id) WHERE category_name = 'MEDICAL') AS medical_resources
FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id) JOIN resource_categories c USING (category_id)
WHERE c.category_name = 'MEDICAL' AND i.quantity_available > 0
GROUP BY w.warehouse_name ORDER BY 2 DESC;`],
    { algebra: "π warehouse_id,resource_id (σ qty>0 (inventory)) ÷ π resource_id (σ category='MEDICAL' (resources ⋈ categories))" }),

  // ------------------------------------------------------------- UNIT 1: aggregation
  D(1, "aggregation", "agg-basic", "COUNT · SUM · AVG · MIN · MAX",
    "Aggregate functions collapse many rows into one value per group.",
    [`SELECT c.category_name, count(*) AS stock_lines, sum(i.quantity_available) AS total_units,
       round(avg(i.quantity_available), 1) AS avg_per_line, min(i.quantity_available) AS min_line, max(i.quantity_available) AS max_line
FROM inventory i JOIN resources r USING (resource_id) JOIN resource_categories c USING (category_id)
GROUP BY c.category_name ORDER BY total_units DESC;`], { algebra: "category_name γ count(*), sum(qty), avg(qty) (inventory ⋈ resources ⋈ categories)" }),
  D(1, "aggregation", "group-having", "GROUP BY with HAVING",
    "WHERE filters rows before grouping; HAVING filters groups after aggregation. Camps that raised more than one request:",
    [`SELECT c.camp_name, count(*) AS requests, sum(CASE WHEN rr.medical_emergency THEN 1 ELSE 0 END) AS medical
FROM resource_requests rr JOIN relief_camps c USING (camp_id)
WHERE rr.status <> 'REJECTED'
GROUP BY c.camp_name
HAVING count(*) > 1
ORDER BY requests DESC;`]),

  // ------------------------------------------------------------- UNIT 2
  D(2, "modification", "insert-select", "INSERT … SELECT",
    "Insert the result of a query: create zero-stock inventory lines for every resource a warehouse does not yet carry.",
    [`INSERT INTO inventory(warehouse_id, resource_id, quantity_available, minimum_threshold)
SELECT w.warehouse_id, r.resource_id, 0, 0
FROM warehouses w CROSS JOIN resources r
WHERE w.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.warehouse_id = w.warehouse_id AND i.resource_id = r.resource_id)
RETURNING warehouse_id, resource_id;`]),
  D(2, "modification", "update-from", "UPDATE … FROM (join update)",
    "Raise the low-stock threshold of perishable resources by 20% using a join in the UPDATE.",
    [`UPDATE inventory i SET minimum_threshold = round(i.minimum_threshold * 1.2, 3)
FROM resources r
WHERE r.resource_id = i.resource_id AND r.is_perishable
RETURNING i.warehouse_id, r.resource_name, i.minimum_threshold;`]),
  D(2, "modification", "delete-subquery", "DELETE with a subquery",
    "Delete inventory lines that are empty and were never used in an allocation (the FK from allocation_items would otherwise block the delete).",
    [`DELETE FROM inventory i
WHERE i.quantity_available = 0
  AND NOT EXISTS (SELECT 1 FROM allocation_items ai WHERE ai.warehouse_id = i.warehouse_id AND ai.resource_id = i.resource_id)
RETURNING warehouse_id, resource_id;`]),
  D(2, "modification", "upsert", "UPSERT (INSERT … ON CONFLICT DO UPDATE)",
    "Receive a donation: insert the stock line if it is new, otherwise add to it — atomically, using the composite primary key as the conflict target. The inventory_history trigger records the movement.",
    [`SELECT set_config('reliefflow.reason', 'Donation received (lab)', true);`,
     `INSERT INTO inventory(warehouse_id, resource_id, quantity_available)
SELECT (SELECT min(warehouse_id) FROM warehouses WHERE status = 'ACTIVE'), (SELECT min(resource_id) FROM resources), 250
ON CONFLICT (warehouse_id, resource_id)
DO UPDATE SET quantity_available = inventory.quantity_available + EXCLUDED.quantity_available, last_updated = now()
RETURNING warehouse_id, resource_id, quantity_available;`,
     `SELECT movement_id, warehouse_id, resource_id, delta, reason FROM inventory_movements ORDER BY movement_id DESC LIMIT 1;`]),
  D(2, "set-ops", "union-all", "UNION vs UNION ALL",
    "UNION removes duplicates (requires a sort or hash); UNION ALL keeps them and is cheaper. Resource ids that appear in requests and in stock:",
    [`SELECT 'UNION' AS op, count(*) FROM (SELECT resource_id FROM request_items UNION SELECT resource_id FROM inventory) x
UNION ALL
SELECT 'UNION ALL', count(*) FROM (SELECT resource_id FROM request_items UNION ALL SELECT resource_id FROM inventory) y;`]),
  D(2, "set-ops", "intersect-except", "INTERSECT and EXCEPT",
    "Resources that are both requested and stocked (INTERSECT) and requested but stocked nowhere (EXCEPT) — the second is a supply gap.",
    [`SELECT r.resource_name, 'requested and stocked' AS relationship FROM resources r
WHERE r.resource_id IN (SELECT resource_id FROM request_items INTERSECT SELECT resource_id FROM inventory WHERE quantity_available > 0)
UNION ALL
SELECT r.resource_name, 'requested but NOT stocked' FROM resources r
WHERE r.resource_id IN (SELECT resource_id FROM request_items EXCEPT SELECT resource_id FROM inventory WHERE quantity_available > 0)
ORDER BY 2, 1;`]),
  D(2, "nulls", "three-valued", "Three-valued logic",
    "Comparisons with NULL yield UNKNOWN, not TRUE/FALSE. WHERE keeps only TRUE rows, which is why '= NULL' never matches.",
    [`SELECT NULL = NULL AS null_eq_null, NULL <> 1 AS null_ne_1, (NULL = 1) IS UNKNOWN AS is_unknown,
       NULL IS NULL AS is_null, TRUE OR NULL AS true_or_null, FALSE AND NULL AS false_and_null, NULL IS DISTINCT FROM 1 AS distinct_from;`,
     `SELECT count(*) FILTER (WHERE ended_at = NULL) AS eq_null_matches, count(*) FILTER (WHERE ended_at IS NULL) AS is_null_matches FROM disasters;`]),
  D(2, "nulls", "coalesce-nullif", "IS NULL · COALESCE · NULLIF",
    "COALESCE substitutes a default for NULL. NULLIF turns a value into NULL — the standard way to avoid division by zero.",
    [`SELECT location_name,
       COALESCE(latitude::text || ', ' || longitude::text, 'coordinates not recorded') AS coordinates,
       latitude IS NULL AS missing
FROM locations ORDER BY missing DESC, location_name LIMIT 10;`,
     `SELECT camp_name, current_population, capacity,
       round(100.0 * current_population / NULLIF(capacity, 0), 1) AS occupancy_pct
FROM relief_camps ORDER BY occupancy_pct DESC NULLS LAST;`]),
  D(2, "nulls", "null-aggregates", "NULLs in aggregates",
    "COUNT(*) counts rows; COUNT(column) and AVG skip NULLs; SUM over zero rows is NULL, not 0.",
    [`SELECT count(*) AS all_disasters, count(ended_at) AS with_end_date,
       count(*) - count(ended_at) AS still_open,
       (SELECT sum(quantity_available) FROM inventory WHERE false) AS sum_of_nothing,
       COALESCE((SELECT sum(quantity_available) FROM inventory WHERE false), 0) AS coalesced
FROM disasters;`]),
  D(2, "subqueries", "below-average", "Resources with stock below the average",
    "A nested (uncorrelated) subquery is evaluated once: average total stock per resource, compared with each resource's total.",
    [`SELECT r.resource_name, r.unit, sum(i.quantity_available) AS total_stock
FROM resources r JOIN inventory i USING (resource_id)
GROUP BY r.resource_name, r.unit
HAVING sum(i.quantity_available) < (SELECT avg(t) FROM (SELECT sum(quantity_available) AS t FROM inventory GROUP BY resource_id) per_resource)
ORDER BY total_stock;`]),
  D(2, "subqueries", "correlated-threshold", "Camps whose requests exceed a threshold (correlated)",
    "A correlated subquery references the outer row, so it is logically re-evaluated per camp: camps that requested more than 1,000 units in total.",
    [`SELECT c.camp_name,
       (SELECT sum(ri.quantity_requested) FROM resource_requests rr JOIN request_items ri USING (request_id)
         WHERE rr.camp_id = c.camp_id) AS units_requested
FROM relief_camps c
WHERE (SELECT COALESCE(sum(ri.quantity_requested), 0) FROM resource_requests rr JOIN request_items ri USING (request_id)
        WHERE rr.camp_id = c.camp_id) > 1000
ORDER BY units_requested DESC;`]),
  D(2, "subqueries", "holding-resource", "Warehouses holding a particular resource (IN vs EXISTS)",
    "Two equivalent formulations. EXISTS stops at the first match and handles NULLs safely; IN is often rewritten by the planner into the same semi-join.",
    [`SELECT warehouse_name FROM warehouses
WHERE warehouse_id IN (SELECT warehouse_id FROM inventory i JOIN resources r USING (resource_id)
                       WHERE r.resource_name = 'Drinking Water' AND i.quantity_available > 0);`,
     `SELECT w.warehouse_name FROM warehouses w
WHERE EXISTS (SELECT 1 FROM inventory i JOIN resources r USING (resource_id)
              WHERE i.warehouse_id = w.warehouse_id AND r.resource_name = 'Drinking Water' AND i.quantity_available > 0);`]),
  D(2, "subqueries", "high-demand", "Disasters with unusually high demand",
    "Demand per disaster compared with the average across disasters, plus ALL: disasters whose demand exceeds every other disaster's (the maximum).",
    [`WITH demand AS (
  SELECT d.disaster_id, d.disaster_name, COALESCE(sum(ri.quantity_requested), 0) AS units
  FROM disasters d LEFT JOIN resource_requests rr USING (disaster_id) LEFT JOIN request_items ri USING (request_id)
  GROUP BY d.disaster_id, d.disaster_name)
SELECT disaster_name, units, round(units / NULLIF((SELECT avg(units) FROM demand), 0), 2) AS times_average
FROM demand WHERE units > (SELECT avg(units) FROM demand) ORDER BY units DESC;`,
     `SELECT d.disaster_name FROM disasters d
WHERE (SELECT COALESCE(sum(ri.quantity_requested),0) FROM resource_requests rr JOIN request_items ri USING (request_id) WHERE rr.disaster_id = d.disaster_id)
   >= ALL (SELECT COALESCE(sum(ri.quantity_requested),0) FROM disasters x LEFT JOIN resource_requests rr USING (disaster_id) LEFT JOIN request_items ri USING (request_id) GROUP BY x.disaster_id);`]),
  D(2, "joins", "inner-left-right", "INNER vs LEFT vs RIGHT JOIN",
    "INNER keeps matches only; LEFT keeps all camps; RIGHT keeps all requests (equivalent to swapping sides of a LEFT JOIN).",
    [`SELECT 'INNER' AS join_type, count(*) FROM relief_camps c JOIN resource_requests rr ON rr.camp_id = c.camp_id
UNION ALL SELECT 'LEFT (all camps)', count(*) FROM relief_camps c LEFT JOIN resource_requests rr ON rr.camp_id = c.camp_id
UNION ALL SELECT 'RIGHT (all requests)', count(*) FROM relief_camps c RIGHT JOIN resource_requests rr ON rr.camp_id = c.camp_id;`,
     `SELECT c.camp_name, rr.request_id FROM relief_camps c LEFT JOIN resource_requests rr ON rr.camp_id = c.camp_id
WHERE rr.request_id IS NULL;`]),
  D(2, "joins", "full-outer", "FULL OUTER JOIN",
    "Compare requested vs stocked resources in one result: rows from either side survive, NULL marks the missing side.",
    [`SELECT COALESCE(d.resource_id, s.resource_id) AS resource_id, d.requested, s.stocked
FROM (SELECT resource_id, sum(quantity_requested) AS requested FROM request_items GROUP BY resource_id) d
FULL OUTER JOIN (SELECT resource_id, sum(quantity_available) AS stocked FROM inventory GROUP BY resource_id) s
  ON s.resource_id = d.resource_id
ORDER BY 1;`]),
  D(2, "joins", "cross-self", "CROSS JOIN and SELF JOIN",
    "CROSS JOIN builds a demand matrix (every camp × every medical resource). The SELF JOIN pairs requests from the same camp to spot duplicates raised within a day.",
    [`SELECT c.camp_name, r.resource_name FROM relief_camps c CROSS JOIN resources r
JOIN resource_categories rc USING (category_id) WHERE rc.category_name = 'MEDICAL' AND c.status <> 'CLOSED' ORDER BY 1, 2 LIMIT 15;`,
     `SELECT a.request_id AS request, b.request_id AS possible_duplicate, a.camp_id, b.requested_at - a.requested_at AS gap
FROM resource_requests a JOIN resource_requests b
  ON a.camp_id = b.camp_id AND a.request_id < b.request_id AND b.requested_at - a.requested_at < interval '1 day';`]),
  D(2, "views", "views-in-use", "Views used by the application",
    "Views name a query once and reuse it. ReliefFlow's API reads these views for stock alerts, fulfilment progress and dashboards.",
    [`SELECT viewname, length(definition) AS definition_chars FROM pg_views WHERE schemaname = 'public' ORDER BY 1;`,
     `SELECT * FROM v_low_stock ORDER BY quantity_available;`,
     `SELECT * FROM v_request_fulfillment ORDER BY quantity_remaining DESC LIMIT 10;`,
     `SELECT * FROM v_warehouse_inventory_summary ORDER BY units_available DESC;`,
     `SELECT disaster_name, severity, affected_population, open_requests, units_allocated FROM v_disaster_response_summary ORDER BY affected_population DESC;`]),
  D(2, "views", "view-definition", "A view is a stored query (rewrite)",
    "Selecting from a view is rewritten into its definition. pg_get_viewdef shows the stored SELECT for v_resource_demand.",
    [`SELECT pg_get_viewdef('v_resource_demand'::regclass, true) AS definition;`,
     `SELECT resource_name, outstanding_demand, available_stock, net_position FROM v_resource_demand ORDER BY net_position;`]),
  D(2, "triggers", "trigger-catalog", "Triggers defined in ReliefFlow",
    "Every trigger with its timing and events. Note BEFORE triggers validate; AFTER triggers record side-effects.",
    [`SELECT event_object_table AS table_name, trigger_name, action_timing AS timing,
       string_agg(event_manipulation, ', ' ORDER BY event_manipulation) AS events,
       regexp_replace(action_statement, 'EXECUTE FUNCTION ', '') AS function
FROM information_schema.triggers WHERE trigger_schema = 'public'
GROUP BY 1, 2, 3, 5 ORDER BY 1, 2;`]),
  D(2, "triggers", "trigger-deduction", "Automatic stock deduction & movement history",
    "Inserting an allocation line fires: (1) validate_allocation_item (locks and checks stock/demand), (2) adjust_inventory_for_allocation (deducts stock), (3) inventory_history (records the movement). No application code touches inventory.",
    [`CREATE TEMP TABLE ctx AS
SELECT ri.request_id, ri.resource_id, i.warehouse_id, LEAST(i.quantity_available, f.quantity_remaining, 5) AS qty
FROM request_items ri
JOIN v_request_fulfillment f USING (request_id, resource_id)
JOIN inventory i ON i.resource_id = ri.resource_id
JOIN warehouses w ON w.warehouse_id = i.warehouse_id AND w.status = 'ACTIVE'
JOIN resource_requests rr ON rr.request_id = ri.request_id
WHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED') AND i.quantity_available >= 1 AND f.quantity_remaining >= 1
ORDER BY rr.priority_score DESC LIMIT 1;`,
     `UPDATE resource_requests SET status = 'APPROVED' WHERE request_id = (SELECT request_id FROM ctx) AND status = 'PENDING' RETURNING request_id, status;`,
     `SELECT 'before' AS moment, i.quantity_available FROM inventory i JOIN ctx USING (warehouse_id, resource_id);`,
     `INSERT INTO allocations(request_id, allocated_by) SELECT request_id, (SELECT min(user_id) FROM app_users) FROM ctx RETURNING allocation_id;`,
     `SELECT set_config('reliefflow.reason', 'Lab allocation', true);`,
     `INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT (SELECT max(allocation_id) FROM allocations), request_id, resource_id, warehouse_id, qty FROM ctx RETURNING *;`,
     `SELECT 'after' AS moment, i.quantity_available FROM inventory i JOIN ctx USING (warehouse_id, resource_id);`,
     `SELECT movement_id, delta, reason, created_at FROM inventory_movements ORDER BY movement_id DESC LIMIT 1;`]),
  D(2, "triggers", "trigger-validation", "Validation triggers reject invalid allocations",
    "Allocating more than the stock, or editing a historical allocation line, is refused by triggers even when the statement comes straight from SQL.",
    [`SAVEPOINT s;`,
     `INSERT INTO allocations(request_id, allocated_by)
SELECT request_id, (SELECT min(user_id) FROM app_users) FROM resource_requests WHERE status IN ('APPROVED','PARTIALLY_FULFILLED') LIMIT 1 RETURNING allocation_id, request_id;`,
     `INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT a.allocation_id, a.request_id, ri.resource_id, i.warehouse_id, i.quantity_available + 1000000
FROM allocations a JOIN request_items ri USING (request_id) JOIN inventory i ON i.resource_id = ri.resource_id
WHERE a.allocation_id = (SELECT max(allocation_id) FROM allocations) LIMIT 1;`,
     `ROLLBACK TO SAVEPOINT s;`,
     `UPDATE allocation_items SET quantity_allocated = quantity_allocated + 1 WHERE allocation_item_id = (SELECT min(allocation_item_id) FROM allocation_items);`,
     `ROLLBACK TO SAVEPOINT s;`,
     `UPDATE deliveries SET status = 'PLANNED' WHERE delivery_id = (SELECT min(delivery_id) FROM deliveries WHERE status = 'DELIVERED');`]),
  D(2, "triggers", "trigger-audit", "Row-level audit trigger",
    "log_row_change() writes a JSON diff of every change to data_change_log, including who made it (from the reliefflow.user_id session setting the API sets per transaction).",
    [`SELECT set_config('reliefflow.user_id', (SELECT min(user_id)::text FROM app_users), true);`,
     `UPDATE relief_camps SET current_population = current_population + 1
WHERE camp_id = (SELECT min(camp_id) FROM relief_camps WHERE status = 'OPEN' AND current_population + 1 < capacity)
RETURNING camp_id, current_population;`,
     `SELECT change_id, table_name, operation, changed_fields, changed_by FROM data_change_log ORDER BY change_id DESC LIMIT 1;`]),
  D(2, "routines", "functions", "Stored functions",
    "SQL functions used by the API and reports: remaining quantity per request line, total availability, fulfilment percentage, and a set-returning summary.",
    [`SELECT rr.request_id, r.resource_name, ri.quantity_requested,
       remaining_request_quantity(ri.request_id, ri.resource_id) AS remaining,
       resource_availability(ri.resource_id) AS available_everywhere,
       request_fulfillment_pct(rr.request_id) AS request_fulfilment_pct
FROM request_items ri JOIN resource_requests rr USING (request_id) JOIN resources r USING (resource_id)
ORDER BY rr.request_id LIMIT 12;`,
     `SELECT * FROM operational_summary();`]),
  D(2, "routines", "procedure", "Stored procedure: refresh_request_status",
    "A PROCEDURE (invoked with CALL) is the single source of truth for a request's derived status after allocations, cancellations and deliveries. Its source is read from the catalog.",
    [`SELECT pg_get_functiondef('refresh_request_status'::regproc) AS source;`,
     `DO $$ DECLARE r BIGINT; BEGIN SELECT min(request_id) INTO r FROM resource_requests; CALL refresh_request_status(r); END $$;`,
     `SELECT request_id, status FROM resource_requests WHERE request_id = (SELECT min(request_id) FROM resource_requests);`]),
  D(2, "cte", "cte-basic", "Basic and chained CTEs",
    "WITH names intermediate results. Several CTEs can build on each other — here demand, supply and their comparison.",
    [`WITH demand AS (
  SELECT resource_id, sum(quantity_remaining) AS outstanding FROM v_request_fulfillment GROUP BY resource_id
), supply AS (
  SELECT resource_id, sum(quantity_available) AS available FROM inventory GROUP BY resource_id
), position AS (
  SELECT r.resource_name, COALESCE(d.outstanding,0) AS outstanding, COALESCE(s.available,0) AS available
  FROM resources r LEFT JOIN demand d USING (resource_id) LEFT JOIN supply s USING (resource_id)
)
SELECT *, available - outstanding AS net, CASE WHEN available < outstanding THEN 'SHORTAGE' ELSE 'OK' END AS status
FROM position ORDER BY net;`]),
  D(2, "cte", "cte-recursive-depletion", "Recursive CTE: days until stock runs out",
    "Recursion iterates day by day, subtracting a daily consumption estimate (sheltered population ÷ 5 units/day) until stock is exhausted or 30 days pass.",
    [`WITH RECURSIVE burn(day, remaining, daily) AS (
  SELECT 0, (SELECT sum(quantity_available) FROM inventory i JOIN resources r USING (resource_id) WHERE r.resource_name = 'Drinking Water'),
         GREATEST((SELECT sum(current_population) FROM relief_camps WHERE status <> 'CLOSED') / 5.0, 1)
  UNION ALL
  SELECT day + 1, remaining - daily, daily FROM burn WHERE remaining - daily > 0 AND day < 30
)
SELECT day, round(remaining, 1) AS litres_left, round(daily, 1) AS litres_per_day FROM burn ORDER BY day;`]),
  D(2, "cte", "cte-recursive-graph", "Recursive CTE: transitively related disasters",
    "Two disasters are related if they affect a common location; recursion follows that relation transitively (graph reachability over disaster_locations).",
    [`WITH RECURSIVE pairs AS (
  SELECT DISTINCT a.disaster_id AS d1, b.disaster_id AS d2
  FROM disaster_locations a JOIN disaster_locations b ON a.location_id = b.location_id AND a.disaster_id <> b.disaster_id
), reach(origin, reached, path) AS (
  SELECT d.disaster_id, d.disaster_id, ARRAY[d.disaster_id] FROM disasters d
  UNION
  SELECT r.origin, p.d2, r.path || p.d2 FROM reach r JOIN pairs p ON p.d1 = r.reached WHERE NOT p.d2 = ANY(r.path)
)
SELECT d.disaster_name AS disaster, count(DISTINCT reached) - 1 AS related_disasters, max(array_length(path, 1)) - 1 AS max_hops
FROM reach JOIN disasters d ON d.disaster_id = reach.origin GROUP BY d.disaster_name ORDER BY 2 DESC, 1;`]),
  D(2, "windows", "ranking", "ROW_NUMBER · RANK · DENSE_RANK",
    "Ranking requests by priority score. RANK leaves gaps after ties, DENSE_RANK does not, ROW_NUMBER is always unique.",
    [`SELECT request_id, priority_level, priority_score,
       ROW_NUMBER() OVER (ORDER BY priority_score DESC) AS row_number,
       RANK()       OVER (ORDER BY priority_score DESC) AS rank,
       DENSE_RANK() OVER (ORDER BY priority_score DESC) AS dense_rank
FROM resource_requests ORDER BY priority_score DESC;`]),
  D(2, "windows", "partition", "PARTITION BY: top resources per warehouse",
    "Window functions keep every row while computing over a partition. Top 2 stock lines in each warehouse and each line's share of the warehouse total.",
    [`SELECT * FROM (
  SELECT w.warehouse_name, r.resource_name, i.quantity_available,
         ROW_NUMBER() OVER (PARTITION BY w.warehouse_id ORDER BY i.quantity_available DESC) AS position,
         round(100 * i.quantity_available / NULLIF(SUM(i.quantity_available) OVER (PARTITION BY w.warehouse_id), 0), 1) AS pct_of_warehouse,
         round(AVG(i.quantity_available) OVER (PARTITION BY w.warehouse_id), 1) AS warehouse_avg
  FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
) t WHERE position <= 2 ORDER BY warehouse_name, position;`]),
  D(2, "windows", "lag-lead-running", "LAG · LEAD · running SUM",
    "Stock movement history: previous/next movement for the same stock line and a running balance per line.",
    [`SELECT m.movement_id, w.warehouse_name, r.resource_name, m.delta,
       LAG(m.delta)  OVER line AS previous_delta,
       LEAD(m.delta) OVER line AS next_delta,
       SUM(m.delta)  OVER (line ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
FROM inventory_movements m JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
WINDOW line AS (PARTITION BY m.warehouse_id, m.resource_id ORDER BY m.created_at, m.movement_id)
ORDER BY w.warehouse_name, r.resource_name, m.created_at LIMIT 30;`]),
  D(2, "windows", "window-vs-group", "Window functions vs GROUP BY",
    "GROUP BY returns one row per group; a window aggregate returns every input row annotated with the group value.",
    [`SELECT priority_level, count(*) AS requests FROM resource_requests GROUP BY priority_level ORDER BY 1;`,
     `SELECT request_id, priority_level, count(*) OVER (PARTITION BY priority_level) AS requests_in_level FROM resource_requests ORDER BY priority_level, request_id;`]),
  D(2, "fts", "fulltext", "Full-text search with ranking",
    "A generated tsvector column (weighted name > type > description) with a GIN index. websearch_to_tsquery understands quotes, OR and -exclusions; ts_headline highlights matches.",
    [`SELECT disaster_name, ts_rank(search_vector, q) AS rank,
       ts_headline('english', coalesce(description, ''), q, 'MaxWords=18, MinWords=6') AS snippet
FROM disasters, websearch_to_tsquery('english', 'flood OR cyclone -drill') q
WHERE search_vector @@ q ORDER BY rank DESC;`,
     `SELECT to_tsvector('english', 'Families relocated after flooding damaged homes') AS document_vector,
       websearch_to_tsquery('english', 'flooded home') AS query;`]),
  D(2, "fts", "trigram", "Fuzzy matching with pg_trgm",
    "Trigram similarity tolerates typos — useful for field officers typing place names.",
    [`SELECT location_name, round(similarity(location_name, 'Guwhati Metr')::numeric, 3) AS similarity
FROM locations WHERE location_name % 'Guwhati Metr' OR similarity(location_name, 'Guwhati Metr') > 0.2
ORDER BY similarity DESC LIMIT 5;`]),

  // ------------------------------------------------------------- UNIT 3
  D(3, "processing", "view-rewrite", "Rewriting: a view is expanded into base tables",
    "The rewriter replaces v_low_stock with its definition before planning; the plan only mentions base tables.",
    [`EXPLAIN (VERBOSE, COSTS OFF) SELECT * FROM v_low_stock WHERE warehouse_name LIKE 'Central%';`]),
  D(3, "processing", "parse-error", "Parsing and validation errors",
    "Syntax errors are caught by the parser; unknown tables/columns by semantic analysis — both before any data is touched.",
    [`SAVEPOINT s;`, `SELEC * FROM disasters;`, `ROLLBACK TO SAVEPOINT s;`, `SELECT no_such_column FROM disasters;`, `ROLLBACK TO SAVEPOINT s;`, `SELECT * FROM no_such_table;`]),
  D(3, "processing", "plan-tree", "Plan tree, costs and execution",
    "EXPLAIN ANALYZE plans AND executes the query, reporting estimated cost vs actual rows/time per node.",
    [`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT c.camp_name, count(*) AS requests, sum(ri.quantity_requested) AS units
FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN request_items ri USING (request_id)
GROUP BY c.camp_name ORDER BY units DESC;`], { plan: true }),
  D(3, "optimization", "seq-vs-index", "Sequential scan → index scan (measured)",
    "Same query before and after creating an index on bench_movements(resource_id, created_at). Timings are measured on this server, not estimated.",
    [`SELECT count(*) AS rows_in_table FROM bench_movements;`,
     `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT movement_id, delta, created_at FROM bench_movements
WHERE resource_id = 7 AND created_at >= timestamptz '2026-06-01';`,
     `CREATE INDEX bench_mv_resource_created ON bench_movements(resource_id, created_at);`,
     `ANALYZE bench_movements;`,
     `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT movement_id, delta, created_at FROM bench_movements
WHERE resource_id = 7 AND created_at >= timestamptz '2026-06-01';`], { plan: true }),
  D(3, "optimization", "index-only", "Index-only scan with a covering composite index",
    "bench_mv_wh_created(warehouse_id, created_at) contains every column the query needs, and VACUUM has set the visibility map, so the heap is never read (Heap Fetches: 0).",
    [`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT warehouse_id, created_at FROM bench_movements
WHERE warehouse_id = 12 AND created_at BETWEEN timestamptz '2025-06-01' AND timestamptz '2025-07-01';`], { plan: true }),
  D(3, "optimization", "composite-order", "Composite index column order",
    "An index on (warehouse_id, created_at) is efficient when the leading column is constrained. Filtering on created_at alone cannot seek into it.",
    [`EXPLAIN (ANALYZE, FORMAT JSON)
SELECT count(*) FROM bench_movements WHERE warehouse_id = 5 AND created_at >= timestamptz '2026-01-01';`,
     `EXPLAIN (ANALYZE, FORMAT JSON)
SELECT count(*) FROM bench_movements WHERE created_at >= timestamptz '2026-08-01';`], { plan: true }),
  D(3, "optimization", "sargable", "Poorly written vs improved predicate",
    "Wrapping the indexed column in a function (date_trunc) hides it from the index. The equivalent range predicate is sargable and uses the index.",
    [`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM bench_movements WHERE warehouse_id = 9 AND date_trunc('month', created_at) = timestamptz '2025-09-01';`,
     `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*) FROM bench_movements WHERE warehouse_id = 9
  AND created_at >= timestamptz '2025-09-01' AND created_at < timestamptz '2025-10-01';`], { plan: true }),
  D(3, "optimization", "join-strategies", "Join strategies: hash, merge and nested loop",
    "The planner picks a join algorithm by cost (here: hash join). Disabling planner options with SET LOCAL (this transaction only) forces a merge join, then a nested loop, so their estimated costs and measured times can be compared.",
    [`EXPLAIN (ANALYZE, FORMAT JSON)
SELECT w.region, count(*) FROM bench_requests r JOIN bench_warehouses w USING (warehouse_id) GROUP BY w.region;`,
     `SET LOCAL enable_hashjoin = off;`,
     `SET LOCAL enable_nestloop = off;`,
     `EXPLAIN (ANALYZE, FORMAT JSON)
SELECT w.region, count(*) FROM bench_requests r JOIN bench_warehouses w USING (warehouse_id) GROUP BY w.region;`,
     `SET LOCAL enable_nestloop = on;`,
     `SET LOCAL enable_mergejoin = off;`,
     `EXPLAIN (ANALYZE, FORMAT JSON)
SELECT w.region, count(*) FROM bench_requests r JOIN bench_warehouses w USING (warehouse_id) GROUP BY w.region;`], { plan: true }),
  D(3, "optimization", "statistics", "Planner statistics",
    "The optimiser estimates selectivity from pg_stats (distinct values, most common values, correlation).",
    [`SELECT attname, n_distinct, most_common_vals::text AS most_common, correlation
FROM pg_stats WHERE schemaname = 'sandbox' AND tablename = 'bench_requests' ORDER BY attname;`]),
  D(3, "normalization", "anomalies", "Insertion, update and deletion anomalies",
    "request_flat repeats camp and resource facts on every request line (FDs camp_name → capacity and resource_name → unit). Updating one copy creates contradictions; deleting the last line loses facts; a camp without requests cannot be stored.",
    [`CREATE TABLE request_flat AS
SELECT rr.request_id, c.camp_name, c.capacity AS camp_capacity, r.resource_name, r.unit, ri.quantity_requested
FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN request_items ri USING (request_id) JOIN resources r USING (resource_id);`,
     `ALTER TABLE request_flat ADD PRIMARY KEY (request_id, resource_name);`,
     `-- UPDATE anomaly: change capacity on one row only
UPDATE request_flat SET camp_capacity = camp_capacity + 100
WHERE ctid = (SELECT ctid FROM request_flat WHERE camp_name IN (SELECT camp_name FROM request_flat GROUP BY camp_name HAVING count(*) > 1) LIMIT 1);`,
     `SELECT camp_name, array_agg(DISTINCT camp_capacity) AS conflicting_capacities FROM request_flat GROUP BY camp_name HAVING count(DISTINCT camp_capacity) > 1;`,
     `-- INSERTION anomaly: a new camp with no request cannot be recorded (key needs request_id)
INSERT INTO request_flat(camp_name, camp_capacity) VALUES ('New Camp Without Requests', 300);`]),
  D(3, "normalization", "decomposition", "Lossless decomposition, verified with EXCEPT",
    "Decompose request_flat into CAMP(camp_name, capacity), RESOURCE(resource_name, unit) and LINE(request_id, camp_name, resource_name, qty). Joining them back and comparing with EXCEPT in both directions returns zero rows: the decomposition is lossless.",
    [`CREATE TABLE request_flat AS
SELECT rr.request_id, c.camp_name, c.capacity AS camp_capacity, r.resource_name, r.unit, ri.quantity_requested
FROM resource_requests rr JOIN relief_camps c USING (camp_id) JOIN request_items ri USING (request_id) JOIN resources r USING (resource_id);`,
     `CREATE TABLE camp_nf AS SELECT DISTINCT camp_name, camp_capacity FROM request_flat;`,
     `CREATE TABLE resource_nf AS SELECT DISTINCT resource_name, unit FROM request_flat;`,
     `CREATE TABLE line_nf AS SELECT request_id, camp_name, resource_name, quantity_requested FROM request_flat;`,
     `SELECT (SELECT count(*) FROM request_flat) AS original_rows,
       (SELECT count(*) FROM (SELECT * FROM request_flat EXCEPT
          SELECT l.request_id, l.camp_name, c.camp_capacity, l.resource_name, r.unit, l.quantity_requested
          FROM line_nf l JOIN camp_nf c USING (camp_name) JOIN resource_nf r USING (resource_name)) x) AS lost_tuples,
       (SELECT count(*) FROM (SELECT l.request_id, l.camp_name, c.camp_capacity, l.resource_name, r.unit, l.quantity_requested
          FROM line_nf l JOIN camp_nf c USING (camp_name) JOIN resource_nf r USING (resource_name)
          EXCEPT SELECT * FROM request_flat) y) AS spurious_tuples;`]),
  D(3, "normalization", "fourth-nf", "4NF: independent multivalued facts",
    "camp_support(camp, resource, skill) stores two independent multi-valued facts (camp →→ resource, camp →→ skill), so every resource is repeated for every skill. Decomposing into two relations removes the redundancy without losing information.",
    [`CREATE TABLE camp_support AS
SELECT c.camp_name, r.resource_name, s.skill
FROM (SELECT DISTINCT camp_id, resource_id FROM resource_requests JOIN request_items USING (request_id)) cr
JOIN relief_camps c USING (camp_id) JOIN resources r USING (resource_id)
CROSS JOIN (VALUES ('First aid'), ('Boat handling'), ('Logistics')) s(skill);`,
     `SELECT count(*) AS rows_unnormalised,
       (SELECT count(*) FROM (SELECT DISTINCT camp_name, resource_name FROM camp_support) a)
     + (SELECT count(*) FROM (SELECT DISTINCT camp_name, skill FROM camp_support) b) AS rows_after_4nf
FROM camp_support;`,
     `SELECT count(*) AS lost_or_spurious FROM (
  (SELECT * FROM camp_support EXCEPT
   SELECT a.camp_name, a.resource_name, b.skill FROM (SELECT DISTINCT camp_name, resource_name FROM camp_support) a
   JOIN (SELECT DISTINCT camp_name, skill FROM camp_support) b USING (camp_name))
  UNION ALL
  (SELECT a.camp_name, a.resource_name, b.skill FROM (SELECT DISTINCT camp_name, resource_name FROM camp_support) a
   JOIN (SELECT DISTINCT camp_name, skill FROM camp_support) b USING (camp_name) EXCEPT SELECT * FROM camp_support)) x;`]),
  D(3, "normalization", "fifth-nf", "5NF: join dependency (warehouse, resource, vehicle type)",
    "Rule: a warehouse ships a resource on a vehicle type only if the warehouse stocks the resource, the warehouse operates that vehicle type, and the resource may travel on it. Two projections joined give SPURIOUS tuples; all three projections reconstruct the relation exactly — a join dependency that 5NF decomposition captures.",
    [`CREATE TABLE stocks(w text, r text);`,
     `INSERT INTO stocks VALUES ('Depot A','Water'),('Depot A','Insulin'),('Depot B','Water');`,
     `CREATE TABLE operates(w text, v text);`,
     `INSERT INTO operates VALUES ('Depot A','Truck'),('Depot A','Cold Van'),('Depot B','Truck');`,
     `CREATE TABLE travels(r text, v text);`,
     `INSERT INTO travels VALUES ('Water','Truck'),('Insulin','Cold Van'),('Water','Cold Van');`,
     `CREATE TABLE ships AS SELECT s.w, s.r, o.v FROM stocks s JOIN operates o USING (w) JOIN travels t ON t.r = s.r AND t.v = o.v;`,
     `SELECT * FROM ships ORDER BY 1, 2, 3;`,
     `SELECT 'two projections (WR ⋈ WV)' AS reconstruction, count(*) AS rows,
       (SELECT count(*) FROM (SELECT a.w, a.r, b.v FROM (SELECT DISTINCT w, r FROM ships) a JOIN (SELECT DISTINCT w, v FROM ships) b USING (w) EXCEPT SELECT * FROM ships) x) AS spurious
FROM (SELECT DISTINCT w, r FROM ships) a JOIN (SELECT DISTINCT w, v FROM ships) b USING (w)
UNION ALL
SELECT 'three projections (WR ⋈ WV ⋈ RV)', count(*),
       (SELECT count(*) FROM (SELECT a.w, a.r, b.v FROM (SELECT DISTINCT w, r FROM ships) a JOIN (SELECT DISTINCT w, v FROM ships) b USING (w)
         JOIN (SELECT DISTINCT r, v FROM ships) c ON c.r = a.r AND c.v = b.v EXCEPT SELECT * FROM ships) y)
FROM (SELECT DISTINCT w, r FROM ships) a JOIN (SELECT DISTINCT w, v FROM ships) b USING (w)
JOIN (SELECT DISTINCT r, v FROM ships) c ON c.r = a.r AND c.v = b.v;`]),

  // ------------------------------------------------------------- UNIT 4
  D(4, "transactions", "atomic-allocation", "Atomicity: allocation fails halfway → nothing persists",
    "A two-line allocation: line 1 is valid and deducts stock; line 2 asks for more than exists and the trigger raises an error. The transaction is aborted — and after ROLLBACK, line 1's deduction is gone too.",
    [`CREATE TEMP TABLE ctx AS
SELECT rr.request_id FROM resource_requests rr
WHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')
  AND EXISTS (SELECT 1 FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id WHERE f.request_id = rr.request_id AND f.quantity_remaining >= 1 AND i.quantity_available >= 1)
ORDER BY rr.priority_score DESC LIMIT 1;`,
     `UPDATE resource_requests SET status = 'APPROVED' WHERE request_id = (SELECT request_id FROM ctx) AND status = 'PENDING';`,
     `SELECT sum(quantity_available) AS total_stock_before FROM inventory;`,
     `SAVEPOINT allocation_attempt;`,
     `INSERT INTO allocations(request_id, allocated_by) SELECT request_id, (SELECT min(user_id) FROM app_users) FROM ctx RETURNING allocation_id;`,
     `INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT (SELECT max(allocation_id) FROM allocations), f.request_id, f.resource_id, i.warehouse_id, 1
FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id JOIN warehouses w ON w.warehouse_id = i.warehouse_id AND w.status = 'ACTIVE'
WHERE f.request_id = (SELECT request_id FROM ctx) AND f.quantity_remaining >= 1 AND i.quantity_available >= 1 LIMIT 1 RETURNING 'line 1 OK' AS line, quantity_allocated;`,
     `SELECT sum(quantity_available) AS total_stock_after_line_1 FROM inventory;`,
     `INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT (SELECT max(allocation_id) FROM allocations), f.request_id, f.resource_id, i.warehouse_id, i.quantity_available + 99999
FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id
WHERE f.request_id = (SELECT request_id FROM ctx) AND NOT EXISTS (SELECT 1 FROM allocation_items x WHERE x.allocation_id = (SELECT max(allocation_id) FROM allocations) AND x.resource_id = f.resource_id AND x.warehouse_id = i.warehouse_id) LIMIT 1;`,
     `SELECT 'any statement now fails: transaction is aborted' AS note;`,
     `ROLLBACK TO SAVEPOINT allocation_attempt;`,
     `SELECT sum(quantity_available) AS total_stock_after_rollback FROM inventory;`]),
  D(4, "transactions", "savepoints", "SAVEPOINT: keep part of the work",
    "Savepoints mark points inside a transaction. Rolling back to one undoes only the later work — here the second donation is undone but the first remains (until the sandbox's final rollback).",
    [`CREATE TEMP TABLE donations(item text, qty int CHECK (qty > 0));`,
     `INSERT INTO donations VALUES ('Blanket', 100);`,
     `SAVEPOINT after_first;`,
     `INSERT INTO donations VALUES ('Rice', 500);`,
     `SELECT * FROM donations;`,
     `ROLLBACK TO SAVEPOINT after_first;`,
     `SELECT * FROM donations;`,
     `RELEASE SAVEPOINT after_first;`]),
  D(4, "transactions", "consistency", "Consistency: constraints hold at every commit",
    "A transaction moves the database from one valid state to another. A DEFERRABLE check is evaluated at the end of the transaction instead of per statement.",
    [`CREATE TEMP TABLE ledger(entry int PRIMARY KEY, warehouse text, delta int);`,
     `CREATE TEMP TABLE ledger_link(a int REFERENCES ledger DEFERRABLE INITIALLY DEFERRED, b int);`,
     `INSERT INTO ledger_link VALUES (1, 2);`,
     `SELECT 'FK not yet satisfied, but deferred — no error yet' AS note;`,
     `INSERT INTO ledger VALUES (1, 'Depot A', -50);`,
     `SET CONSTRAINTS ALL IMMEDIATE;`,
     `SELECT 'all constraints satisfied at the commit point' AS note;`]),
  D(4, "transactions", "durability", "Durability: the write-ahead log",
    "Committed changes are first written to the WAL and flushed (synchronous_commit) before COMMIT returns; the LSN advances as changes are logged.",
    [`SELECT pg_current_wal_insert_lsn() AS wal_position_before;`,
     `INSERT INTO sandbox.demo_stock(item, qty) VALUES ('WAL probe', 1);`,
     `SELECT pg_current_wal_insert_lsn() AS wal_position_after;`,
     `SELECT name, setting FROM pg_settings WHERE name IN ('synchronous_commit', 'fsync', 'wal_level');`]),
];

export function findDemo(id: string) {
  return demos.find((d) => d.id === id);
}
export function catalog(unit?: number) {
  return demos
    .filter((d) => !unit || d.unit === unit)
    .map(({ id, unit, section, title, explain, algebra, steps, plan }) => ({ id, unit, section, title, explain, algebra, steps, plan: Boolean(plan) }));
}
