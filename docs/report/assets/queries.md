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
| Gopalpur Cyclone Shelter | 2 | 21100.000 | 97.0 |
| Paravur Government School Camp | 2 | 15850.000 | 85.5 |
| Silapathar Higher Secondary School Camp | 2 | 9266.000 | 80.6 |
| Kochi Regional Sports Centre Shelter | 2 | 2764.000 | 70.0 |
| Nichar Community Hall Shelter | 2 | 1002.000 | 63.2 |

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
| WATER | 9 | 109894.000 | 12210.4 | 1200.000 | 35000.000 |
| FOOD | 15 | 62380.000 | 4158.7 | 150.000 | 15000.000 |
| MEDICAL | 9 | 20432.000 | 2270.2 | 12.000 | 6500.000 |
| SHELTER | 14 | 15056.000 | 1075.4 | 70.000 | 3828.000 |
| HYGIENE | 7 | 12000.000 | 1714.3 | 600.000 | 4000.000 |
| ENERGY | 2 | 2064.000 | 1032.0 | 150.000 | 1914.000 |

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
| Essential Medicines Kit | kit | 12.000 |
| Insulin Vials | vial | 40.000 |
| Infant Formula | tin | 150.000 |
| Family Tent | unit | 488.000 |
| First Aid Kit | kit | 880.000 |
| Sleeping Mat | piece | 1860.000 |
| Menstrual Hygiene Pack | pack | 2000.000 |
| Solar Lantern | unit | 2064.000 |
| Cooking Oil | litre | 2570.000 |
| Family Hygiene Kit | kit | 3000.000 |

_7 more rows not shown_

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
| Gopalpur Cyclone Shelter | 21100.000 |
| Paravur Government School Camp | 15850.000 |
| Silapathar Higher Secondary School Camp | 9266.000 |
| Nagpur Civil Lines Cooling Centre | 6000.000 |
| Velachery Corporation School Shelter | 2880.000 |
| Kochi Regional Sports Centre Shelter | 2764.000 |
| Nichar Community Hall Shelter | 1002.000 |

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

_(no rows)_

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
| 0 | 98900 |
| 1 | 98024 |
| 2 | 97148 |
| 3 | 96272 |
| 4 | 95396 |
| 5 | 94520 |
| 6 | 93644 |
| 7 | 92768 |
| 8 | 91892 |
| 9 | 91016 |

_21 more rows not shown_

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
| 5 | CRITICAL | 98.00 | 1 | 1 | 4 |
| 7 | CRITICAL | 96.00 | 2 | 2 | 4 |
| 1 | CRITICAL | 95.00 | 3 | 3 | 4 |
| 6 | CRITICAL | 92.00 | 4 | 4 | 4 |
| 8 | HIGH | 85.00 | 5 | 5 | 7 |
| 2 | HIGH | 82.00 | 6 | 6 | 7 |
| 10 | HIGH | 80.00 | 7 | 7 | 7 |
| 12 | HIGH | 79.00 | 8 | 8 | 7 |
| 13 | HIGH | 77.00 | 9 | 9 | 7 |
| 3 | HIGH | 76.00 | 10 | 10 | 7 |

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
| Essential Medicines Kit | kit | 0 | 12.000 | 12.000 |
| Infant Formula | tin | 0 | 150.000 | 150.000 |
| Family Tent | unit | 0 | 488.000 | 488.000 |
| First Aid Kit | kit | 10.000 | 880.000 | 870.000 |
| Menstrual Hygiene Pack | pack | 300.000 | 2000.000 | 1700.000 |
| Sleeping Mat | piece | 0 | 1860.000 | 1860.000 |
| Solar Lantern | unit | 0 | 2064.000 | 2064.000 |
| Cooking Oil | litre | 0 | 2570.000 | 2570.000 |
| Family Hygiene Kit | kit | 224.000 | 3000.000 | 2776.000 |

_11 more rows not shown_

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
| 13 | ALLOCATED | 100.0 |
| 12 | APPROVED | 0.0 |
| 11 | PENDING | 0.0 |
| 10 | DELIVERED | 100.0 |
| 9 | APPROVED | 0.0 |

### operational_summary() (set-returning function)

A function that returns a table of KPIs.

```sql
SELECT * FROM operational_summary();
```

**Result (live database):**

| metric | value |
| --- | --- |
| active_disasters | 5 |
| affected_population | 156650 |
| open_camps | 8 |
| open_requests | 5 |
| low_stock_lines | 3 |
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
| Cyclone Tara | 0.345 |
| Dhemaji Flash Floods | 0.341 |
| Chennai Urban Flooding | 0.341 |
| Periyar River Floods | 0.334 |

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
| 78 | Ambattur Relief Warehouse | Blanket | -320.000 | Allocation #10 |
| 77 | Ambattur Relief Warehouse | Sleeping Mat | -320.000 | Allocation #10 |
| 76 | Ambattur Relief Warehouse | Ready-to-Eat Meal | -1920.000 | Allocation #10 |
| 75 | Rampur Bushahr Mountain Depot | Family Tent | -12.000 | Allocation #9 |
| 74 | Rampur Bushahr Mountain Depot | Blanket | -280.000 | Allocation #9 |
| 73 | Khordha Regional Relief Depot | Water Jerrycan 20 L | -206.000 | Allocation #8 |

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
| 140 | disasters | UPDATE | {"status":{"to":"CONTAINED","from":"ACTIVE"}} | Demo Admin |
| 139 | resource_requests | UPDATE | {"status":{"to":"REJECTED","from":"PENDING"}} | Demo Admin |
| 137 | resource_requests | UPDATE | {"status":{"to":"ALLOCATED","from":"APPROVED"}} | Demo Admin |
| 136 | resource_requests | UPDATE | {"status":{"to":"APPROVED","from":"PENDING"}} | Demo Admin |
| 134 | resource_requests | UPDATE | {"status":{"to":"APPROVED","from":"PENDING"}} | Demo Admin |
