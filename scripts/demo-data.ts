import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

/**
 * ADDITIVE demo dataset. Inserts new, clearly named records only — it never updates or
 * deletes pre-existing rows. All allocations/deliveries go through the real triggers.
 * Idempotent: if the dataset marker exists, nothing is done.
 * Timestamps of demo rows are spread over the past 14 days so trend charts have history.
 * Demo staff accounts get an unusable password hash; an administrator can set one.
 */
const MARK = "[ReliefFlow demo dataset]";

const locations: [string, string, string, number, number][] = [
  ["Ernakulam District", "DISTRICT", "Ernakulam, Kerala", 9.9816, 76.2999],
  ["Aluva Riverside", "CAMP_AREA", "Aluva, Kerala", 10.1076, 76.3516],
  ["Thrissur Logistics Park", "DEPOT", "Thrissur, Kerala", 10.5276, 76.2144],
  ["Guwahati Metro", "DISTRICT", "Guwahati, Assam", 26.1445, 91.7362],
  ["Majuli Island", "CAMP_AREA", "Majuli, Assam", 26.9500, 94.1667],
  ["Puri Coastal Belt", "DISTRICT", "Puri, Odisha", 19.8135, 85.8312],
  ["Bhubaneswar Hub", "DEPOT", "Bhubaneswar, Odisha", 20.2961, 85.8245],
  ["Joshimath Slopes", "CAMP_AREA", "Joshimath, Uttarakhand", 30.5550, 79.5643],
  ["Dehradun Supply Base", "DEPOT", "Dehradun, Uttarakhand", 30.3165, 78.0322],
  ["Mysuru Relief Zone", "DISTRICT", "Mysuru, Karnataka", 12.2958, 76.6394],
];
const disasters: [string, string, string, number, string, string][] = [
  ["Kerala Monsoon Floods", "FLOOD", "CRITICAL", 9, "Ernakulam District", "Extreme monsoon rainfall flooded low-lying wards along the Periyar; thousands displaced to schools and community halls."],
  ["Assam Brahmaputra Flooding", "FLOOD", "HIGH", 12, "Guwahati Metro", "Brahmaputra above danger mark; river-island villages cut off, embankment breaches reported near Majuli."],
  ["Cyclone Varsha Landfall", "CYCLONE", "CRITICAL", 5, "Puri Coastal Belt", "Severe cyclonic storm made landfall near Puri with storm surge; power and water supply disrupted along the coast."],
  ["Joshimath Land Subsidence", "LANDSLIDE", "HIGH", 14, "Joshimath Slopes", "Cracks in homes and roads due to land subsidence; families relocated to temporary shelters."],
  ["Mysuru Heatwave", "HEATWAVE", "MODERATE", 4, "Mysuru Relief Zone", "Prolonged heatwave with drinking-water shortages in peri-urban wards; cooling centres opened."],
];
const affects: [string, string, string, number][] = [
  ["Kerala Monsoon Floods", "Ernakulam District", "SEVERE", 18500],
  ["Kerala Monsoon Floods", "Aluva Riverside", "SEVERE", 7200],
  ["Assam Brahmaputra Flooding", "Guwahati Metro", "HIGH", 9400],
  ["Assam Brahmaputra Flooding", "Majuli Island", "SEVERE", 12800],
  ["Cyclone Varsha Landfall", "Puri Coastal Belt", "SEVERE", 21000],
  ["Joshimath Land Subsidence", "Joshimath Slopes", "HIGH", 3100],
  ["Mysuru Heatwave", "Mysuru Relief Zone", "MODERATE", 5600],
];
const camps: [string, string, number, number][] = [
  ["Aluva Government School Camp", "Aluva Riverside", 800, 640],
  ["Ernakulam Town Hall Shelter", "Ernakulam District", 1200, 910],
  ["Majuli Satra Relief Camp", "Majuli Island", 600, 600],
  ["Guwahati Stadium Shelter", "Guwahati Metro", 1500, 870],
  ["Puri Cyclone Shelter No. 4", "Puri Coastal Belt", 900, 760],
  ["Joshimath Gurudwara Shelter", "Joshimath Slopes", 400, 285],
  ["Mysuru Cooling Centre", "Mysuru Relief Zone", 300, 120],
];
const warehouses: [string, string, number][] = [
  ["Thrissur Regional Depot", "Thrissur Logistics Park", 20000],
  ["Guwahati Central Store", "Guwahati Metro", 15000],
  ["Bhubaneswar State Warehouse", "Bhubaneswar Hub", 25000],
  ["Dehradun Mountain Depot", "Dehradun Supply Base", 8000],
];
const categories: [string, string][] = [
  ["HYGIENE", "Sanitation and hygiene supplies"],
  ["ENERGY", "Lighting and power supplies"],
];
const resources: [string, string, string, boolean][] = [
  ["FOOD", "Rice", "kg", false],
  ["FOOD", "Infant Formula", "tin", true],
  ["MEDICAL", "ORS Sachets", "sachet", false],
  ["MEDICAL", "Insulin Vials", "vial", true],
  ["WATER", "Water Purification Tablets", "strip", false],
  ["SHELTER", "Tarpaulin Sheet", "piece", false],
  ["SHELTER", "Family Tent", "unit", false],
  ["HYGIENE", "Hygiene Kit", "kit", false],
  ["ENERGY", "Solar Lantern", "unit", false],
];
// warehouse -> [resource, qty, threshold]
const stock: Record<string, [string, number, number][]> = {
  "Thrissur Regional Depot": [["Rice", 9000, 1500], ["Drinking Water", 6000, 2000], ["ORS Sachets", 4000, 800], ["Hygiene Kit", 700, 150], ["Tarpaulin Sheet", 900, 200], ["Infant Formula", 140, 120], ["First Aid Kit", 260, 60], ["Blanket", 1100, 300]],
  "Guwahati Central Store": [["Rice", 5200, 1200], ["Drinking Water", 1500, 2500], ["Water Purification Tablets", 3000, 500], ["Family Tent", 180, 60], ["Blanket", 900, 250], ["Food Packet", 2400, 600], ["Solar Lantern", 90, 100]],
  "Bhubaneswar State Warehouse": [["Rice", 12000, 2000], ["Drinking Water", 9000, 3000], ["Tarpaulin Sheet", 2600, 500], ["Solar Lantern", 1400, 300], ["Hygiene Kit", 1200, 250], ["ORS Sachets", 5200, 900], ["Insulin Vials", 40, 50], ["First Aid Kit", 600, 120]],
  "Dehradun Mountain Depot": [["Blanket", 1600, 300], ["Family Tent", 240, 80], ["Food Packet", 1800, 400], ["First Aid Kit", 160, 50], ["Drinking Water", 2200, 800]],
};
// camp, disaster, daysAgo, needInHours, level, score, medical, remarks, items, outcome
type Outcome = "PENDING" | "APPROVED" | "REJECTED" | "ALLOCATED" | "IN_TRANSIT" | "DELIVERED";
const requests: [string, string, number, number, string, number, boolean, string, [string, number][], Outcome][] = [
  ["Aluva Government School Camp", "Kerala Monsoon Floods", 9, 30, "CRITICAL", 96, true, "Diarrhoea cases rising among children; need ORS and safe water urgently.", [["ORS Sachets", 1200], ["Drinking Water", 2400], ["Infant Formula", 60]], "DELIVERED"],
  ["Ernakulam Town Hall Shelter", "Kerala Monsoon Floods", 8, 48, "HIGH", 82, false, "Bedding and hygiene kits for newly arrived families from flooded wards.", [["Blanket", 500], ["Hygiene Kit", 300]], "IN_TRANSIT"],
  ["Aluva Government School Camp", "Kerala Monsoon Floods", 3, 36, "HIGH", 78, false, "Second round of dry rations for the next week.", [["Rice", 2500], ["Food Packet", 400]], "ALLOCATED"],
  ["Majuli Satra Relief Camp", "Assam Brahmaputra Flooding", 11, 24, "CRITICAL", 94, false, "Camp at full capacity; families sleeping outside under tarpaulin. Need tents and lanterns.", [["Family Tent", 120], ["Solar Lantern", 150], ["Tarpaulin Sheet", 300]], "ALLOCATED"],
  ["Guwahati Stadium Shelter", "Assam Brahmaputra Flooding", 6, 40, "HIGH", 75, false, "Water purification needed; municipal supply contaminated after flooding.", [["Water Purification Tablets", 1500], ["Drinking Water", 3000]], "APPROVED"],
  ["Puri Cyclone Shelter No. 4", "Cyclone Varsha Landfall", 4, 20, "CRITICAL", 98, true, "Diabetic evacuees without insulin after pharmacies were flooded; cold chain needed.", [["Insulin Vials", 60], ["First Aid Kit", 80]], "PENDING"],
  ["Puri Cyclone Shelter No. 4", "Cyclone Varsha Landfall", 4, 30, "CRITICAL", 92, false, "Power lines down; storm surge damaged roofs. Lanterns and tarpaulins required.", [["Solar Lantern", 600], ["Tarpaulin Sheet", 900], ["Rice", 3000]], "DELIVERED"],
  ["Joshimath Gurudwara Shelter", "Joshimath Land Subsidence", 12, 72, "HIGH", 70, false, "Night temperatures near freezing; blankets and tents for relocated families.", [["Blanket", 400], ["Family Tent", 60]], "DELIVERED"],
  ["Joshimath Gurudwara Shelter", "Joshimath Land Subsidence", 2, 96, "MEDIUM", 55, false, "Weekly food packets and first aid restock.", [["Food Packet", 500], ["First Aid Kit", 40]], "PENDING"],
  ["Mysuru Cooling Centre", "Mysuru Heatwave", 2, 18, "HIGH", 80, true, "Heat exhaustion cases; ORS and drinking water for walk-in visitors.", [["ORS Sachets", 900], ["Drinking Water", 1800]], "PENDING"],
  ["Ernakulam Town Hall Shelter", "Kerala Monsoon Floods", 1, 60, "MEDIUM", 50, false, "Duplicate of an earlier blanket request raised by mistake.", [["Blanket", 200]], "REJECTED"],
];
const vehicles: [string, string, number][] = [
  ["KL-07-RF-1021", "TRUCK", 9000],
  ["KL-08-RF-2210", "MINI_TRUCK", 3500],
  ["AS-01-RF-4471", "TRUCK", 10000],
  ["OD-02-RF-5530", "TRUCK", 12000],
  ["UK-07-RF-8812", "4X4_PICKUP", 1500],
  ["KA-09-RF-3301", "VAN", 1200],
];
const volunteers: [string, string, string][] = [
  ["Meera Nair", "+91 98470 11001", "First aid, Malayalam"],
  ["Arjun Menon", "+91 98470 11002", "Logistics, driving"],
  ["Bikash Das", "+91 94350 22003", "Boat handling, Assamese"],
  ["Rupjyoti Borah", "+91 94350 22004", "Water purification"],
  ["Sasmita Behera", "+91 94370 33005", "Shelter setup, Odia"],
  ["Pradeep Mohanty", "+91 94370 33006", "Electrical, solar"],
  ["Kavita Rawat", "+91 94120 44007", "Mountain rescue"],
  ["Imran Qureshi", "+91 98450 55008", "Nursing"],
  ["Lakshmi Gowda", "+91 98450 55009", "Community kitchen"],
  ["Tenzin Norbu", "+91 94120 44010", "Cold-weather logistics"],
];
const staff: [string, string, string][] = [
  ["Ananya Rao", "ananya.rao@reliefflow.demo", "RELIEF_COORDINATOR"],
  ["Joseph Mathew", "joseph.mathew@reliefflow.demo", "FIELD_OFFICER"],
  ["Ravi Kumar", "ravi.kumar@reliefflow.demo", "DRIVER"],
  ["Hemanta Gogoi", "hemanta.gogoi@reliefflow.demo", "DRIVER"],
  ["Suresh Pradhan", "suresh.pradhan@reliefflow.demo", "DRIVER"],
  ["Dinesh Negi", "dinesh.negi@reliefflow.demo", "DRIVER"],
];
const incidents: [string, string, string, string, string[], string, number?, number?][] = [
  ["Kerala Monsoon Floods", "DAMAGE", "HIGH", "Embankment breach near Aluva bridge flooded three wards overnight; ground floors submerged and roads impassable for trucks.", ["embankment", "road-closure"], "Aluva Riverside", 10.1076, 76.3516],
  ["Kerala Monsoon Floods", "MEDICAL", "CRITICAL", "Cluster of acute diarrhoea among children at the school camp; suspected contaminated water from a flooded well.", ["waterborne", "children", "outbreak"], "Aluva Government School Camp"],
  ["Kerala Monsoon Floods", "SUPPLY", "MODERATE", "Infant formula stock at the school camp will last less than two days at current consumption.", ["infant", "shortage"], "Aluva Government School Camp"],
  ["Kerala Monsoon Floods", "SAFETY", "HIGH", "Live electric line fallen into floodwater near the town hall shelter; KSEB notified, area cordoned.", ["electrical", "hazard"], "Ernakulam Town Hall Shelter"],
  ["Kerala Monsoon Floods", "GENERAL", "LOW", "Volunteers set up a community kitchen serving two meals a day to about 600 people.", ["kitchen", "volunteers"], "Ernakulam District"],
  ["Assam Brahmaputra Flooding", "DAMAGE", "CRITICAL", "River-island villages on Majuli cut off; boats required to reach stranded families on raised platforms.", ["boat", "stranded", "island"], "Majuli Island", 26.95, 94.1667],
  ["Assam Brahmaputra Flooding", "SUPPLY", "HIGH", "Majuli camp is at full capacity and families are sleeping outdoors; tents and lighting urgently required.", ["tents", "overcrowding"], "Majuli Satra Relief Camp"],
  ["Assam Brahmaputra Flooding", "MEDICAL", "HIGH", "Skin infections and fever reported among people wading through floodwater for several days.", ["infection", "fever"], "Guwahati Stadium Shelter"],
  ["Assam Brahmaputra Flooding", "SAFETY", "MODERATE", "Snake sightings inside the stadium shelter after water entered the lower stands.", ["wildlife", "snake"], "Guwahati Stadium Shelter"],
  ["Assam Brahmaputra Flooding", "SUPPLY", "HIGH", "Municipal water supply contaminated; purification tablets and bottled water needed for the shelter.", ["water", "contamination"], "Guwahati Metro"],
  ["Cyclone Varsha Landfall", "DAMAGE", "CRITICAL", "Storm surge destroyed thatched homes along the coast; roofs blown off the primary school used as a shelter.", ["storm-surge", "roof-damage"], "Puri Coastal Belt", 19.8135, 85.8312],
  ["Cyclone Varsha Landfall", "MEDICAL", "CRITICAL", "Several diabetic evacuees missed insulin doses; local pharmacy stock destroyed. Cold storage needed.", ["insulin", "diabetes", "cold-chain"], "Puri Cyclone Shelter No. 4"],
  ["Cyclone Varsha Landfall", "SAFETY", "HIGH", "Uprooted trees blocking the highway to Puri; relief convoy delayed by four hours.", ["road-closure", "convoy"], "Puri Coastal Belt"],
  ["Cyclone Varsha Landfall", "GENERAL", "MODERATE", "Power outage across the district; shelters relying on lanterns and a single generator.", ["power-outage", "lighting"], "Puri Coastal Belt"],
  ["Joshimath Land Subsidence", "DAMAGE", "HIGH", "New cracks appeared in houses on the upper slope; twelve more families asked to relocate.", ["cracks", "relocation"], "Joshimath Slopes", 30.555, 79.5643],
  ["Joshimath Land Subsidence", "SAFETY", "HIGH", "Night temperatures dropped near freezing; elderly residents at risk of hypothermia in the shelter.", ["cold", "elderly"], "Joshimath Gurudwara Shelter"],
  ["Joshimath Land Subsidence", "SUPPLY", "MODERATE", "Blanket delivery received; tents still required for families waiting for relocation housing.", ["blankets", "tents"], "Joshimath Gurudwara Shelter"],
  ["Mysuru Heatwave", "MEDICAL", "HIGH", "Heat exhaustion cases among construction workers; cooling centre treated 40 people today.", ["heat-exhaustion", "workers"], "Mysuru Cooling Centre", 12.2958, 76.6394],
  ["Mysuru Heatwave", "SUPPLY", "MODERATE", "Drinking water tanker schedule disrupted; ward residents queuing for hours in the afternoon heat.", ["water", "tanker"], "Mysuru Relief Zone"],
  ["Mysuru Heatwave", "GENERAL", "LOW", "Awareness drive on hydration and ORS use conducted in three wards.", ["awareness", "ors"], "Mysuru Relief Zone"],
];

