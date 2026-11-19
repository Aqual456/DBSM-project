### Requests per camp (JOIN · GROUP BY · HAVING · ORDER BY · aggregates)

Joins three tables, aggregates per camp, keeps only camps with more than one request.

```sql
SELECT c.camp_name, count(DISTINCT rr.request_id) AS requests,
       sum(ri.quantity_requested) AS units_requested,
       round(avg(rr.priority_score), 1) AS avg_priority
FROM relief_camps c
JOIN resource_requests rr ON rr.camp_id = c.camp_id
JOIN request_items ri ON ri.request_id = rr.request_id
WHERE rr.status <> 'REJECTED'
GROUP BY c.camp_name
HAVING count(DISTINCT rr.request_id) > 1
ORDER BY units_requested DESC;
```

**Result (live database):**

| camp_name | requests | units_requested | avg_priority |
| --- | --- | --- | --- |
| Aluva Government School Camp | 2 | 6560.000 | 88.8 |
| Puri Cyclone Shelter No. 4 | 2 | 4640.000 | 94.4 |
| Joshimath Gurudwara Shelter | 2 | 1000.000 | 62.5 |
| Central Flood Relief Camp | 2 | 940.000 | 91.3 |

### Stock by category (COUNT · SUM · AVG · MIN · MAX)

Aggregate functions over inventory joined to its catalogue.

```sql
SELECT cat.category_name, count(*) AS stock_lines, sum(i.quantity_available) AS total_units,
       round(avg(i.quantity_available), 1) AS avg_units, min(i.quantity_available) AS min_units, max(i.quantity_available) AS max_units
FROM inventory i JOIN resources r USING (resource_id) JOIN resource_categories cat USING (category_id)
GROUP BY cat.category_name ORDER BY total_units DESC;
```

**Result (live database):**

| category_name | stock_lines | total_units | avg_units | min_units | max_units |
| --- | --- | --- | --- | --- | --- |
| FOOD | 8 | 26180.000 | 3272.5 | 80.000 | 9000.000 |
| WATER | 7 | 19540.000 | 2791.4 | 120.000 | 6600.000 |
| MEDICAL | 8 | 9360.000 | 1170.0 | 40.000 | 4000.000 |
| SHELTER | 9 | 6040.000 | 671.1 | 120.000 | 1400.000 |
| HYGIENE | 2 | 1600.000 | 800.0 | 700.000 | 900.000 |
| ENERGY | 2 | 740.000 | 370.0 | 90.000 | 650.000 |

### Resources whose total stock is below the average (nested subquery)

The inner query computes the average once; the outer query compares each resource with it.

```sql
SELECT r.resource_name, r.unit, sum(i.quantity_available) AS total_stock
FROM resources r JOIN inventory i USING (resource_id)
GROUP BY r.resource_name, r.unit
HAVING sum(i.quantity_available) <
       (SELECT avg(t) FROM (SELECT sum(quantity_available) AS t FROM inventory GROUP BY resource_id) x)
ORDER BY total_stock;
```

**Result (live database):**

| resource_name | unit | total_stock |
| --- | --- | --- |
| Insulin Vials | vial | 40.000 |
| Infant Formula | tin | 80.000 |
| Family Tent | unit | 240.000 |
| Solar Lantern | unit | 740.000 |
| First Aid Kit | kit | 1320.000 |
| Hygiene Kit | kit | 1600.000 |
| Tarpaulin Sheet | piece | 2300.000 |
| Water Purification Tablets | strip | 3000.000 |
| Blanket | piece | 3500.000 |

### Camps that requested more than 1,000 units (correlated subquery)

The subquery refers to the outer row (c.camp_id) and is evaluated per camp.

```sql
SELECT c.camp_name,
       (SELECT sum(ri.quantity_requested) FROM resource_requests rr JOIN request_items ri USING (request_id)
         WHERE rr.camp_id = c.camp_id) AS units_requested
FROM relief_camps c
WHERE (SELECT COALESCE(sum(ri.quantity_requested), 0) FROM resource_requests rr JOIN request_items ri USING (request_id)
        WHERE rr.camp_id = c.camp_id) > 1000
ORDER BY units_requested DESC;
```

**Result (live database):**

| camp_name | units_requested |
| --- | --- |
| Aluva Government School Camp | 6560.000 |
| Puri Cyclone Shelter No. 4 | 4640.000 |
| Guwahati Stadium Shelter | 4500.000 |
| Mysuru Cooling Centre | 2700.000 |

