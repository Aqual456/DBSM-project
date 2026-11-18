import { endpoint, actor, staff } from "@/lib/api";
import { pool } from "@/lib/postgres";

export const GET = endpoint(async (req) => {
  await actor(req, staff);
  const [camps, disasters, resources, locations, categories, warehouses] = await Promise.all([
    pool.query(
      `SELECT c.camp_id, c.camp_name, c.capacity, c.current_population, c.status, l.location_name
         FROM relief_camps c JOIN locations l USING (location_id) WHERE c.status <> 'CLOSED' ORDER BY c.camp_name`,
    ),
    pool.query(`SELECT disaster_id, disaster_name, severity, status FROM disasters WHERE status <> 'CLOSED' ORDER BY created_at DESC`),
    pool.query(
      `SELECT r.resource_id, r.resource_name, r.unit, c.category_name FROM resources r JOIN resource_categories c USING (category_id) ORDER BY resource_name`,
    ),
    pool.query(`SELECT location_id, location_name, location_type FROM locations ORDER BY location_name`),
    pool.query(`SELECT category_id, category_name FROM resource_categories ORDER BY category_name`),
    pool.query(`SELECT warehouse_id, warehouse_name, status FROM warehouses ORDER BY warehouse_name`),
  ]);
  return {
    camps: camps.rows,
    disasters: disasters.rows,
    resources: resources.rows,
    locations: locations.rows,
    categories: categories.rows,
    warehouses: warehouses.rows,
  };
});