async function main() {
  const { pool } = await import("../src/lib/postgres");
  const c = await pool.connect();
  try {
    if ((await c.query("SELECT 1 FROM disasters WHERE description LIKE $1 LIMIT 1", [`%${MARK}%`])).rowCount) {
      console.log("Demo dataset already present — nothing changed.");
      return;
    }
    await c.query("BEGIN");
    const admin = (await c.query(`SELECT user_id FROM app_users u JOIN roles r USING (role_id) WHERE r.role_name = 'ADMIN' AND u.is_active ORDER BY user_id LIMIT 1`)).rows[0];
    if (!admin) throw new Error("No active administrator. Run npm run db:admin first.");
    await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(admin.user_id)]);
    const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
    const one = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];

    const userId: Record<string, number> = {};
    for (const [name, email, role] of staff) {
      const r = await one(
        `INSERT INTO app_users(role_id, full_name, email, password_hash)
         SELECT role_id, $1, $2, 'REPLACE_WITH_ARGON2_HASH' FROM roles WHERE role_name = $3
         ON CONFLICT (email) DO NOTHING RETURNING user_id`,
        [name, email, role],
      );
      userId[name] = r?.user_id ?? (await one("SELECT user_id FROM app_users WHERE email = $1", [email])).user_id;
    }
    const loc: Record<string, number> = {};
    for (const [name, type, address, lat, lon] of locations)
      loc[name] = (await one(`INSERT INTO locations(location_name, location_type, address, latitude, longitude) VALUES ($1,$2,$3,$4,$5) RETURNING location_id`, [name, type, address, lat, lon])).location_id;
    const dis: Record<string, number> = {};
    for (const [name, type, sev, daysAgo, at, desc] of disasters)
      dis[name] = (
        await one(
          `INSERT INTO disasters(disaster_name, disaster_type, severity, started_at, description, created_by, event_location_id, created_at)
           VALUES ($1,$2,$3, now() - make_interval(days => $4), $5, $6, $7, now() - make_interval(days => $4)) RETURNING disaster_id`,
          [name, type, sev, daysAgo, `${desc} ${MARK}`, admin.user_id, loc[at]],
        )
      ).disaster_id;
    for (const [d, l, impact, pop] of affects)
      await q(`INSERT INTO disaster_locations(disaster_id, location_id, impact_level, affected_population, reported_at) VALUES ($1,$2,$3,$4, now() - interval '3 days')`, [dis[d], loc[l], impact, pop]);
    const camp: Record<string, number> = {};
    for (const [name, l, cap, pop] of camps)
      camp[name] = (
        await one(
          `INSERT INTO relief_camps(location_id, camp_name, capacity, current_population, manager_id, status, established_at)
           VALUES ($1,$2,$3::int,$4::int,$5, CASE WHEN $4::int >= $3::int THEN 'FULL' ELSE 'OPEN' END, current_date - 10) RETURNING camp_id`,
          [loc[l], name, cap, pop, userId["Ananya Rao"]],
        )
      ).camp_id;
    const wh: Record<string, number> = {};
    for (const [name, l, cap] of warehouses)
      wh[name] = (await one(`INSERT INTO warehouses(location_id, warehouse_name, manager_id, capacity, status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING warehouse_id`, [loc[l], name, userId["Ananya Rao"], cap])).warehouse_id;
    for (const [name, desc] of categories)
      await q(`INSERT INTO resource_categories(category_name, description) VALUES ($1,$2) ON CONFLICT (category_name) DO NOTHING`, [name, desc]);
    for (const [cat, name, unit, perishable] of resources)
      await q(
        `INSERT INTO resources(category_id, resource_name, unit, is_perishable, description)
         SELECT category_id, $2, $3, $4, $5 FROM resource_categories WHERE category_name = $1
         ON CONFLICT (category_id, resource_name) DO NOTHING`,
        [cat, name, unit, perishable, MARK],
      );
    const res: Record<string, number> = Object.fromEntries((await q(`SELECT resource_name, resource_id FROM resources`)).map((r) => [r.resource_name, r.resource_id]));

    await c.query("SELECT set_config('reliefflow.reason', 'Opening stock (demo dataset)', true)");
    for (const [w, lines] of Object.entries(stock))
      for (const [r, qty, min] of lines)
        await q(`INSERT INTO inventory(warehouse_id, resource_id, quantity_available, minimum_threshold) VALUES ($1,$2,$3,$4)`, [wh[w], res[r], qty, min]);
    // Spread opening-stock movements over the past two weeks (demo rows only).
    await q(
      `UPDATE inventory_movements SET created_at = now() - ((movement_id % 13) + 1) * interval '1 day'
        WHERE reason = 'Opening stock (demo dataset)'`,
    );

    const veh: Record<string, number> = {};
    for (const [num, type, cap] of vehicles)
      veh[num] = (await one(`INSERT INTO vehicles(vehicle_number, vehicle_type, capacity, status, current_location_id) VALUES ($1,$2,$3,'AVAILABLE',NULL) ON CONFLICT (vehicle_number) DO NOTHING RETURNING vehicle_id`, [num, type, cap]))?.vehicle_id;
    const vol: number[] = [];
    for (const [name, phone, skills] of volunteers) {
      const r = await one(`INSERT INTO volunteers(full_name, phone, skills, registered_at) VALUES ($1,$2,$3, now() - interval '20 days') ON CONFLICT (phone) DO NOTHING RETURNING volunteer_id`, [name, phone, skills]);
      if (r) vol.push(r.volunteer_id);
    }

    // Choose a warehouse that can cover each line (largest stock first).
    const pick = async (resourceId: number, qty: number) =>
      one(
        `SELECT i.warehouse_id, w.location_id FROM inventory i JOIN warehouses w USING (warehouse_id)
          WHERE i.resource_id = $1 AND i.quantity_available >= $2 AND w.status = 'ACTIVE'
          ORDER BY i.quantity_available DESC LIMIT 1`,
        [resourceId, qty],
      );
    const drivers = ["Ravi Kumar", "Hemanta Gogoi", "Suresh Pradhan", "Dinesh Negi"];
    const fleet = Object.values(veh).filter(Boolean);
    let n = 0;
    for (const [campName, disName, daysAgo, needIn, level, score, medical, remarks, items, outcome] of requests) {
      const rr = await one(
        `INSERT INTO resource_requests(camp_id, disaster_id, requested_by, requested_at, need_by, priority_score, priority_level, medical_emergency, remarks)
         VALUES ($1,$2,$3, now() - make_interval(days => $4), now() - make_interval(days => $4) + make_interval(hours => $5), $6,$7,$8,$9) RETURNING request_id`,
        [camp[campName], dis[disName], userId["Joseph Mathew"], daysAgo, Math.max(needIn, daysAgo * 24 + 12), score, level, medical, remarks],
      );
      for (const [r, qty] of items) await q(`INSERT INTO request_items VALUES ($1,$2,$3)`, [rr.request_id, res[r], qty]);
      if (outcome === "PENDING") continue;
      await q(`UPDATE resource_requests SET status = $1 WHERE request_id = $2`, [outcome === "REJECTED" ? "REJECTED" : "APPROVED", rr.request_id]);
      if (outcome === "REJECTED" || outcome === "APPROVED") continue;
      // Group lines by the warehouse location that can serve them -> one allocation per pickup location.
      const groups = new Map<number, { warehouse_id: number; resource_id: number; qty: number }[]>();
      for (const [r, qty] of items) {
        const src = await pick(res[r], qty);
        if (!src) continue;
        groups.set(src.location_id, [...(groups.get(src.location_id) ?? []), { warehouse_id: src.warehouse_id, resource_id: res[r], qty }]);
      }
      for (const lines of groups.values()) {
        const a = await one(
          `INSERT INTO allocations(request_id, allocated_by, allocated_at, remarks) VALUES ($1,$2, now() - make_interval(days => $3) + interval '6 hours', 'Demo dataset allocation') RETURNING allocation_id`,
          [rr.request_id, userId["Ananya Rao"], daysAgo],
        );
        await c.query("SELECT set_config('reliefflow.reason', $1, true)", [`Allocation #${a.allocation_id}`]);
        for (const l of lines.sort((x, y) => x.warehouse_id - y.warehouse_id || x.resource_id - y.resource_id))
          await q(`INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated) VALUES ($1,$2,$3,$4,$5)`, [
            a.allocation_id, rr.request_id, l.resource_id, l.warehouse_id, l.qty,
          ]);
        await q(`UPDATE inventory_movements SET created_at = now() - make_interval(days => $1) + interval '6 hours' WHERE reason = $2`, [daysAgo, `Allocation #${a.allocation_id}`]);
        if (outcome === "ALLOCATED" || !fleet.length) continue;
        const driver = userId[drivers[n % drivers.length]];
        const vehicle = fleet[n % fleet.length];
        n++;
        const busy = await one(`SELECT 1 AS x FROM deliveries WHERE (driver_id = $1 OR vehicle_id = $2) AND status IN ('PLANNED','IN_TRANSIT','DELAYED')`, [driver, vehicle]);
        if (busy) continue;
        const src = await one(`SELECT w.location_id FROM allocation_items ai JOIN warehouses w USING (warehouse_id) WHERE allocation_id = $1 LIMIT 1`, [a.allocation_id]);
        const d = await one(
          `INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id, expected_arrival)
           SELECT $1,$2,$3,$4, location_id, now() + interval '1 day' FROM relief_camps WHERE camp_id = $5 RETURNING delivery_id`,
          [a.allocation_id, vehicle, driver, src.location_id, camp[campName]],
        );
        await q(`UPDATE vehicles SET status = 'IN_USE' WHERE vehicle_id = $1`, [vehicle]);
        const helper = vol[n % vol.length];
        if (helper && (await one(`UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE' RETURNING 1 AS x`, [helper])))
          await q(`INSERT INTO delivery_volunteers VALUES ($1,$2,'LOADING_SUPPORT')`, [d.delivery_id, helper]);
        await q(`UPDATE deliveries SET status = 'IN_TRANSIT', departure_time = now() - make_interval(days => $2) + interval '10 hours' WHERE delivery_id = $1`, [d.delivery_id, Math.max(daysAgo - 1, 0)]);
        await q(`UPDATE allocations SET status = 'IN_TRANSIT' WHERE allocation_id = $1`, [a.allocation_id]);
        if (outcome === "DELIVERED") {
          await q(`UPDATE deliveries SET status = 'DELIVERED', actual_arrival = departure_time + interval '9 hours' WHERE delivery_id = $1`, [d.delivery_id]);
          await q(`UPDATE allocations SET status = 'DELIVERED' WHERE allocation_id = $1`, [a.allocation_id]);
          await q(`UPDATE vehicles SET status = 'AVAILABLE', current_location_id = (SELECT location_id FROM relief_camps WHERE camp_id = $2) WHERE vehicle_id = $1`, [vehicle, camp[campName]]);
          await q(`UPDATE volunteers SET availability_status = 'AVAILABLE' WHERE volunteer_id IN (SELECT volunteer_id FROM delivery_volunteers WHERE delivery_id = $1)`, [d.delivery_id]);
        }
      }
      await c.query("CALL refresh_request_status($1)", [rr.request_id]);
    }
    await q(`INSERT INTO audit_logs(user_id, action, details) VALUES ($1, 'DEMO_DATASET_LOADED', $2)`, [admin.user_id, JSON.stringify({ marker: MARK })]);
    await c.query("COMMIT");
    console.log("PostgreSQL demo dataset inserted.");

    const { getMongoDb, getMongoClient } = await import("../src/lib/mongodb");
    const col = (await getMongoDb()).collection("incident_reports");
    if (!(await col.countDocuments({ source: "demo-dataset" }))) {
      const docs = incidents.map(([d, type, sev, text, tags, label, lat, lon], i) => {
        const at = new Date(Date.now() - (i % 12) * 86400000 - i * 3600000);
        return {
          disasterId: Number(dis[d]),
          reportedBy: Number(userId["Joseph Mathew"]),
          reporterName: "Joseph Mathew",
          reportType: type,
          description: text,
          location: lat !== undefined ? { label, latitude: lat, longitude: lon } : { label },
          severity: sev,
          tags,
          status: i % 5 === 4 ? "RESOLVED" : i % 3 === 0 ? "MONITORING" : "OPEN",
          updates: i % 4 === 0 ? [{ note: "Field team dispatched to verify the report.", by: Number(userId["Ananya Rao"]), byName: "Ananya Rao", at: new Date(at.getTime() + 7200000) }] : [],
          source: "demo-dataset",
          createdAt: at,
          updatedAt: at,
        };
      });
      await col.insertMany(docs);
      console.log(`MongoDB: ${docs.length} demo incident reports inserted.`);
    }
    await (await getMongoClient()).close();
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error("Demo dataset failed (no changes committed):", e.code ?? "", e.message);
  process.exit(1);
});