### Warehouses that stock every MEDICAL resource (relational division with NOT EXISTS)

Double negation: there is no medical resource that the warehouse does not stock.

```sql
SELECT w.warehouse_name
FROM warehouses w
WHERE NOT EXISTS (
  SELECT 1 FROM resources r JOIN resource_categories c USING (category_id)
  WHERE c.category_name = 'MEDICAL'
    AND NOT EXISTS (SELECT 1 FROM inventory i
                    WHERE i.warehouse_id = w.warehouse_id AND i.resource_id = r.resource_id AND i.quantity_available > 0));
```

**Result (live database):**

| warehouse_name |
| --- |
| Bhubaneswar State Warehouse |

### Days until drinking water runs out (recursive CTE)

WITH RECURSIVE: the anchor row is today's stock; each recursive step subtracts one day's consumption.

```sql
WITH RECURSIVE burn(day, remaining, daily) AS (
  SELECT 0,
         (SELECT sum(quantity_available) FROM inventory i JOIN resources r USING (resource_id) WHERE r.resource_name = 'Drinking Water'),
         GREATEST((SELECT sum(current_population) FROM relief_camps WHERE status <> 'CLOSED') / 5.0, 1)
  UNION ALL
  SELECT day + 1, remaining - daily, daily FROM burn WHERE remaining - daily > 0 AND day < 30
)
SELECT day, round(remaining, 0) AS litres_left FROM burn ORDER BY day;
```

**Result (live database):**

| day | litres_left |
| --- | --- |
| 0 | 16540 |
| 1 | 15601 |
| 2 | 14661 |
| 3 | 13722 |
| 4 | 12782 |
| 5 | 11843 |
| 6 | 10904 |
| 7 | 9964 |
| 8 | 9025 |
| 9 | 8085 |

_8 more rows not shown_

### Ranking requests by priority (window functions)

RANK / DENSE_RANK / ROW_NUMBER keep every row, unlike GROUP BY.

```sql
SELECT request_id, priority_level, priority_score,
       RANK() OVER (ORDER BY priority_score DESC) AS rank,
       DENSE_RANK() OVER (ORDER BY priority_score DESC) AS dense_rank,
       count(*) OVER (PARTITION BY priority_level) AS in_same_level
FROM resource_requests ORDER BY priority_score DESC;
```

**Result (live database):**

| request_id | priority_level | priority_score | rank | dense_rank | in_same_level |
| --- | --- | --- | --- | --- | --- |
| 9 | CRITICAL | 98.00 | 1 | 1 | 5 |
| 4 | CRITICAL | 96.00 | 2 | 2 | 5 |
| 1 | CRITICAL | 95.00 | 3 | 3 | 5 |
| 7 | CRITICAL | 94.00 | 4 | 4 | 5 |
| 10 | CRITICAL | 92.00 | 5 | 5 | 5 |
| 5 | HIGH | 82.00 | 6 | 6 | 7 |
| 2 | HIGH | 80.00 | 7 | 7 | 7 |
| 13 | HIGH | 80.00 | 7 | 7 | 7 |
| 6 | HIGH | 78.00 | 9 | 8 | 7 |
| 3 | HIGH | 75.00 | 10 | 9 | 7 |

_4 more rows not shown_

### Shortage detection (view v_resource_demand)

A view stores the demand-vs-supply query once; the dashboard and intelligence pages read it.

```sql
SELECT resource_name, unit, outstanding_demand, available_stock, net_position
FROM v_resource_demand ORDER BY net_position;
```

**Result (live database):**

| resource_name | unit | outstanding_demand | available_stock | net_position |
| --- | --- | --- | --- | --- |
| Insulin Vials | vial | 60.000 | 40.000 | -20.000 |
| Infant Formula | tin | 0 | 80.000 | 80.000 |
| Family Tent | unit | 0 | 240.000 | 240.000 |
| Solar Lantern | unit | 0 | 740.000 | 740.000 |
| First Aid Kit | kit | 160.000 | 1320.000 | 1160.000 |
| Water Purification Tablets | strip | 1500.000 | 3000.000 | 1500.000 |
| Hygiene Kit | kit | 0 | 1600.000 | 1600.000 |
| Tarpaulin Sheet | piece | 0 | 2300.000 | 2300.000 |
| Blanket | piece | 150.000 | 3500.000 | 3350.000 |
| Food Packet | packet | 850.000 | 5400.000 | 4550.000 |

