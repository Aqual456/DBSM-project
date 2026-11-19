import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFileSync } from "fs";

/**
 * ReliefFlow standard sample dataset:  npm run db:seed
 *
 * Six FICTIONAL present-day emergencies in real Indian districts (names, people, phone numbers and
 * vehicle numbers are invented; every disaster description is tagged [ReliefFlow sample data]).
 * Relief quantities follow the Sphere Handbook minimum standards, e.g. 7.5 L drinking/cooking water
 * per person per day, 0.4 kg cereal per person per day, one blanket per person, two tarpaulins per
 * household. Requests cover every stage of the workflow (pending, approved, partially fulfilled,
 * allocated, in transit, delivered, rejected) and all allocations and deliveries go through the
 * real triggers, so stock, history and statuses are consistent.
 *
 * - Runs db/postgres/002_seed.sql first (roles + Sphere-based catalogue, idempotent).
 * - Additive and idempotent: if the sample marker already exists, nothing is changed.
 * - Sample staff accounts (@reliefflow.sample) get an unusable password; an admin can set one.
 * - Afterwards: incident reports in MongoDB, then vectors and graph are re-synced.
 */
const MARK = "[ReliefFlow sample data]";
const DOMAIN = "reliefflow.sample";

const locations: [string, string, string, number, number][] = [
  ["Ernakulam District", "DISTRICT", "Kochi, Ernakulam, Kerala", 9.9816, 76.2999],
  ["Paravur Town", "CAMP_AREA", "North Paravur, Ernakulam, Kerala", 10.1517, 76.229],
  ["Kalamassery Logistics Hub", "DEPOT", "Kalamassery, Ernakulam, Kerala", 10.0531, 76.3229],
  ["Ganjam District", "DISTRICT", "Berhampur, Ganjam, Odisha", 19.3149, 84.7941],
  ["Gopalpur Coast", "CAMP_AREA", "Gopalpur-on-Sea, Ganjam, Odisha", 19.2586, 84.9052],
  ["Khordha Relief Depot", "DEPOT", "Khordha, Odisha", 20.1825, 85.6177],
  ["Dhemaji District", "DISTRICT", "Dhemaji, Assam", 27.4833, 94.5833],
  ["Silapathar Riverbank", "CAMP_AREA", "Silapathar, Dhemaji, Assam", 27.5974, 94.722],
  ["North Lakhimpur Store", "DEPOT", "North Lakhimpur, Assam", 27.236, 94.102],
  ["Kinnaur District", "DISTRICT", "Reckong Peo, Kinnaur, Himachal Pradesh", 31.539, 78.27],
  ["Nichar Village", "CAMP_AREA", "Nichar, Kinnaur, Himachal Pradesh", 31.568, 77.958],
  ["Rampur Bushahr Depot", "DEPOT", "Rampur, Shimla, Himachal Pradesh", 31.449, 77.63],
  ["Nagpur City", "DISTRICT", "Nagpur, Maharashtra", 21.1458, 79.0882],
  ["Velachery Ward", "WARD", "Velachery, Chennai, Tamil Nadu", 12.9815, 80.218],
  ["Ambattur Depot", "DEPOT", "Ambattur, Chennai, Tamil Nadu", 13.1143, 80.1548],
];
// name, type, severity, days ago, event location, description
const disasters: [string, string, string, number, string, string][] = [
  ["Periyar River Floods", "FLOOD", "CRITICAL", 10, "Ernakulam District", "Five days of continuous heavy rain pushed the Periyar above the danger level; low-lying wards of Paravur and Aluva taluks are under water."],
  ["Cyclone Tara", "CYCLONE", "CRITICAL", 6, "Ganjam District", "A very severe cyclonic storm made landfall near Gopalpur with winds of about 150 km/h; coastal villages were evacuated to cyclone shelters."],
  ["Dhemaji Flash Floods", "FLOOD", "HIGH", 12, "Dhemaji District", "An embankment breach on the Jiadhal river flooded about 40 villages and cut road links to Silapathar."],
  ["Nichar Landslide", "LANDSLIDE", "HIGH", 8, "Kinnaur District", "Heavy rain triggered a landslide above Nichar village, blocking the highway and damaging about 30 houses."],
  ["Vidarbha Heatwave", "HEATWAVE", "MODERATE", 5, "Nagpur City", "Temperatures above 46 °C for a week, with drinking-water shortages and heat illness in city wards."],
  ["Chennai Urban Flooding", "FLOOD", "MODERATE", 3, "Velachery Ward", "An overnight cloudburst flooded Velachery; families from ground-floor homes moved to school buildings."],
];
const affects: [string, string, string, number][] = [
  ["Periyar River Floods", "Ernakulam District", "SEVERE", 24000],
  ["Periyar River Floods", "Paravur Town", "SEVERE", 9600],
  ["Cyclone Tara", "Ganjam District", "SEVERE", 31000],
  ["Cyclone Tara", "Gopalpur Coast", "SEVERE", 8700],
  ["Dhemaji Flash Floods", "Dhemaji District", "HIGH", 15200],
  ["Dhemaji Flash Floods", "Silapathar Riverbank", "SEVERE", 6400],
  ["Nichar Landslide", "Kinnaur District", "MODERATE", 1800],
  ["Nichar Landslide", "Nichar Village", "HIGH", 650],
  ["Vidarbha Heatwave", "Nagpur City", "MODERATE", 52000],
  ["Chennai Urban Flooding", "Velachery Ward", "HIGH", 7300],
];
// camp, location, capacity, current population
const camps: [string, string, number, number][] = [
  ["Paravur Government School Camp", "Paravur Town", 900, 760],
  ["Kochi Regional Sports Centre Shelter", "Ernakulam District", 1500, 1120],
  ["Gopalpur Cyclone Shelter", "Gopalpur Coast", 1000, 1000],
  ["Berhampur University Hostel Camp", "Ganjam District", 700, 430],
  ["Silapathar Higher Secondary School Camp", "Silapathar Riverbank", 600, 515],
  ["Nichar Community Hall Shelter", "Nichar Village", 250, 140],
  ["Nagpur Civil Lines Cooling Centre", "Nagpur City", 400, 95],
  ["Velachery Corporation School Shelter", "Velachery Ward", 500, 320],
];
const warehouses: [string, string, number][] = [
  ["Kalamassery State Relief Warehouse", "Kalamassery Logistics Hub", 30000],
  ["Khordha Regional Relief Depot", "Khordha Relief Depot", 35000],
  ["North Lakhimpur District Store", "North Lakhimpur Store", 15000],
  ["Rampur Bushahr Mountain Depot", "Rampur Bushahr Depot", 8000],
  ["Ambattur Relief Warehouse", "Ambattur Depot", 20000],
];
// warehouse -> [resource, quantity, low-stock threshold]
const stock: Record<string, [string, number, number][]> = {
  "Kalamassery State Relief Warehouse": [
    ["Drinking Water", 40000, 8000], ["Water Purification Tablets", 3000, 500], ["Rice", 12000, 2000], ["Pulses (Dal)", 2500, 500],
    ["Cooking Oil", 1200, 300], ["Ready-to-Eat Meal", 6000, 1500], ["Infant Formula", 150, 120], ["ORS Sachets", 8000, 1500],
    ["First Aid Kit", 300, 60], ["Essential Medicines Kit", 12, 4], ["Blanket", 2500, 500], ["Sleeping Mat", 1800, 400],
    ["Mosquito Net", 1500, 300], ["Family Hygiene Kit", 900, 200], ["Bathing Soap 250 g", 4000, 800], ["Menstrual Hygiene Pack", 1200, 250],
  ],
  "Khordha Regional Relief Depot": [
    ["Drinking Water", 50000, 10000], ["Rice", 15000, 3000], ["Pulses (Dal)", 3000, 600], ["Cooking Oil", 1500, 300],
    ["Ready-to-Eat Meal", 9000, 2000], ["Tarpaulin Sheet 4x6 m", 4000, 800], ["Family Tent", 300, 80], ["Solar Lantern", 2000, 400],
    ["Water Jerrycan 20 L", 3000, 600], ["First Aid Kit", 500, 100], ["Insulin Vials", 40, 50], ["ORS Sachets", 6000, 1200],
    ["Family Hygiene Kit", 1500, 300],
  ],
  "North Lakhimpur District Store": [
    ["Drinking Water", 12000, 4000], ["Water Purification Tablets", 5000, 800], ["Rice", 6000, 1500], ["Ready-to-Eat Meal", 2500, 800],
    ["Family Tent", 70, 80], ["Tarpaulin Sheet 4x6 m", 900, 250], ["Blanket", 1200, 300], ["Mosquito Net", 2000, 400],
    ["ORS Sachets", 3000, 600], ["Solar Lantern", 150, 200],
  ],
  "Rampur Bushahr Mountain Depot": [
    ["Blanket", 1500, 300], ["Family Tent", 150, 40], ["Sleeping Mat", 600, 150], ["Rice", 2500, 600],
    ["Ready-to-Eat Meal", 1500, 400], ["First Aid Kit", 120, 40], ["Drinking Water", 6000, 1500],
  ],
  "Ambattur Relief Warehouse": [
    ["Drinking Water", 25000, 6000], ["Ready-to-Eat Meal", 5000, 1200], ["Rice", 5000, 1000], ["Blanket", 1000, 250],
    ["Sleeping Mat", 900, 200], ["ORS Sachets", 4000, 800], ["Bathing Soap 250 g", 3000, 600], ["Family Hygiene Kit", 600, 150],
    ["Menstrual Hygiene Pack", 800, 200], ["Water Jerrycan 20 L", 1200, 300],
  ],
};
type Outcome = "PENDING" | "APPROVED" | "REJECTED" | "ALLOCATED" | "IN_TRANSIT" | "DELIVERED";
// camp, disaster, days ago, need within (h), level, score, medical, remarks, [resource, qty][], outcome, raised by
const requests: [string, string, number, number, string, number, boolean, string, [string, number][], Outcome, string][] = [
  ["Paravur Government School Camp", "Periyar River Floods", 9, 24, "CRITICAL", 95, true, "Diarrhoea cases among children after wells were flooded. ORS and safe water for 760 people for 2 days (7.5 L per person per day).", [["ORS Sachets", 1500], ["Drinking Water", 11400], ["Water Purification Tablets", 400]], "DELIVERED", "Neha Kulkarni"],
  ["Kochi Regional Sports Centre Shelter", "Periyar River Floods", 8, 36, "HIGH", 82, false, "1,120 people arrived without bedding: one blanket and one sleeping mat per person.", [["Blanket", 1120], ["Sleeping Mat", 1120]], "IN_TRANSIT", "Neha Kulkarni"],
  ["Paravur Government School Camp", "Periyar River Floods", 3, 48, "HIGH", 76, false, "Dry rations for one week (0.4 kg rice and 0.06 kg dal per person per day).", [["Rice", 2100], ["Pulses (Dal)", 320], ["Cooking Oil", 130]], "ALLOCATED", "Neha Kulkarni"],
  ["Kochi Regional Sports Centre Shelter", "Periyar River Floods", 1, 72, "MEDIUM", 58, false, "Monthly hygiene items: one family kit per five people and menstrual hygiene packs.", [["Family Hygiene Kit", 224], ["Menstrual Hygiene Pack", 300]], "PENDING", "Neha Kulkarni"],
  ["Gopalpur Cyclone Shelter", "Cyclone Tara", 6, 12, "CRITICAL", 98, false, "Shelter full with 1,000 evacuees: ready-to-eat meals for 48 hours (3 per day) and drinking water.", [["Ready-to-Eat Meal", 6000], ["Drinking Water", 15000]], "DELIVERED", "Faisal Ahmed"],
  ["Berhampur University Hostel Camp", "Cyclone Tara", 5, 24, "CRITICAL", 92, false, "Roofs of 86 nearby houses blown off: two tarpaulins per household, solar lanterns and tents for the worst-hit families.", [["Tarpaulin Sheet 4x6 m", 172], ["Solar Lantern", 86], ["Family Tent", 20]], "IN_TRANSIT", "Faisal Ahmed"],
  ["Gopalpur Cyclone Shelter", "Cyclone Tara", 4, 12, "CRITICAL", 96, true, "Twelve diabetic evacuees missed insulin doses after the pharmacy was destroyed; cold-chain transport needed. Also first aid kits.", [["Insulin Vials", 60], ["First Aid Kit", 40]], "ALLOCATED", "Faisal Ahmed"],
  ["Silapathar Higher Secondary School Camp", "Dhemaji Flash Floods", 11, 24, "HIGH", 85, false, "Camp water supply contaminated: treatment tablets, 2 days of drinking water and two jerrycans per family (103 families).", [["Water Purification Tablets", 600], ["Drinking Water", 7700], ["Water Jerrycan 20 L", 206]], "DELIVERED", "Faisal Ahmed"],
  ["Silapathar Higher Secondary School Camp", "Dhemaji Flash Floods", 2, 48, "HIGH", 74, false, "Malaria risk after flooding: one mosquito net per two people, plus ORS.", [["Mosquito Net", 260], ["ORS Sachets", 500]], "APPROVED", "Faisal Ahmed"],
  ["Nichar Community Hall Shelter", "Nichar Landslide", 7, 24, "HIGH", 80, false, "Night temperatures near 0 °C: two blankets per person for 140 people and tents for families whose houses are unsafe.", [["Blanket", 280], ["Family Tent", 12]], "DELIVERED", "Neha Kulkarni"],
  ["Nichar Community Hall Shelter", "Nichar Landslide", 2, 96, "MEDIUM", 52, false, "Weekly rations and first-aid restock while the highway is being cleared.", [["Rice", 400], ["Ready-to-Eat Meal", 300], ["First Aid Kit", 10]], "PENDING", "Neha Kulkarni"],
  ["Nagpur Civil Lines Cooling Centre", "Vidarbha Heatwave", 4, 18, "HIGH", 79, true, "Heat-exhaustion cases among outdoor workers: ORS and drinking water for walk-in visitors.", [["ORS Sachets", 2000], ["Drinking Water", 4000]], "APPROVED", "Faisal Ahmed"],
  ["Velachery Corporation School Shelter", "Chennai Urban Flooding", 3, 24, "HIGH", 77, false, "320 residents from flooded ground-floor homes: meals for 2 days and bedding.", [["Ready-to-Eat Meal", 1920], ["Blanket", 320], ["Sleeping Mat", 320]], "ALLOCATED", "Neha Kulkarni"],
  ["Velachery Corporation School Shelter", "Chennai Urban Flooding", 1, 48, "LOW", 35, false, "Raised twice by mistake: duplicate of the bedding request.", [["Blanket", 320]], "REJECTED", "Neha Kulkarni"],
];
// number, type, capacity (kg), status, home depot
const vehicles: [string, string, number, string, string][] = [
  ["KL-07-RF-2101", "TRUCK", 9000, "AVAILABLE", "Kalamassery Logistics Hub"],
  ["KL-41-RF-2102", "MINI_TRUCK", 3500, "AVAILABLE", "Kalamassery Logistics Hub"],
  ["OD-07-RF-3101", "TRUCK", 12000, "AVAILABLE", "Khordha Relief Depot"],
  ["OD-05-RF-3103", "MINI_TRUCK", 4000, "AVAILABLE", "Khordha Relief Depot"],
  ["OD-02-RF-3102", "TRUCK", 12000, "MAINTENANCE", "Khordha Relief Depot"],
  ["AS-22-RF-4101", "TRUCK", 10000, "AVAILABLE", "North Lakhimpur Store"],
  ["HP-25-RF-5101", "4X4_PICKUP", 1500, "AVAILABLE", "Rampur Bushahr Depot"],
  ["TN-02-RF-6101", "VAN", 1200, "AVAILABLE", "Ambattur Depot"],
];
// drivers and the depot they work from
const driverHome: Record<string, string> = {
  "Ramesh Pillai": "Kalamassery Logistics Hub",
  "Sanjay Behera": "Khordha Relief Depot",
  "Pradeep Nayak": "Khordha Relief Depot",
  "Bijoy Saikia": "North Lakhimpur Store",
  "Mohan Thakur": "Rampur Bushahr Depot",
  "Karthik Subramanian": "Ambattur Depot",
};
const volunteers: [string, string, string][] = [
  ["Anjali Varghese", "+91 90000 10001", "First aid, Malayalam"],
  ["Rahul Krishnan", "+91 90000 10002", "Logistics, heavy-vehicle licence"],
  ["Deepa Mohan", "+91 90000 10003", "Child protection, counselling"],
  ["Subhashree Panda", "+91 90000 20001", "Shelter setup, Odia"],
  ["Manoj Sahu", "+91 90000 20002", "Electrical, solar lanterns"],
  ["Pallabi Gogoi", "+91 90000 30001", "Water purification, Assamese"],
  ["Ranjit Bora", "+91 90000 30002", "Boat handling"],
  ["Karan Negi", "+91 90000 40001", "Mountain rescue"],
  ["Shalini Verma", "+91 90000 50001", "Nursing"],
  ["Lakshmi Narayanan", "+91 90000 60001", "Community kitchen, Tamil"],
  ["Imran Shaikh", "+91 90000 60002", "Loading and warehouse work"],
  ["Tsering Dolma", "+91 90000 40002", "Cold-weather logistics"],
];
const staff: [string, string][] = [
  ["Priya Raghavan", "RELIEF_COORDINATOR"],
  ["Arvind Hegde", "RELIEF_COORDINATOR"],
  ["Neha Kulkarni", "FIELD_OFFICER"],
  ["Faisal Ahmed", "FIELD_OFFICER"],
  ["Ramesh Pillai", "DRIVER"],
  ["Bijoy Saikia", "DRIVER"],
  ["Sanjay Behera", "DRIVER"],
  ["Mohan Thakur", "DRIVER"],
  ["Pradeep Nayak", "DRIVER"],
  ["Karthik Subramanian", "DRIVER"],
];
const emailOf = (name: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${DOMAIN}`;
// disaster, type, severity, description, tags, location label, [lat, lon], reporter, status
const incidents: [string, string, string, string, string[], string, [number, number] | null, string, string][] = [
  ["Periyar River Floods", "DAMAGE", "HIGH", "Floodwater breached the bund near Paravur market overnight; three wards submerged and the main road is impassable for trucks.", ["embankment", "road-closure"], "Paravur Town", [10.1517, 76.229], "Neha Kulkarni", "MONITORING"],
  ["Periyar River Floods", "MEDICAL", "CRITICAL", "Cluster of acute diarrhoea among children at the school camp; drinking water came from a flooded open well.", ["waterborne", "children", "outbreak"], "Paravur Government School Camp", null, "Neha Kulkarni", "OPEN"],
  ["Periyar River Floods", "SUPPLY", "MODERATE", "Infant formula at the school camp will last less than two days at the current rate of use.", ["infant", "shortage"], "Paravur Government School Camp", null, "Neha Kulkarni", "OPEN"],
  ["Periyar River Floods", "SAFETY", "HIGH", "A power line fell into floodwater beside the sports centre shelter; electricity board informed and area cordoned off.", ["electrical", "hazard"], "Kochi Regional Sports Centre Shelter", null, "Neha Kulkarni", "RESOLVED"],
  ["Periyar River Floods", "GENERAL", "LOW", "Volunteers started a community kitchen serving two hot meals a day to about 600 people.", ["kitchen", "volunteers"], "Ernakulam District", null, "Neha Kulkarni", "RESOLVED"],
  ["Cyclone Tara", "DAMAGE", "CRITICAL", "Storm surge destroyed thatched houses along the Gopalpur coast; the roof of the primary school was torn off.", ["storm-surge", "roof-damage"], "Gopalpur Coast", [19.2586, 84.9052], "Faisal Ahmed", "MONITORING"],
  ["Cyclone Tara", "MEDICAL", "CRITICAL", "Twelve diabetic evacuees have missed insulin doses; the local pharmacy stock was destroyed and cold storage is needed.", ["insulin", "diabetes", "cold-chain"], "Gopalpur Cyclone Shelter", null, "Faisal Ahmed", "OPEN"],
  ["Cyclone Tara", "SAFETY", "HIGH", "Uprooted trees are blocking the highway to Gopalpur; the relief convoy was delayed by four hours.", ["road-closure", "convoy"], "Ganjam District", null, "Faisal Ahmed", "MONITORING"],
  ["Cyclone Tara", "GENERAL", "MODERATE", "Power outage across the district; shelters are relying on lanterns and one diesel generator.", ["power-outage", "lighting"], "Berhampur University Hostel Camp", null, "Faisal Ahmed", "OPEN"],
  ["Dhemaji Flash Floods", "DAMAGE", "CRITICAL", "Villages along the Jiadhal are cut off; boats are needed to reach families sheltering on raised platforms.", ["boat", "stranded"], "Silapathar Riverbank", [27.5974, 94.722], "Faisal Ahmed", "MONITORING"],
  ["Dhemaji Flash Floods", "MEDICAL", "HIGH", "Skin infections and fever reported among people who waded through floodwater for several days.", ["infection", "fever"], "Silapathar Higher Secondary School Camp", null, "Faisal Ahmed", "OPEN"],
  ["Dhemaji Flash Floods", "SUPPLY", "HIGH", "The piped water supply at the camp is contaminated; purification tablets and bottled water are needed.", ["water", "contamination"], "Silapathar Higher Secondary School Camp", null, "Faisal Ahmed", "RESOLVED"],
  ["Dhemaji Flash Floods", "SAFETY", "MODERATE", "Snakes seen inside the school building after water entered the ground floor.", ["wildlife", "snake"], "Silapathar Higher Secondary School Camp", null, "Faisal Ahmed", "OPEN"],
  ["Nichar Landslide", "DAMAGE", "HIGH", "New cracks appeared in houses on the upper slope; twelve more families were asked to move to the shelter.", ["cracks", "relocation"], "Nichar Village", [31.568, 77.958], "Neha Kulkarni", "MONITORING"],
  ["Nichar Landslide", "SAFETY", "HIGH", "Night temperatures fell close to freezing; elderly residents in the hall are at risk of hypothermia.", ["cold", "elderly"], "Nichar Community Hall Shelter", null, "Neha Kulkarni", "OPEN"],
  ["Nichar Landslide", "SUPPLY", "MODERATE", "Blankets received; tents are still needed for families waiting for temporary housing.", ["blankets", "tents"], "Nichar Community Hall Shelter", null, "Neha Kulkarni", "RESOLVED"],
  ["Vidarbha Heatwave", "MEDICAL", "HIGH", "Forty construction workers treated for heat exhaustion at the cooling centre today.", ["heat-exhaustion", "workers"], "Nagpur Civil Lines Cooling Centre", [21.1458, 79.0882], "Faisal Ahmed", "OPEN"],
  ["Vidarbha Heatwave", "SUPPLY", "MODERATE", "The water tanker schedule broke down; residents are queuing for hours in the afternoon heat.", ["water", "tanker"], "Nagpur City", null, "Faisal Ahmed", "MONITORING"],
  ["Chennai Urban Flooding", "DAMAGE", "MODERATE", "Ground-floor homes in two streets flooded up to one metre; residents moved to the corporation school.", ["urban-flooding", "evacuation"], "Velachery Ward", [12.9815, 80.218], "Neha Kulkarni", "MONITORING"],
  ["Chennai Urban Flooding", "GENERAL", "LOW", "Awareness session on safe drinking water and ORS use held for families at the shelter.", ["awareness", "ors"], "Velachery Corporation School Shelter", null, "Neha Kulkarni", "RESOLVED"],
];

async function main() {
  const { pool } = await import("../src/lib/postgres");
  const c = await pool.connect();
  let adminId = 0;
  try {
    await c.query(readFileSync("db/postgres/002_seed.sql", "utf8")); // roles + catalogue (idempotent)
    if ((await c.query("SELECT 1 FROM disasters WHERE description LIKE $1 LIMIT 1", [`%${MARK}%`])).rowCount) {
      console.log("Sample dataset already present — nothing changed.");
      return;
    }
    await c.query("BEGIN");
    const admin = (await c.query(`SELECT user_id FROM app_users u JOIN roles r USING (role_id) WHERE r.role_name = 'ADMIN' AND u.is_active ORDER BY user_id LIMIT 1`)).rows[0];
    if (!admin) throw new Error("No active administrator. Run npm run db:admin first.");
    adminId = admin.user_id;
    await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(adminId)]);
    const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
    const one = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0];

    const user: Record<string, number> = {};
    for (const [name, role] of staff) {
      const r = await one(
        `INSERT INTO app_users(role_id, full_name, email, password_hash) SELECT role_id, $1, $2, 'REPLACE_WITH_ARGON2_HASH' FROM roles WHERE role_name = $3
         ON CONFLICT (email) DO NOTHING RETURNING user_id`,
        [name, emailOf(name), role],
      );
      user[name] = r?.user_id ?? (await one("SELECT user_id FROM app_users WHERE email = $1", [emailOf(name)])).user_id;
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
          [name, type, sev, daysAgo, `${desc} ${MARK}`, user["Priya Raghavan"], loc[at]],
        )
      ).disaster_id;
    for (const [d, l, impact, pop] of affects)
      await q(`INSERT INTO disaster_locations(disaster_id, location_id, impact_level, affected_population, reported_at) VALUES ($1,$2,$3,$4, now() - interval '2 days')`, [dis[d], loc[l], impact, pop]);
    const camp: Record<string, number> = {};
    for (const [i, [name, l, cap, pop]] of camps.entries())
      camp[name] = (
        await one(
          `INSERT INTO relief_camps(location_id, camp_name, capacity, current_population, manager_id, status, established_at)
           VALUES ($1,$2,$3::int,$4::int,$5, CASE WHEN $4::int >= $3::int THEN 'FULL' ELSE 'OPEN' END, current_date - 9) RETURNING camp_id`,
          [loc[l], name, cap, pop, user[i % 2 ? "Arvind Hegde" : "Priya Raghavan"]],
        )
      ).camp_id;
    const wh: Record<string, number> = {};
    for (const [i, [name, l, cap]] of warehouses.entries())
      wh[name] = (await one(`INSERT INTO warehouses(location_id, warehouse_name, manager_id, capacity, status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING warehouse_id`, [loc[l], name, user[i % 2 ? "Arvind Hegde" : "Priya Raghavan"], cap])).warehouse_id;
    const res: Record<string, number> = Object.fromEntries((await q(`SELECT resource_name, resource_id FROM resources`)).map((r) => [r.resource_name, r.resource_id]));
    for (const lines of Object.values(stock)) for (const [r] of lines) if (!res[r]) throw new Error(`Unknown resource ${r}`);

    await c.query("SELECT set_config('reliefflow.reason', 'Opening stock (sample data)', true)");
    for (const [w, lines] of Object.entries(stock))
      for (const [r, qty, min] of lines) await q(`INSERT INTO inventory(warehouse_id, resource_id, quantity_available, minimum_threshold) VALUES ($1,$2,$3,$4)`, [wh[w], res[r], qty, min]);
    await q(`UPDATE inventory_movements SET created_at = now() - ((movement_id % 11) + 3) * interval '1 day' WHERE reason = 'Opening stock (sample data)'`);

    const veh: { id: number; home: number }[] = [];
    for (const [num, type, cap, status, home] of vehicles) {
      const id = (await one(`INSERT INTO vehicles(vehicle_number, vehicle_type, capacity, status, current_location_id) VALUES ($1,$2,$3,$4,$5) RETURNING vehicle_id`, [num, type, cap, status, loc[home]])).vehicle_id;
      if (status === "AVAILABLE") veh.push({ id, home: loc[home] });
    }
    const vol: number[] = [];
    for (const [name, phone, skills] of volunteers)
      vol.push((await one(`INSERT INTO volunteers(full_name, phone, skills, registered_at) VALUES ($1,$2,$3, now() - interval '15 days') RETURNING volunteer_id`, [name, phone, skills])).volunteer_id);

    // the nearest active warehouse that can cover the whole line
    const pick = (resourceId: number, qty: number, campId: number) =>
      one(`SELECT i.warehouse_id, w.location_id FROM inventory i JOIN warehouses w USING (warehouse_id) JOIN locations wl ON wl.location_id = w.location_id,
                  relief_camps c JOIN locations cl ON cl.location_id = c.location_id
            WHERE i.resource_id = $1 AND i.quantity_available >= $2 AND w.status = 'ACTIVE' AND c.camp_id = $3
            ORDER BY power(wl.latitude - cl.latitude, 2) + power(wl.longitude - cl.longitude, 2) LIMIT 1`, [resourceId, qty, campId]);
    const busy = async (col: "driver_id" | "vehicle_id", id: number) =>
      Boolean(await one(`SELECT 1 AS x FROM deliveries WHERE ${col} = $1 AND status IN ('PLANNED','IN_TRANSIT','DELAYED')`, [id]));
    const coord = new Map(locations.map(([name, , , lat, lon]) => [loc[name], [lat, lon] as const]));
    const dist = (a: number, b: number) => { const [p, q2] = [coord.get(a)!, coord.get(b)!]; return (p[0] - q2[0]) ** 2 + (p[1] - q2[1]) ** 2; };
    const drivers = Object.entries(driverHome).map(([name, home]) => ({ id: user[name], home: loc[home] }));
    // the free driver and the free vehicle based nearest to the pickup depot
    const nearestFree = async <T extends { id: number; home: number }>(list: T[], col: "driver_id" | "vehicle_id", from: number) => {
      for (const x of [...list].sort((a, b) => dist(a.home, from) - dist(b.home, from))) if (!(await busy(col, x.id))) return x.id;
      return null;
    };
    let n = 0;
    for (const [campName, disName, daysAgo, needIn, level, score, medical, remarks, items, outcome, by] of requests) {
      const rr = await one(
        `INSERT INTO resource_requests(camp_id, disaster_id, requested_by, requested_at, need_by, priority_score, priority_level, medical_emergency, remarks)
         VALUES ($1,$2,$3, now() - make_interval(days => $4), now() - make_interval(days => $4) + make_interval(hours => $5), $6,$7,$8,$9) RETURNING request_id`,
        [camp[campName], dis[disName], user[by], daysAgo, needIn, score, level, medical, remarks],
      );
      for (const [r, qty] of items) await q(`INSERT INTO request_items(request_id, resource_id, quantity_requested) VALUES ($1,$2,$3)`, [rr.request_id, res[r], qty]);
      if (outcome === "PENDING") continue;
      await q(`UPDATE resource_requests SET status = $1 WHERE request_id = $2`, [outcome === "REJECTED" ? "REJECTED" : "APPROVED", rr.request_id]);
      if (outcome === "REJECTED" || outcome === "APPROVED") continue;
      // one allocation per pickup location (a delivery has one source)
      const groups = new Map<number, { warehouse_id: number; resource_id: number; qty: number }[]>();
      for (const [r, qty] of items) {
        const src = await pick(res[r], qty, camp[campName]);
        if (src) groups.set(src.location_id, [...(groups.get(src.location_id) ?? []), { warehouse_id: src.warehouse_id, resource_id: res[r], qty }]);
      }
      for (const lines of groups.values()) {
        const coordinator = user[n % 2 ? "Arvind Hegde" : "Priya Raghavan"];
        const a = await one(
          `INSERT INTO allocations(request_id, allocated_by, allocated_at, remarks) VALUES ($1,$2, now() - make_interval(days => $3) + interval '5 hours', 'Allocated from the nearest warehouse with full cover') RETURNING allocation_id`,
          [rr.request_id, coordinator, daysAgo],
        );
        await c.query("SELECT set_config('reliefflow.reason', $1, true)", [`Allocation #${a.allocation_id}`]);
        for (const l of lines.sort((x, y) => x.warehouse_id - y.warehouse_id || x.resource_id - y.resource_id))
          await q(`INSERT INTO allocation_items(allocation_id, request_id, resource_id, warehouse_id, quantity_allocated) VALUES ($1,$2,$3,$4,$5)`, [a.allocation_id, rr.request_id, l.resource_id, l.warehouse_id, l.qty]);
        await q(`UPDATE inventory_movements SET created_at = now() - make_interval(days => $1) + interval '5 hours' WHERE reason = $2`, [daysAgo, `Allocation #${a.allocation_id}`]);
        if (outcome === "ALLOCATED") continue;
        const src = await one(`SELECT w.location_id FROM allocation_items ai JOIN warehouses w USING (warehouse_id) WHERE allocation_id = $1 LIMIT 1`, [a.allocation_id]);
        const driver = await nearestFree(drivers, "driver_id", src.location_id);
        const vehicle = await nearestFree(veh, "vehicle_id", src.location_id);
        n++;
        if (!driver || !vehicle) continue;
        const d = await one(
          `INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id, expected_arrival)
           SELECT $1,$2,$3,$4, location_id, now() - make_interval(days => $6) + interval '20 hours' FROM relief_camps WHERE camp_id = $5 RETURNING delivery_id`,
          [a.allocation_id, vehicle, driver, src.location_id, camp[campName], Math.max(daysAgo - 1, 0)],
        );
        await q(`UPDATE vehicles SET status = 'IN_USE' WHERE vehicle_id = $1`, [vehicle]);
        for (const helper of [vol[(2 * n) % vol.length], vol[(2 * n + 1) % vol.length]])
          if (await one(`UPDATE volunteers SET availability_status = 'ASSIGNED' WHERE volunteer_id = $1 AND availability_status = 'AVAILABLE' RETURNING 1 AS x`, [helper]))
            await q(`INSERT INTO delivery_volunteers(delivery_id, volunteer_id, assigned_role) VALUES ($1,$2,$3)`, [d.delivery_id, helper, helper === vol[(2 * n) % vol.length] ? "LOADING_SUPPORT" : "DISTRIBUTION"]);
        await q(`UPDATE deliveries SET status = 'IN_TRANSIT', departure_time = now() - make_interval(days => $2) + interval '8 hours' WHERE delivery_id = $1`, [d.delivery_id, Math.max(daysAgo - 1, 0)]);
        await q(`UPDATE allocations SET status = 'IN_TRANSIT' WHERE allocation_id = $1`, [a.allocation_id]);
        if (outcome === "DELIVERED") {
          await q(`UPDATE deliveries SET status = 'DELIVERED', actual_arrival = departure_time + interval '7 hours' WHERE delivery_id = $1`, [d.delivery_id]);
          await q(`UPDATE allocations SET status = 'DELIVERED' WHERE allocation_id = $1`, [a.allocation_id]);
          await q(`UPDATE vehicles SET status = 'AVAILABLE', current_location_id = (SELECT location_id FROM relief_camps WHERE camp_id = $2) WHERE vehicle_id = $1`, [vehicle, camp[campName]]);
          await q(`UPDATE volunteers SET availability_status = 'AVAILABLE' WHERE volunteer_id IN (SELECT volunteer_id FROM delivery_volunteers WHERE delivery_id = $1)`, [d.delivery_id]);
        }
      }
      await c.query("CALL refresh_request_status($1)", [rr.request_id]);
    }
    await q(`UPDATE disasters SET status = 'CONTAINED' WHERE disaster_id = $1`, [dis["Vidarbha Heatwave"]]);
    await q(`INSERT INTO audit_logs(user_id, action, details) VALUES ($1, 'SAMPLE_DATA_LOADED', $2)`, [adminId, JSON.stringify({ marker: MARK, disasters: disasters.length, requests: requests.length })]);
    await c.query("COMMIT");
    console.log(`PostgreSQL: ${disasters.length} disasters, ${camps.length} camps, ${warehouses.length} warehouses, ${requests.length} requests, ${staff.length} sample staff.`);

    const { getMongoDb } = await import("../src/lib/mongodb");
    const col = (await getMongoDb()).collection("incident_reports");
    if (!(await col.countDocuments({ source: "sample-data" }))) {
      const docs = incidents.map(([d, type, sev, text, tags, label, coords, by, status], i) => {
        const days = disasters.find((x) => x[0] === d)![3];
        const at = new Date(Date.now() - Math.max(days - 1 - (i % 3), 0) * 86400000 - (i % 5) * 3600000);
        return {
          disasterId: Number(dis[d]),
          reportedBy: Number(user[by]),
          reporterName: by,
          reportType: type,
          description: text,
          location: coords ? { label, latitude: coords[0], longitude: coords[1] } : { label },
          severity: sev,
          tags,
          status,
          updates: status !== "OPEN" ? [{ note: status === "RESOLVED" ? "Issue resolved and verified by the field team." : "Field team on site; situation being monitored.", by: Number(user["Priya Raghavan"]), byName: "Priya Raghavan", at: new Date(at.getTime() + 5 * 3600000) }] : [],
          source: "sample-data",
          createdAt: at,
          updatedAt: at,
        };
      });
      await col.insertMany(docs);
      console.log(`MongoDB: ${docs.length} incident reports.`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }

  // derived stores: rebuilt from the new data (optional services are skipped if not configured)
  const { syncVectors } = await import("../src/lib/vector");
  const { syncGraph } = await import("../src/lib/graph");
  const { cacheInvalidate } = await import("../src/lib/cache");
  for (const [name, fn] of [["pgvector", syncVectors], ["Neo4j", syncGraph]] as const) {
    try {
      const r = await fn(String(adminId));
      console.log(`${name}: synced`, JSON.stringify(r).slice(0, 160));
    } catch (e) {
      console.log(`${name}: skipped (${(e as Error).message})`);
    }
  }
  await cacheInvalidate("rf:cache:").catch(() => undefined);
  const { getMongoClient } = await import("../src/lib/mongodb");
  await (await getMongoClient()).close(); // after the vector sync, which reads incidents from MongoDB
  await pool.end();
  process.exit(0);
}
main().catch((e) => {
  console.error("Sample dataset failed (no PostgreSQL changes committed):", e.code ?? "", e.message);
  process.exit(1);
});
