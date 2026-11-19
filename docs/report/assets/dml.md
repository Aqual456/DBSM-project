### INSERT · UPDATE · DELETE (with RETURNING)

DML changes data. RETURNING shows the affected rows without a second query. The sandbox rolls everything back afterwards.

```sql
INSERT INTO locations(location_name, location_type, address, latitude, longitude)
VALUES ('Lab Test Ward', 'WARD', 'Sandbox only', 12.90, 77.60)
RETURNING location_id, location_name;
```


| location_id | location_name |
| --- | --- |
| 24 | Lab Test Ward |

```sql
UPDATE locations SET address = 'Sandbox only (edited)'
WHERE location_name = 'Lab Test Ward'
RETURNING location_id, address;
```


| location_id | address |
| --- | --- |
| 24 | Sandbox only (edited) |

```sql
DELETE FROM locations WHERE location_name = 'Lab Test Ward' RETURNING location_id;
```


| location_id |
| --- |
| 24 |

```sql
SELECT count(*) AS remaining_lab_rows FROM locations WHERE location_name = 'Lab Test Ward';
```


| remaining_lab_rows |
| --- |
| 0 |

_All statements above ran in the lab sandbox inside one transaction that was rolled back._

### UPSERT (INSERT … ON CONFLICT DO UPDATE)

Receive a donation: insert the stock line if it is new, otherwise add to it — atomically, using the composite primary key as the conflict target. The inventory_history trigger records the movement.

```sql
SELECT set_config('reliefflow.reason', 'Donation received (lab)', true);
```


| set_config |
| --- |
| Donation received (lab) |

```sql
INSERT INTO inventory(warehouse_id, resource_id, quantity_available)
SELECT (SELECT min(warehouse_id) FROM warehouses WHERE status = 'ACTIVE'), (SELECT min(resource_id) FROM resources), 250
ON CONFLICT (warehouse_id, resource_id)
DO UPDATE SET quantity_available = inventory.quantity_available + EXCLUDED.quantity_available, last_updated = now()
RETURNING warehouse_id, resource_id, quantity_available;
```


| warehouse_id | resource_id | quantity_available |
| --- | --- | --- |
| 1 | 1 | 1050.000 |

```sql
SELECT movement_id, warehouse_id, resource_id, delta, reason FROM inventory_movements ORDER BY movement_id DESC LIMIT 1;
```


| movement_id | warehouse_id | resource_id | delta | reason |
| --- | --- | --- | --- | --- |
| 44 | 1 | 1 | 250.000 | Donation received (lab) |

_All statements above ran in the lab sandbox inside one transaction that was rolled back._

### CREATE · ALTER · DROP

DDL defines structure. A table is created, altered (new column + CHECK constraint), used, and dropped — PostgreSQL DDL is transactional, so even this is rolled back.

```sql
CREATE TABLE field_teams (
  team_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_name VARCHAR(80) NOT NULL UNIQUE
);
```
→ CREATE

```sql
ALTER TABLE field_teams ADD COLUMN members INTEGER NOT NULL DEFAULT 4;
```
→ ALTER

```sql
ALTER TABLE field_teams ADD CONSTRAINT team_size CHECK (members BETWEEN 2 AND 20);
```
→ ALTER

```sql
INSERT INTO field_teams(team_name, members) VALUES ('Boat Rescue A', 6), ('Medical Unit 3', 4) RETURNING *;
```


| team_id | team_name | members |
| --- | --- | --- |
| 1 | Boat Rescue A | 6 |
| 2 | Medical Unit 3 | 4 |

```sql
SAVEPOINT before_bad_insert;
```
→ SAVEPOINT

```sql
INSERT INTO field_teams(team_name, members) VALUES ('Too Big', 50);
```
→ **ERROR 23514**: new row for relation "field_teams" violates check constraint "team_size"

```sql
ROLLBACK TO SAVEPOINT before_bad_insert;
```
→ ROLLBACK

```sql
DROP TABLE field_teams;
```
→ DROP

```sql
SELECT to_regclass('field_teams') AS table_after_drop;
```


| table_after_drop |
| --- |
| NULL |

_All statements above ran in the lab sandbox inside one transaction that was rolled back._

### Constraints rejecting bad data

Each statement violates a different constraint. The database — not the UI — is the final guard. A SAVEPOINT lets later statements run after an error.

```sql
SAVEPOINT s;
```
→ SAVEPOINT

```sql
INSERT INTO relief_camps(location_id, camp_name, capacity, current_population) VALUES ((SELECT min(location_id) FROM locations), 'Overfull', 10, 25);
```
→ **ERROR 23514**: new row for relation "relief_camps" violates check constraint "camp_status_occupancy"

```sql
ROLLBACK TO SAVEPOINT s;
```
→ ROLLBACK

```sql
INSERT INTO vehicles(vehicle_number, vehicle_type, capacity) SELECT vehicle_number, vehicle_type, capacity FROM vehicles LIMIT 1;
```
→ **ERROR 23505**: duplicate key value violates unique constraint "vehicles_vehicle_number_key"

```sql
ROLLBACK TO SAVEPOINT s;
```
→ ROLLBACK