_3 more rows not shown_

### Stored functions and procedure

request_fulfillment_pct() and operational_summary() are SQL functions; refresh_request_status() is a procedure called by the API.

```sql
SELECT rr.request_id, rr.status, request_fulfillment_pct(rr.request_id) AS fulfilled_pct
FROM resource_requests rr ORDER BY rr.request_id DESC LIMIT 6;
```

**Result (live database):**

| request_id | status | fulfilled_pct |
| --- | --- | --- |
| 14 | REJECTED | 0.0 |
| 13 | PENDING | 0.0 |
| 12 | PENDING | 0.0 |
| 11 | ALLOCATED | 100.0 |
| 10 | DELIVERED | 100.0 |
| 9 | PENDING | 0.0 |

### operational_summary() (set-returning function)

A function that returns a table of KPIs.

```sql
SELECT * FROM operational_summary();
```

**Result (live database):**

| metric | value |
| --- | --- |
| active_disasters | 10 |
| affected_population | 81300 |
| open_camps | 9 |
| open_requests | 7 |
| low_stock_lines | 6 |
| active_deliveries | 2 |

### Full-text search on disasters (tsvector + GIN index)

websearch_to_tsquery supports OR and -exclusion; ts_rank orders by relevance.

```sql
SELECT disaster_name, round(ts_rank(search_vector, q)::numeric, 3) AS rank
FROM disasters, websearch_to_tsquery('english', 'flood OR cyclone') q
WHERE search_vector @@ q ORDER BY rank DESC;
```

**Result (live database):**

| disaster_name | rank |
| --- | --- |
| Bengaluru Urban Flooding | 0.341 |
| Kerala Monsoon Floods | 0.341 |
| Cyclone Varsha Landfall | 0.341 |
| Test Cyclone Relief | 0.334 |
| Assam Brahmaputra Flooding | 0.334 |

### Trigger-written stock history

inventory_history (AFTER UPDATE) writes every stock change with its reason; no API code inserts these rows.

```sql
SELECT m.movement_id, w.warehouse_name, r.resource_name, m.delta, m.reason
FROM inventory_movements m JOIN warehouses w USING (warehouse_id) JOIN resources r USING (resource_id)
WHERE m.reason LIKE 'Allocation #%' ORDER BY m.movement_id DESC LIMIT 6;
```

**Result (live database):**

| movement_id | warehouse_name | resource_name | delta | reason |
| --- | --- | --- | --- | --- |
| 43 | Guwahati Central Store | Family Tent | -60.000 | Allocation #11 |
| 42 | Thrissur Regional Depot | Blanket | -400.000 | Allocation #10 |
| 41 | Bhubaneswar State Warehouse | Solar Lantern | -600.000 | Allocation #9 |
| 40 | Bhubaneswar State Warehouse | Tarpaulin Sheet | -900.000 | Allocation #9 |
| 39 | Bhubaneswar State Warehouse | Rice | -3000.000 | Allocation #9 |
| 38 | Bhubaneswar State Warehouse | Solar Lantern | -150.000 | Allocation #8 |

### Row-level audit trail (trigger log_row_change)

Field-level diffs captured automatically with the acting user.

```sql
SELECT l.change_id, l.table_name, l.operation, l.changed_fields, u.full_name AS changed_by
FROM data_change_log l LEFT JOIN app_users u ON u.user_id = l.changed_by
WHERE l.operation = 'UPDATE' ORDER BY l.change_id DESC LIMIT 5;
```

**Result (live database):**

| change_id | table_name | operation | changed_fields | changed_by |
| --- | --- | --- | --- | --- |
| 110 | resource_requests | UPDATE | {"status":{"to":"REJECTED","from":"PENDING"}} | Demo Admin |
| 106 | resource_requests | UPDATE | {"status":{"to":"ALLOCATED","from":"APPROVED"}} | Demo Admin |
| 105 | volunteers | UPDATE | {"availability_status":{"to":"AVAILABLE","from":"ASSIGNED"}} | Demo Admin |
| 104 | vehicles | UPDATE | {"status":{"to":"AVAILABLE","from":"IN_USE"},"current_location_id":{"to":20,"fro | Demo Admin |
| 103 | deliveries | UPDATE | {"status":{"to":"DELIVERED","from":"IN_TRANSIT"},"actual_arrival":{"to":"2026-11 | Demo Admin |
