-- Run after 001_schema.sql and 002_seed.sql. This file contains explicit DDL/DML/query examples for evaluation.

-- CREATE + ALTER demonstration (safe additive change).
CREATE TABLE IF NOT EXISTS project_demo_notes (
  note_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE project_demo_notes ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'GENERAL';

-- INSERT / UPDATE / SELECT / DELETE demonstration.
INSERT INTO project_demo_notes(note_text, category)
VALUES ('Initial database validation completed', 'SETUP');
UPDATE project_demo_notes SET note_text = 'Database validation and setup completed' WHERE category = 'SETUP';
SELECT * FROM project_demo_notes ORDER BY created_at DESC;
DELETE FROM project_demo_notes WHERE category = 'SETUP';

-- JOIN + GROUP BY + HAVING + aggregate + ORDER BY.
SELECT d.disaster_id, d.disaster_name, COUNT(DISTINCT rr.request_id) AS request_count,
       COALESCE(SUM(ri.quantity_requested), 0) AS total_units_requested
FROM disasters d
LEFT JOIN resource_requests rr ON rr.disaster_id = d.disaster_id
LEFT JOIN request_items ri ON ri.request_id = rr.request_id
GROUP BY d.disaster_id, d.disaster_name
HAVING COUNT(DISTINCT rr.request_id) >= 0
ORDER BY request_count DESC, d.disaster_name;

-- Subquery: resources whose total available stock is below the average resource stock.
SELECT r.resource_id, r.resource_name,
       (SELECT COALESCE(SUM(i.quantity_available),0) FROM inventory i WHERE i.resource_id=r.resource_id) AS total_stock
FROM resources r
WHERE (SELECT COALESCE(SUM(i.quantity_available),0) FROM inventory i WHERE i.resource_id=r.resource_id)
      < (SELECT AVG(stock_by_resource.total_stock) FROM
         (SELECT SUM(quantity_available) AS total_stock FROM inventory GROUP BY resource_id) stock_by_resource);

-- DROP demonstration: removes only the dedicated demo table, never application data.
DROP TABLE IF EXISTS project_demo_notes;