```sql
INSERT INTO resources(category_id, resource_name, unit) VALUES (999999, 'Ghost Resource', 'unit');
```
→ **ERROR 23503**: insert or update on table "resources" violates foreign key constraint "resources_category_id_fkey"

```sql
ROLLBACK TO SAVEPOINT s;
```
→ ROLLBACK

```sql
INSERT INTO inventory(warehouse_id, resource_id, quantity_available) SELECT warehouse_id, resource_id, -5 FROM inventory LIMIT 1;
```
→ **ERROR 23514**: new row for relation "inventory" violates check constraint "inventory_quantity_available_check"

```sql
ROLLBACK TO SAVEPOINT s;
```
→ ROLLBACK

```sql
DELETE FROM resource_categories WHERE category_id = (SELECT category_id FROM resources LIMIT 1);
```
→ **ERROR 23503**: update or delete on table "resource_categories" violates foreign key constraint "resources_category_id_fkey" on table "resources"

_All statements above ran in the lab sandbox inside one transaction that was rolled back._

### Sequential scan → index scan (measured)

Same query before and after creating an index on bench_movements(resource_id, created_at). Timings are measured on this server, not estimated.

```sql
SELECT count(*) AS rows_in_table FROM bench_movements;
```


| rows_in_table |
| --- |
| 300000 |

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT movement_id, delta, created_at FROM bench_movements
WHERE resource_id = 7 AND created_at >= timestamptz '2026-06-01';
```
→ plan: **Gather → Seq Scan**, execution **15.62 ms** (measured)

```sql
CREATE INDEX bench_mv_resource_created ON bench_movements(resource_id, created_at);
```
→ CREATE

```sql
ANALYZE bench_movements;
```
→ ANALYZE

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT movement_id, delta, created_at FROM bench_movements
WHERE resource_id = 7 AND created_at >= timestamptz '2026-06-01';
```
→ plan: **Bitmap Heap Scan → Bitmap Index Scan**, execution **1.02 ms** (measured)

_All statements above ran in the lab sandbox inside one transaction that was rolled back._

### Atomicity: allocation fails halfway → nothing persists

A two-line allocation: line 1 is valid and deducts stock; line 2 asks for more than exists and the trigger raises an error. The transaction is aborted — and after ROLLBACK, line 1's deduction is gone too.

```sql
CREATE TEMP TABLE ctx AS
SELECT rr.request_id FROM resource_requests rr
WHERE rr.status IN ('PENDING','APPROVED','PARTIALLY_FULFILLED')
  AND EXISTS (SELECT 1 FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id WHERE f.request_id = rr.request_id AND f.quantity_remaining >= 1 AND i.quantity_available >= 1)
ORDER BY rr.priority_score DESC LIMIT 1;
```
→ SELECT (1 row(s))

```sql
UPDATE resource_requests SET status = 'APPROVED' WHERE request_id = (SELECT request_id FROM ctx) AND status = 'PENDING';
```
→ UPDATE (1 row(s))

```sql
SELECT sum(quantity_available) AS total_stock_before FROM inventory;
```


| total_stock_before |
| --- |
| 63460.000 |

```sql
SAVEPOINT allocation_attempt;
```
→ SAVEPOINT

```sql
INSERT INTO allocations(request_id, allocated_by) SELECT request_id, (SELECT min(user_id) FROM app_users) FROM ctx RETURNING allocation_id;
```


| allocation_id |
| --- |
| 12 |

```sql
INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT (SELECT max(allocation_id) FROM allocations), f.request_id, f.resource_id, i.warehouse_id, 1
FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id JOIN warehouses w ON w.warehouse_id = i.warehouse_id AND w.status = 'ACTIVE'
WHERE f.request_id = (SELECT request_id FROM ctx) AND f.quantity_remaining >= 1 AND i.quantity_available >= 1 LIMIT 1 RETURNING 'line 1 OK' AS line, quantity_allocated;
```


| line | quantity_allocated |
| --- | --- |
| line 1 OK | 1.000 |

```sql
SELECT sum(quantity_available) AS total_stock_after_line_1 FROM inventory;
```


| total_stock_after_line_1 |
| --- |
| 63459.000 |

```sql
INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated)
SELECT (SELECT max(allocation_id) FROM allocations), f.request_id, f.resource_id, i.warehouse_id, i.quantity_available + 99999
FROM v_request_fulfillment f JOIN inventory i ON i.resource_id = f.resource_id
WHERE f.request_id = (SELECT request_id FROM ctx) AND NOT EXISTS (SELECT 1 FROM allocation_items x WHERE x.allocation_id = (SELECT max(allocation_id) FROM allocations) AND x.resource_id = f.resource_id AND x.warehouse_id = i.warehouse_id) LIMIT 1;
```
→ **ERROR P0001**: Insufficient stock or allocation exceeds outstanding quantity

```sql
SELECT 'any statement now fails: transaction is aborted' AS note;
```
→ **ERROR 25P02**: current transaction is aborted, commands ignored until end of transaction block

```sql
ROLLBACK TO SAVEPOINT allocation_attempt;
```
→ ROLLBACK

```sql
SELECT sum(quantity_available) AS total_stock_after_rollback FROM inventory;
```


| total_stock_after_rollback |
| --- |
| 63460.000 |

_All statements above ran in the lab sandbox inside one transaction that was rolled back._
