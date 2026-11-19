import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { Pool } from "pg";
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { hash,compare } from "bcryptjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { labUrl } from "../src/lib/lab/sandbox";
const dbName = `reliefflow_test_${Date.now()}`;
const connection = new URL(process.env.DATABASE_URL!);
const admin = new Pool({ connectionString: connection.toString() });
connection.pathname = "/" + dbName;
const db = new Pool({ connectionString: connection.toString() });
const mongo = new MongoClient(process.env.MONGODB_URI!);
const base = "http://localhost:3107";
let server: ReturnType<typeof spawn> | undefined;
const results: { test: string; status: string }[] = [];
let cookie = "";
let serverLog = "";
async function call(
  path: string,
  body?: unknown,
  method = "POST",
  session = cookie,
) {
  const r = await fetch(base + path, {
    method: body === undefined && method !== "DELETE" ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: session } : {}),
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return {
    status: r.status,
    data,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function ok(
  path: string,
  body?: unknown,
  method = "POST",
  session = cookie,
) {
  const r = await call(path, body, method, session);
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  results.push({ test: name, status: "PASS" });
  console.log("PASS", name);
}
async function main() {
  mkdirSync("docs/screenshots", { recursive: true });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await mongo.connect();
  await mongo.db(dbName).createCollection('incident_reports',{validator:JSON.parse(readFileSync('db/mongodb/validator.json','utf8')),validationLevel:'moderate',validationAction:'error'});
  for (const file of ["001_schema.sql","002_seed.sql"])
    await db.query(readFileSync(`db/postgres/${file}`, "utf8"));
  // 002_seed.sql holds reference data only, so the fixtures bring their own locations.
  await db.query("INSERT INTO locations(location_name,location_type,address,latitude,longitude) VALUES ('Test District','DISTRICT','Test fixtures',12.9716,77.5946),('Test Camp Area','CAMP_AREA','Test fixtures',13.1007,77.5963)");
  // Simulate duplicate records that predate migration; their status must remain editable.
  await db.query("INSERT INTO warehouses(location_id,warehouse_name,capacity) SELECT (SELECT location_id FROM locations LIMIT 1),'Legacy Depot',10 FROM generate_series(1,2)");
  await db.query("INSERT INTO disasters(disaster_name,disaster_type,severity,started_at,created_by) SELECT 'Legacy Event','FLOOD','HIGH','2020-01-01T00:00:00Z',(SELECT user_id FROM app_users LIMIT 1) FROM generate_series(1,2)");
  for(const file of ['005_integrity_security.sql','006_allocation_history.sql','007_dbms_engineering.sql','008_rbac_dictionary.sql'])await db.query(readFileSync(`db/postgres/${file}`,'utf8'));
  await db.query("UPDATE warehouses SET warehouse_name=warehouse_name,status='MAINTENANCE' WHERE warehouse_name='Legacy Depot'");
  await db.query("UPDATE disasters SET disaster_name=disaster_name,status='CONTAINED' WHERE disaster_name='Legacy Event'");
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hash(password, 10);
  await db.query(
    `UPDATE app_users SET password_hash=$1 WHERE email='admin@reliefflow.local'`,
    [passwordHash],
  );
  await check('Administrator provisioning creates a usable account and preserves working credentials',async()=>{
    const provision=(email:string)=>spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/create-admin.ts'],{env:{...process.env,DATABASE_URL:connection.toString(),ADMIN_EMAIL:email,ADMIN_PASSWORD:password},encoding:'utf8',windowsHide:true});
    assert.equal(provision('admin@reliefflow.local').status,0);
    assert.equal((await db.query("SELECT password_hash FROM app_users WHERE email='admin@reliefflow.local'")).rows[0].password_hash,passwordHash);
    assert.equal(provision('bootstrap@test.local').status,0);
    assert(await compare(password,(await db.query("SELECT password_hash FROM app_users WHERE email='bootstrap@test.local'")).rows[0].password_hash));
  });
  for (const role of ["RELIEF_COORDINATOR", "FIELD_OFFICER", "DRIVER"])
    await db.query(
      `INSERT INTO app_users(role_id,full_name,email,password_hash) SELECT role_id,$1::text,$2,$3 FROM roles WHERE role_name=$1::text`,
      [role, `${role.toLowerCase()}@test.local`, passwordHash],
    );
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3107"],
    {
      env: {
        ...process.env,
        DATABASE_URL: connection.toString(),
        MONGODB_DB: dbName,
        COOKIE_SECURE: "false",
        // Isolation: optional services are disabled for the test server (exercises degraded mode);
        // they are tested live by scripts/services-test.ts. The lab uses the shared sandbox DB.
        REDIS_URL: "",
        NEO4J_URI: "",
        VECTOR_DATABASE_URL: "",
        LAB_DATABASE_URL: labUrl(),
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  server.stdout?.on("data", (d) => {
    serverLog += d;
  });
  server.stderr?.on("data", (d) => {
    serverLog += d;
  });
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (i === 89) throw new Error("Server startup failed: " + serverLog);
    await new Promise((r) => setTimeout(r, 500));
  }
  const login = await call("/api/auth", {
    email: "admin@reliefflow.local",
    password,
  });
  assert.equal(login.status, 200);
  cookie = login.cookie!;
  let fieldCookie = "",
    driverCookie = "",
    coordinatorCookie = "";
  await check(
    "Authentication: invalid credentials, cookie flags, role sessions and unauthenticated rejection",
    async () => {
      assert.equal(
        (
          await call(
            "/api/auth",
            { email: "admin@reliefflow.local", password: "wrong" },
            "POST",
            "",
          )
        ).status,
        401,
      );
      assert.equal(
        (await call("/api/disasters", undefined, "GET", "")).status,
        401,
      );
      assert.equal(
        (await call("/api/operations?kind=users", undefined, "GET", "")).status,
        401,
      );
      assert(!("token" in login.data));
      const response = await fetch(base + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@reliefflow.local", password }),
      });
      const header = response.headers.get("set-cookie")!;
      assert.match(header, /HttpOnly/i);
      assert.match(header, /SameSite=strict/i);
      fieldCookie = (
        await call("/api/auth", { email: "field_officer@test.local", password })
      ).cookie!;
      driverCookie = (
        await call("/api/auth", { email: "driver@test.local", password })
      ).cookie!;
      coordinatorCookie = (
        await call("/api/auth", {
          email: "relief_coordinator@test.local",
          password,
        })
      ).cookie!;
    },
  );
  const op = (kind: string, body?: unknown) =>
    ok("/api/operations?kind=" + kind, body);
  const locations = await op("locations");
  const location = Number(locations[0].location_id);
  let disaster = 0,
    camp = 0,
    warehouse = 0,
    request = 0,
    vehicle = 0,
    volunteer = 0,
    allocation = 0,
    delivery = 0;
  const resource = Number((await op("resources"))[0].resource_id);
  const event = {
    disaster_name: "Test Flood",
    disaster_type: "FLOOD",
    severity: "HIGH",
    started_at: "2026-10-31T12:00:00.000Z",
    event_location_id: location,
  };
  await check(
    "Disasters: create, normalized duplicate detection, distinct events, edit, malformed input",
    async () => {
      disaster = Number((await ok("/api/disasters", event)).disaster_id);
      assert.equal(
        (
          await call("/api/disasters", {
            ...event,
            disaster_name: " test flood ",
          })
        ).status,
        409,
      );
      await ok("/api/disasters", {
        ...event,
        started_at: "2026-10-30T12:00:00.000Z",
      });
      assert.equal((await call("/api/disasters", {})).status, 400);
      assert.equal((await call("/api/disasters", "{bad")).status, 400);
      await ok(
        "/api/disasters",
        { ...event, disaster_id: disaster, severity: "CRITICAL" },
        "PATCH",
      );
    },
  );
  await check(
    "Camps: create, update occupancy, reject negatives and over capacity, close empty camp",
    async () => {
      const d = {
        camp_name: "Test Camp",
        location_id: location,
        capacity: 100,
        current_population: 5,
        status: "OPEN",
      };
      camp = Number((await op("camps", d)).camp_id);
      for (const population of [-1, 101])
        assert.equal(
          (
            await call("/api/operations?kind=camps", {
              ...d,
              camp_id: camp,
              current_population: population,
            })
          ).status,
          400,
        );
      await op("camps", { ...d, camp_id: camp, current_population: 8 });
      const temporary = await op("camps", {
        ...d,
        camp_name: "Temporary",
        current_population: 0,
      });
      assert.equal((await call("/api/operations?kind=camps", { ...temporary, status: "CLOSED" })).status, 400, "unexpected fields rejected");
      await op("camps", { camp_id: temporary.camp_id, camp_name: "Temporary", location_id: location, capacity: 100, current_population: 0, status: "CLOSED" });
      assert.equal((await call("/api/operations?kind=camps", { ...d, camp_id: camp, current_population: 8, status: "CLOSED" })).status, 400, "cannot close a camp with occupants");
    },
  );
  await check(
    "Warehouses: create, duplicate detection, persistence, edit and status",
    async () => {
      const d = {
        warehouse_name: "Test Depot",
        location_id: location,
        capacity: 1000,
        status: "ACTIVE",
      };
      warehouse = Number((await op("warehouses", d)).warehouse_id);
      assert.equal(
        (
          await call("/api/operations?kind=warehouses", {
            ...d,
            warehouse_name: " test depot ",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call("/api/operations?kind=warehouses", {
            ...d,
            warehouse_name: "  ",
          })
        ).status,
        400,
      );
      await op("warehouses", {
        ...d,
        warehouse_id: warehouse,
        status: "MAINTENANCE",
      });
      await op("warehouses", {
        ...d,
        warehouse_id: warehouse,
        warehouse_name: "Updated Depot",
      });
      assert(
        (await op("warehouses")).some(
          (w: { warehouse_name: string }) =>
            w.warehouse_name === "Updated Depot",
        ),
      );
    },
  );
  await check(
    "Inventory: add, adjust, low stock, reject negatives, movement persistence",
    async () => {
      await op("inventory", {
        warehouse_id: warehouse,
        resource_id: resource,
        delta: 10,
        minimum_threshold: 15,
        reason: "Test intake",
      });
      assert((await op("inventory"))[0].low_stock);
      assert.equal(
        (
          await call("/api/operations?kind=inventory", {
            warehouse_id: warehouse,
            resource_id: resource,
            delta: -11,
            minimum_threshold: 0,
            reason: "Invalid removal",
          })
        ).status,
        409,
      );
      assert.equal(Number((await op("inventory"))[0].quantity_available), 10);
      assert((await op("movements")).length > 0);
    },
  );
  const requestBody = {
    camp_id: camp,
    disaster_id: disaster,
    need_by: new Date(Date.now() + 86400000).toISOString(),
    items: [{ resource_id: resource, quantity_requested: 8 }],
  };
  await check(
    "Requests: authenticated ownership, create, duplicate items, valid approval/rejection/cancellation",
    async () => {
      assert.equal((await call("/api/requests", { ...requestBody, requested_by: 999 }, "POST", fieldCookie)).status, 400, "client cannot set requested_by");
      const r = await ok("/api/requests", requestBody, "POST", fieldCookie);
      request = Number(r.request_id);
      assert.equal(
        String(r.requested_by),
        String((await ok("/api/auth", undefined, "GET", fieldCookie)).user_id),
      );
      assert.equal(
        (
          await call("/api/requests", {
            ...requestBody,
            items: [...requestBody.items, ...requestBody.items],
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/api/requests",
            { request_id: request, status: "DELIVERED" },
            "PATCH",
          )
        ).status,
        400,
      );
      await ok(
        "/api/requests",
        { request_id: request, status: "APPROVED" },
        "PATCH",
      );
      for (const status of ["REJECTED", "CANCELLED"]) {
        const r = await ok("/api/requests", requestBody);
        await ok(
          "/api/requests",
          { request_id: Number(r.request_id), status },
          "PATCH",
        );
      }
    },
  );
  await check(
    "Authorization: direct API calls for field officer, coordinator, driver and CSRF",
    async () => {
      assert.equal((await call('/api/operations?kind=__proto__')).status,404);
      assert.equal((await call('/api/operations?kind=toString',{})).status,404);
      assert.equal(
        (
          await call(
            "/api/operations?kind=warehouses",
            { warehouse_name: "Denied" },
            "POST",
            fieldCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            "/api/requests",
            { request_id: request, status: "APPROVED" },
            "PATCH",
            fieldCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await call("/api/disasters", event, "POST", driverCookie)).status,
        403,
      );
      assert.equal(
        (
          await call(
            "/api/operations?kind=users",
            undefined,
            "GET",
            coordinatorCookie,
          )
        ).status,
        403,
      );
      const r = await fetch(base + "/api/disasters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "https://untrusted.example",
        },
        body: JSON.stringify(event),
      });
      assert.equal(r.status, 403);
    },
  );
  await check(
    "Allocations: partial fulfillment, stock deduction, over-allocation and atomic rollback",
    async () => {
      allocation = Number(
        (
          await op("allocations", {
            request_id: request,
            items: [
              {
                warehouse_id: warehouse,
                resource_id: resource,
                quantity_allocated: 3,
              },
            ],
          })
        ).allocation_id,
      );
      assert.equal(Number((await op("inventory"))[0].quantity_available), 7);
      assert.equal(
        (
          await call("/api/operations?kind=allocations", {
            request_id: request,
            items: [
              {
                warehouse_id: warehouse,
                resource_id: resource,
                quantity_allocated: 6,
              },
            ],
          })
        ).status,
        409,
      );
      const before = (await op("allocations")).length;
      assert.equal(
        (
          await call("/api/operations?kind=allocations", {
            request_id: request,
            items: [
              {
                warehouse_id: warehouse,
                resource_id: resource,
                quantity_allocated: 1,
              },
              {
                warehouse_id: warehouse,
                resource_id: 999999,
                quantity_allocated: 1,
              },
            ],
          })
        ).status,
        409,
      );
      assert.equal((await op("allocations")).length, before);
      assert.equal(Number((await op("inventory"))[0].quantity_available), 7);
    },
  );
  await check(
    "Concurrent allocations: serialize outstanding demand, reject loser, preserve stock",
    async () => {
      const b = {
        request_id: request,
        items: [
          {
            warehouse_id: warehouse,
            resource_id: resource,
            quantity_allocated: 4,
          },
        ],
      };
      const responses = await Promise.all([
        call("/api/operations?kind=allocations", b),
        call("/api/operations?kind=allocations", b),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      assert.equal(Number((await op("inventory"))[0].quantity_available), 3);
      await op("allocations", {
        request_id: request,
        items: [
          {
            warehouse_id: warehouse,
            resource_id: resource,
            quantity_allocated: 1,
          },
        ],
      });
    },
  );
  await check(
    "Vehicles and volunteers: create, edit, validate unique identities",
    async () => {
      const v = {
        vehicle_number: "KA-TEST-01",
        vehicle_type: "TRUCK",
        capacity: 1000,
        status: "AVAILABLE",
      };
      vehicle = Number((await op("vehicles", v)).vehicle_id);
      assert.equal(
        (await call("/api/operations?kind=vehicles", v)).status,
        409,
      );
      const person = {
        full_name: "Test Volunteer",
        phone: "+919999111222",
        email: "volunteer@test.local",
        skills: "First aid",
        availability_status: "AVAILABLE",
      };
      volunteer = Number((await op("volunteers", person)).volunteer_id);
      await op("volunteers", {
        ...person,
        volunteer_id: volunteer,
        skills: "Logistics",
      });
    },
  );
  await check(
    "Delivery assignments: valid driver, vehicle, volunteers; reject double booking and invalid transitions",
    async () => {
      const driver = Number((await op("drivers"))[0].user_id);
      const body = {
        allocation_id: allocation,
        vehicle_id: vehicle,
        driver_id: driver,
        expected_arrival: new Date(Date.now() + 7200000).toISOString(),
        volunteer_ids: [volunteer],
      };
      assert.equal(
        (
          await call("/api/operations?kind=deliveries", {
            ...body,
            driver_id: 1,
          })
        ).status,
        409,
      );
      delivery = Number((await op("deliveries", body)).delivery_id);
      assert.equal(
        (await call("/api/operations?kind=deliveries", body)).status,
        409,
      );
      assert.equal(
        (
          await call("/api/operations?kind=delivery-status", {
            delivery_id: delivery,
            status: "DELIVERED",
          })
        ).status,
        409,
      );
      const own = await ok(
        "/api/operations?kind=deliveries",
        undefined,
        "GET",
        driverCookie,
      );
      assert.equal(own.length, 1);
      await ok(
        "/api/operations?kind=delivery-status",
        { delivery_id: delivery, status: "IN_TRANSIT" },
        "POST",
        driverCookie,
      );
      await ok(
        "/api/operations?kind=delivery-status",
        { delivery_id: delivery, status: "DELIVERED" },
        "POST",
        driverCookie,
      );
      assert.equal(
        (
          await call("/api/operations?kind=delivery-status", {
            delivery_id: delivery,
            status: "IN_TRANSIT",
          })
        ).status,
        409,
      );
      assert.equal((await op("vehicles"))[0].status, "AVAILABLE");
      assert.equal(
        (await op("volunteers"))[0].availability_status,
        "AVAILABLE",
      );
    },
  );
  await check(
    "Full delivery lifecycle fulfills request and driver ownership is enforced",
    async () => {
      const driver = Number((await op("drivers"))[0].user_id);
      const other = await op("users", {
        full_name: "Other Driver",
        email: "other-driver@test.local",
        password,
        role_name: "DRIVER",
      });
      const otherCookie = (
        await call("/api/auth", { email: "other-driver@test.local", password })
      ).cookie!;
      assert.deepEqual(
        await ok(
          "/api/operations?kind=deliveries",
          undefined,
          "GET",
          otherCookie,
        ),
        [],
      );
      for (const a of (await op("allocations")).filter(
        (a: { status: string }) => a.status === "ALLOCATED",
      )) {
        const d = await op("deliveries", {
          allocation_id: Number(a.allocation_id),
          vehicle_id: vehicle,
          driver_id: driver,
          expected_arrival: new Date(Date.now() + 7200000).toISOString(),
        });
        assert.equal(
          (
            await call(
              "/api/operations?kind=delivery-status",
              { delivery_id: Number(d.delivery_id), status: "IN_TRANSIT" },
              "POST",
              otherCookie,
            )
          ).status,
          404, // row-level security hides another driver's delivery entirely
        );
        await ok(
          "/api/operations?kind=delivery-status",
          { delivery_id: Number(d.delivery_id), status: "IN_TRANSIT" },
          "POST",
          driverCookie,
        );
        await ok(
          "/api/operations?kind=delivery-status",
          { delivery_id: Number(d.delivery_id), status: "DELAYED" },
          "POST",
          driverCookie,
        );
        await ok(
          "/api/operations?kind=delivery-status",
          { delivery_id: Number(d.delivery_id), status: "DELIVERED" },
          "POST",
          driverCookie,
        );
      }
      assert.equal(
        (
          await db.query(
            "SELECT status FROM resource_requests WHERE request_id=$1",
            [request],
          )
        ).rows[0].status,
        "DELIVERED",
      );
      assert(other.user_id);
    },
  );
  await check(
    "Shared-stock concurrency and cancellation restore stock exactly once",
    async () => {
      const requests: number[] = [];
      for (let i = 0; i < 2; i++) {
        const r = await ok("/api/requests", {
          ...requestBody,
          items: [{ resource_id: resource, quantity_requested: 2 }],
        });
        requests.push(Number(r.request_id));
        await ok(
          "/api/requests",
          { request_id: Number(r.request_id), status: "APPROVED" },
          "PATCH",
        );
      }
      const responses = await Promise.all(
        requests.map((request_id) =>
          call("/api/operations?kind=allocations", {
            request_id,
            items: [
              {
                warehouse_id: warehouse,
                resource_id: resource,
                quantity_allocated: 2,
              },
            ],
          }),
        ),
      );
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const allocated = responses.find((r) => r.status === 200)!.data;
      assert.equal(Number((await op("inventory"))[0].quantity_available), 0);
    const planned=await op('deliveries',{allocation_id:Number(allocated.allocation_id),vehicle_id:vehicle,driver_id:Number((await op('drivers'))[0].user_id),expected_arrival:new Date(Date.now()+7200000).toISOString(),volunteer_ids:[volunteer]});
    assert.equal((await call('/api/operations?kind=allocation-cancel',{allocation_id:Number(allocated.allocation_id)})).status,409);
    await op('delivery-status',{delivery_id:Number(planned.delivery_id),status:'CANCELLED'});
    assert.equal((await op('vehicles'))[0].status,'AVAILABLE');
      await op("allocation-cancel", {
        allocation_id: Number(allocated.allocation_id),
      });
      assert.equal(Number((await op("inventory"))[0].quantity_available), 2);
      assert.equal(
        (
          await call("/api/operations?kind=allocation-cancel", {
            allocation_id: Number(allocated.allocation_id),
          })
        ).status,
        409,
      );
      assert.equal(Number((await op("inventory"))[0].quantity_available), 2);
      await assert.rejects(
        db.query("DELETE FROM allocation_items WHERE allocation_id=$1", [
          allocated.allocation_id,
        ]),
      );
      await assert.rejects(
        db.query(
          "UPDATE inventory SET quantity_available=-1 WHERE warehouse_id=$1 AND resource_id=$2",
          [warehouse, resource],
        ),
      );
      await assert.rejects(
        db.query(
          "UPDATE relief_camps SET current_population=capacity+1 WHERE camp_id=$1",
          [camp],
        ),
      );
    },
  );
  await check(
    "MongoDB incidents: persist, authenticated author, validate references and required fields",
    async () => {
      const body: Record<string, unknown> = {
        disasterId: disaster,
        reportType: "DAMAGE",
        description: "Bridge damage requires urgent inspection.",
        location: { label: "Test bridge" },
        severity: "HIGH",
        reportedBy: 999,
      };
      assert.equal((await call("/api/incidents", body, "POST", fieldCookie)).status, 400, "client cannot set reportedBy");
      const { reportedBy: _ignored, ...clean } = body;
      void _ignored;
      const r = await ok("/api/incidents", { ...clean, tags: ["Bridge", "bridge", "road"] }, "POST", fieldCookie);
      assert.equal(String(r.reportedBy), String((await ok("/api/auth", undefined, "GET", fieldCookie)).user_id));
      assert.deepEqual(r.tags, ["bridge", "road"], "tags normalised and de-duplicated");
      assert.equal((await ok("/api/incidents")).total, 1);
      assert.equal((await ok("/api/incidents?q=bridge")).items.length, 1, "text index search");
      assert.equal((await ok("/api/incidents?q=volcano")).items.length, 0);
      assert.equal((await ok("/api/incidents?stats=1")).total[0].n, 1, "aggregation facets");
      const noted = await ok("/api/incidents", { id: String(r._id), note: "Inspection team on site", status: "MONITORING" }, "PATCH");
      assert.equal(noted.updates.length, 1);
      assert.equal(noted.status, "MONITORING");
      assert.equal((await call("/api/incidents", { id: "zzz", note: "x" }, "PATCH")).status, 400);
      assert.equal((await call("/api/incidents?severity=APOCALYPTIC")).status, 400);
      await mongo.connect();
      assert.equal(
        await mongo.db(dbName).collection("incident_reports").countDocuments(),
        1,
      );
      await assert.rejects(mongo.db(dbName).collection('incident_reports').insertOne({description:'Invalid direct database write'}));
      assert.equal(
        (await call("/api/incidents", { ...body, disasterId: 999999 })).status,
        400,
      );
      assert.equal(
        (await call("/api/incidents", { ...body, description: "" })).status,
        400,
      );
    },
  );
  await check(
    "Analytics and audit: compare live aggregates with SQL records",
    async () => {
      const d = await ok("/api/dashboard");
      const actual = (
        await db.query(`SELECT count(*) FROM disasters WHERE status='ACTIVE'`)
      ).rows[0].count;
      assert.equal(String(d.kpi.active_disasters), String(actual));
      assert.equal(d.stockByUnit.reduce((s: number, u: { available: number }) => s + Number(u.available), 0), 2);
      assert.equal(d.cache.hit, false);
      assert.equal((await ok("/api/dashboard")).cache.hit, true, "second read served from cache");
      await op("inventory", { warehouse_id: warehouse, resource_id: resource, delta: 1, minimum_threshold: 0, reason: "cache invalidation probe" });
      assert.equal((await ok("/api/dashboard")).cache.hit, false, "writes invalidate the cache");
      await op("inventory", { warehouse_id: warehouse, resource_id: resource, delta: -1, minimum_threshold: 0, reason: "revert probe" });
      assert((await op("audit")).length > 10);
      assert((await db.query("SELECT 1 FROM audit_logs WHERE action='DELIVERY_STATUS' AND details->'input'->>'delivery_id' IS NOT NULL AND details->'input'->>'status' IS NOT NULL")).rowCount!>0);
    },
  );
  await check(
    "Users: create, role assignment, revoke prior sessions",
    async () => {
      const u = await op("users", {
        full_name: "New User",
        email: "new@test.local",
        password,
        role_name: "FIELD_OFFICER",
      });
      const old = (
        await call("/api/auth", { email: "new@test.local", password })
      ).cookie!;
      await op("user-role", {
        user_id: Number(u.user_id),
        role_name: "DRIVER",
        is_active: true,
      });
      assert.equal(
        (await call("/api/auth", undefined, "GET", old)).status,
        401,
      );
    },
  );
  await check("Input hardening: malformed JSON, wrong content type, unexpected fields, invalid ids, huge numbers", async () => {
    assert.equal((await call("/api/operations?kind=camps", "{not json")).status, 400);
    assert.equal((await call("/api/operations?kind=camps", "[1,2]")).status, 400);
    const r = await fetch(base + "/api/requests", { method: "POST", headers: { "Content-Type": "text/plain", Cookie: cookie }, body: "x" });
    assert.equal(r.status, 415);
    assert.equal((await call("/api/disasters?id=abc")).status, 400);
    assert.equal((await call("/api/disasters?id=-5")).status, 400);
    assert.equal((await call("/api/disasters?id=999999")).status, 404);
    assert.equal((await call("/api/requests?id=0")).status, 400);
    assert.equal((await call("/api/operations?kind=inventory", { warehouse_id: warehouse, resource_id: resource, delta: 1e15, minimum_threshold: 0, reason: "huge" })).status, 400);
    assert.equal((await call("/api/operations?kind=allocations", { request_id: request, items: [{ warehouse_id: warehouse, resource_id: resource, quantity_allocated: 0 }] })).status, 400);
    assert.equal((await call("/api/operations?kind=allocations", { request_id: request, items: [{ warehouse_id: warehouse, resource_id: resource, quantity_allocated: -2 }] })).status, 400);
    const err = await call("/api/operations?kind=warehouses", { warehouse_name: "X", location_id: location, capacity: 1, status: "ACTIVE", hacked: true });
    assert.equal(err.status, 400);
    assert.equal(err.data.code, "VALIDATION_ERROR");
    assert.ok(err.data.requestId, "error responses carry a request id");
    assert.ok(!JSON.stringify(err.data).includes("relation"), "no raw database text leaks");
  });

  await check("Optimistic concurrency: stale camp edits and stale stock adjustments are rejected", async () => {
    const camps = await op("camps");
    const c = camps.find((x: { camp_id: string }) => Number(x.camp_id) === camp);
    const fields = { camp_id: camp, camp_name: c.camp_name, location_id: Number(c.location_id), capacity: Number(c.capacity), status: "OPEN" };
    await op("camps", { ...fields, current_population: 9, row_version: c.row_version });
    const stale = await call("/api/operations?kind=camps", { ...fields, current_population: 10, row_version: c.row_version });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, "STALE_RECORD");
    const inv = (await op("inventory"))[0];
    const staleStock = await call("/api/operations?kind=inventory", { warehouse_id: warehouse, resource_id: resource, delta: 1, minimum_threshold: 0, reason: "stale", expected_quantity: Number(inv.quantity_available) + 5 });
    assert.equal(staleStock.status, 409);
    assert.equal(staleStock.data.code, "STALE_RECORD");
  });

  await check("Camp occupancy: concurrent admissions never lose updates; capacity and closed camps enforced", async () => {
    const before = Number((await op("camps")).find((x: { camp_id: string }) => Number(x.camp_id) === camp).current_population);
    const results = await Promise.all(Array.from({ length: 12 }, () => call("/api/operations?kind=camp-occupancy", { camp_id: camp, delta: 1 })));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    const after = (await op("camps")).find((x: { camp_id: string }) => Number(x.camp_id) === camp);
    assert.equal(Number(after.current_population), before + 12);
    const over = await call("/api/operations?kind=camp-occupancy", { camp_id: camp, delta: 1000 });
    assert.equal(over.status, 409);
    assert.equal(over.data.code, "CAPACITY_EXCEEDED");
    assert.equal((await call("/api/operations?kind=camp-occupancy", { camp_id: camp, delta: -100000 })).status, 409);
    const closed = (await op("camps")).find((x: { status: string }) => x.status === "CLOSED");
    assert.equal((await call("/api/operations?kind=camp-occupancy", { camp_id: Number(closed.camp_id), delta: 1 })).status, 409);
    const fill = await op("camp-occupancy", { camp_id: camp, delta: 100 - Number(after.current_population) });
    assert.equal(fill.status, "FULL", "status follows occupancy");
    await op("camp-occupancy", { camp_id: camp, delta: -1 });
    assert.equal((await call("/api/operations?kind=camp-occupancy", { camp_id: camp, delta: 1 }, "POST", driverCookie)).status, 403);
  });

  await check("Logistics edge cases: concurrent vehicle double booking, unavailable volunteer, cancel after dispatch, DB guards", async () => {
    await op("inventory", { warehouse_id: warehouse, resource_id: resource, delta: 5, minimum_threshold: 0, reason: "Restock for logistics tests" });
    const r1 = await ok("/api/requests", { ...requestBody, items: [{ resource_id: resource, quantity_requested: 1 }] });
    const r2 = await ok("/api/requests", { ...requestBody, items: [{ resource_id: resource, quantity_requested: 1 }] });
    const r3 = await ok("/api/requests", { ...requestBody, items: [{ resource_id: resource, quantity_requested: 1 }] });
    for (const r of [r1, r2, r3]) await ok("/api/requests", { request_id: Number(r.request_id), status: "APPROVED" }, "PATCH");
    const a1 = await op("allocations", { request_id: Number(r1.request_id), items: [{ warehouse_id: warehouse, resource_id: resource, quantity_allocated: 1 }] });
    const a2 = await op("allocations", { request_id: Number(r2.request_id), items: [{ warehouse_id: warehouse, resource_id: resource, quantity_allocated: 1 }] });
    const a3 = await op("allocations", { request_id: Number(r3.request_id), items: [{ warehouse_id: warehouse, resource_id: resource, quantity_allocated: 1 }] });
    const v2 = await op("vehicles", { vehicle_number: "KA-TEST-02", vehicle_type: "VAN", capacity: 500, status: "AVAILABLE" });
    const v3 = await op("vehicles", { vehicle_number: "KA-TEST-03", vehicle_type: "VAN", capacity: 500, status: "AVAILABLE" });
    const v4 = await op("vehicles", { vehicle_number: "KA-TEST-04", vehicle_type: "VAN", capacity: 500, status: "AVAILABLE" });
    const d2 = await op("users", { full_name: "Driver Two", email: "driver2@test.local", password, role_name: "DRIVER" });
    const d3 = await op("users", { full_name: "Driver Three", email: "driver3@test.local", password, role_name: "DRIVER" });
    const d4 = await op("users", { full_name: "Driver Four", email: "driver4@test.local", password, role_name: "DRIVER" });
    const eta = new Date(Date.now() + 7200000).toISOString();
    const both = await Promise.all([
      call("/api/operations?kind=deliveries", { allocation_id: Number(a1.allocation_id), vehicle_id: Number(v2.vehicle_id), driver_id: Number(d2.user_id), expected_arrival: eta }),
      call("/api/operations?kind=deliveries", { allocation_id: Number(a2.allocation_id), vehicle_id: Number(v2.vehicle_id), driver_id: Number(d3.user_id), expected_arrival: eta }),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], "one vehicle, one active delivery");
    const won = both.find((r) => r.status === 200)!.data;
    const vol2 = await op("volunteers", { full_name: "Busy Volunteer", phone: "+919999333444", email: "busy@test.local", skills: "", availability_status: "AVAILABLE" });
    const loser = Number(won.allocation_id) === Number(a1.allocation_id) ? a2 : a1;
    const freeDriver = Number(won.driver_id) === Number(d2.user_id) ? d3 : d2;
    await op("deliveries", { allocation_id: Number(loser.allocation_id), vehicle_id: Number(v3.vehicle_id), driver_id: Number(freeDriver.user_id), expected_arrival: eta, volunteer_ids: [Number(vol2.volunteer_id)] });
    const busy = await call("/api/operations?kind=deliveries", { allocation_id: Number(a3.allocation_id), vehicle_id: Number(v4.vehicle_id), driver_id: Number(d4.user_id), expected_arrival: eta, volunteer_ids: [Number(vol2.volunteer_id)] });
    assert.equal(busy.status, 409, "volunteer already assigned");
    assert.match(busy.data.error, /Volunteer/);
    assert.equal((await op("vehicles")).find((x: { vehicle_id: string }) => Number(x.vehicle_id) === Number(v4.vehicle_id)).status, "AVAILABLE", "failed assignment rolled back");
    await op("delivery-status", { delivery_id: Number(won.delivery_id), status: "IN_TRANSIT" });
    const cancel = await call("/api/operations?kind=allocation-cancel", { allocation_id: Number(won.allocation_id) });
    assert.equal(cancel.status, 409, "cannot cancel after shipment");
    assert.equal(cancel.data.code, "INVALID_TRANSITION");
    await assert.rejects(db.query("UPDATE deliveries SET status='PLANNED' WHERE delivery_id=$1", [won.delivery_id]), /Invalid delivery transition/);
    const active = (await db.query("SELECT * FROM deliveries WHERE delivery_id=$1", [won.delivery_id])).rows[0];
    await assert.rejects(
      db.query("INSERT INTO deliveries(allocation_id, vehicle_id, driver_id, source_location_id, destination_location_id) VALUES ($1,$2,$3,$4,$5)", [a3.allocation_id, active.vehicle_id, d4.user_id, active.source_location_id, active.destination_location_id]),
      /duplicate key|unique/i,
    );
    await op("delivery-status", { delivery_id: Number(won.delivery_id), status: "DELIVERED" });
  });

  await check("Database objects: views, functions, procedure and row-change audit trigger", async () => {
    const demand = (await db.query("SELECT * FROM v_resource_demand WHERE resource_id = $1", [resource])).rows[0];
    assert.ok(demand && "net_position" in demand);
    const pct = (await db.query("SELECT request_fulfillment_pct($1) AS p", [request])).rows[0].p;
    assert.equal(Number(pct), 100);
    const avail = Number((await db.query("SELECT resource_availability($1) AS a", [resource])).rows[0].a);
    const sum = Number((await db.query("SELECT COALESCE(sum(i.quantity_available),0) AS s FROM inventory i JOIN warehouses w USING (warehouse_id) WHERE resource_id=$1 AND w.status='ACTIVE'", [resource])).rows[0].s);
    assert.equal(avail, sum);
    assert.ok((await db.query("SELECT * FROM operational_summary()")).rowCount! >= 6);
    await db.query("CALL refresh_request_status($1)", [request]);
    assert.equal((await db.query("SELECT status FROM resource_requests WHERE request_id=$1", [request])).rows[0].status, "DELIVERED");
    const log = await db.query("SELECT changed_by, changed_fields FROM data_change_log WHERE table_name='relief_camps' AND operation='UPDATE' ORDER BY change_id DESC LIMIT 1");
    assert.ok(log.rows[0].changed_by, "acting user recorded by trigger");
    assert.ok(log.rows[0].changed_fields.current_population);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM data_change_log WHERE table_name='app_users' AND row_data ? 'password_hash'")).rows[0].n, 0, "password hashes never logged");
  });

  await check("Users: last-admin protection, password reset and deactivation revoke sessions", async () => {
    const me = await ok("/api/auth");
    assert.equal((await call("/api/operations?kind=user-role", { user_id: Number(me.user_id), role_name: "DRIVER", is_active: true })).status, 409);
    const u = await op("users", { full_name: "Temp Officer", email: "temp@test.local", password, role_name: "FIELD_OFFICER" });
    const s1 = (await call("/api/auth", { email: "temp@test.local", password })).cookie!;
    await op("user-password", { user_id: Number(u.user_id), password: password + "X" });
    assert.equal((await call("/api/auth", undefined, "GET", s1)).status, 401);
    const s2 = (await call("/api/auth", { email: "temp@test.local", password: password + "X" })).cookie!;
    await op("user-role", { user_id: Number(u.user_id), role_name: "FIELD_OFFICER", is_active: false });
    assert.equal((await call("/api/auth", undefined, "GET", s2)).status, 401, "deactivated user session rejected");
    assert.equal((await call("/api/auth", { email: "temp@test.local", password: password + "X" })).status, 401, "deactivated user cannot sign in");
    assert.equal((await call("/api/operations?kind=user-password", { user_id: Number(u.user_id), password: "short" })).status, 400);
  });

  await check("Read models: request pipeline, intelligence recommendations, map, ER introspection", async () => {
    const detail = await ok(`/api/requests?id=${request}`);
    assert.ok(detail.allocations.length >= 1 && detail.deliveries.length >= 1 && detail.history.length >= 1);
    const rec = await ok(`/api/intelligence?requestId=${request}`);
    assert.ok(Array.isArray(rec.lines));
    assert.match(rec.note, /advisory/i);
    const intel = await ok("/api/intelligence");
    assert.ok(Array.isArray(intel.shortages) && Array.isArray(intel.priority));
    const map = await ok("/api/map");
    assert.ok(Array.isArray(map.camps));
    const er = await ok("/api/lab/er");
    const names = er.entities.map((e: { name: string }) => e.name);
    for (const t of ["disasters", "inventory", "allocation_items", "disaster_locations"]) assert.ok(names.includes(t), t);
    assert.ok(er.manyToMany.some((m: { via: string }) => m.via === "disaster_locations"));
    assert.ok(er.relationships.some((r: { from: string; to: string; cardinality: string }) => r.from === "resource_requests" && r.to === "relief_camps" && r.cardinality === "N:1"));
    assert.equal((await call("/api/dashboard", undefined, "GET", driverCookie)).status, 403);
  });

  await check("Database-level RBAC: PostgreSQL roles, column privileges and row-level security", async () => {
    const roles = (await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('rf_admin','rf_coordinator','rf_field_officer','rf_driver') ORDER BY 1")).rows.map((r) => r.rolname);
    assert.deepEqual(roles, ["rf_admin", "rf_coordinator", "rf_driver", "rf_field_officer"]);
    const driverId = (await db.query("SELECT driver_id FROM deliveries GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")).rows[0].driver_id;
    const total = Number((await db.query("SELECT count(*) FROM deliveries")).rows[0].count);
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(driverId)]);
      await c.query("SET LOCAL ROLE rf_driver");
      const seen = (await c.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE driver_id <> $1)::int AS others FROM deliveries", [driverId])).rows[0];
      assert.equal(seen.others, 0, "RLS hides other drivers' deliveries");
      assert.ok(seen.n >= 1 && seen.n < total, `driver sees ${seen.n} of ${total}`);
      const upd = await c.query("UPDATE deliveries SET status = status WHERE driver_id <> $1", [driverId]);
      assert.equal(upd.rowCount, 0, "RLS blocks updates to other drivers' rows");
      await c.query("SAVEPOINT s");
      await assert.rejects(c.query("SELECT password_hash FROM app_users LIMIT 1"), /permission denied/);
      await c.query("ROLLBACK TO SAVEPOINT s");
      await assert.rejects(c.query("UPDATE inventory SET quantity_available = 0"), /permission denied/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE rf_coordinator");
      await assert.rejects(c.query("INSERT INTO data_change_log(table_name, operation) VALUES ('x','DELETE')"), /permission denied/, "history cannot be forged");
      await c.query("ROLLBACK");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    // the API itself now runs as those roles: a field officer's request still works end to end
    const r = await ok("/api/requests", { ...requestBody, items: [{ resource_id: resource, quantity_requested: 1 }] }, "POST", fieldCookie);
    assert.ok(r.request_id);
    const lab = await ok("/api/lab/rbac", { id: "table-privileges" });
    assert.ok(lab.results.some((x: { outcome: string }) => x.outcome.startsWith("DENIED")));
    assert.ok(lab.results.some((x: { outcome: string }) => x.outcome === "ALLOWED"));
    const comments = Number((await db.query("SELECT count(*) FROM pg_description d JOIN pg_class c ON c.oid = d.objoid WHERE c.relnamespace = 'public'::regnamespace AND d.objsubid > 0")).rows[0].count);
    assert.ok(comments >= 140, "data dictionary stored as column comments");
  });

  await check("MongoDB CRUD completed in the app: delete (managers only)", async () => {
    const created = await ok("/api/incidents", { disasterId: disaster, reportType: "GENERAL", severity: "LOW", description: "Temporary report to be deleted in the test.", location: { label: "Test site" } }, "POST", fieldCookie);
    assert.equal((await call(`/api/incidents?id=${created._id}`, undefined, "DELETE", fieldCookie)).status, 403, "field officer cannot delete");
    assert.equal((await call("/api/incidents?id=not-an-id", undefined, "DELETE")).status, 400);
    assert.deepEqual((await ok(`/api/incidents?id=${created._id}`, undefined, "DELETE")), { deleted: true });
    assert.equal((await call(`/api/incidents?id=${created._id}`, undefined, "DELETE")).status, 404, "already deleted");
  });

  await check("Degraded mode: optional services disabled, core keeps working", async () => {
    const h = await (await fetch(base + "/api/health")).json();
    assert.equal(h.status, "ok");
    assert.equal(h.services.redis.configured, false);
    assert.equal(h.services.neo4j.configured, false);
    assert.equal(h.services.vector.configured, false);
    const g = await ok("/api/graph");
    assert.equal(g.configured, false);
    assert.equal((await call("/api/graph?query=overview")).status, 503);
    assert.equal((await call("/api/graph?query=__proto__")).status, 400);
    assert.equal((await call("/api/vector?q=water")).status, 503);
    assert.equal(typeof (await ok("/api/vector")).provider.semantic, "boolean");
    assert.equal((await ok("/api/lab/cache")).kind, "memory");
  });

  await check("DBMS lab: curated demos run and roll back; playground guard; concurrency scenarios; trace", async () => {
    const cat = await ok("/api/lab/demos");
    assert.ok(cat.demos.length >= 60);
    const labDb = new Pool({ connectionString: labUrl() });
    const before = (await labDb.query("SELECT count(*)::int AS n FROM locations")).rows[0].n;
    const ins = await ok("/api/lab/demos", { id: "insert-update-delete" });
    assert.ok(ins.rolledBack && ins.results.every((r: { error?: unknown }) => !r.error));
    assert.equal((await labDb.query("SELECT count(*)::int AS n FROM locations")).rows[0].n, before, "lab changes rolled back");
    const bad = await ok("/api/lab/demos", { id: "violations" });
    assert.deepEqual(bad.results.filter((r: { error?: { code: string } }) => r.error).map((r: { error: { code: string } }) => r.error.code), ["23514", "23505", "23503", "23514", "23503"]);
    const plan = await ok("/api/lab/demos", { id: "seq-vs-index" });
    const plans = plan.results.filter((r: { fields?: string[] }) => r.fields?.[0] === "QUERY PLAN").map((r: { rows: Record<string, unknown>[] }) => JSON.stringify(r.rows[0]["QUERY PLAN"]));
    assert.match(plans[0], /Seq Scan/);
    assert.match(plans[1], /Index|Bitmap/);
    assert.equal((await labDb.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'bench_mv_resource_created'")).rows[0].n, 0, "demo index rolled back");
    assert.equal((await call("/api/lab/demos", { id: "nope" })).status, 404);
    assert.equal((await call("/api/lab/sql", { sql: "SELECT 1; DROP TABLE disasters" })).data.code, "SQL_REJECTED");
    assert.equal((await call("/api/lab/sql", { sql: "SELECT pg_sleep(30)" })).status, 400);
    assert.equal((await call("/api/lab/sql", { sql: "COMMIT" })).status, 400);
    const sel = await ok("/api/lab/sql", { sql: "SELECT count(*) AS n FROM disasters" });
    assert.equal(sel.results[0].rows.length, 1);
    const del = await ok("/api/lab/sql", { sql: "DELETE FROM request_items" });
    assert.ok(del.rolledBack);
    assert.ok((await labDb.query("SELECT count(*)::int AS n FROM request_items")).rows[0].n > 0, "playground DELETE rolled back");
    const denied = await ok("/api/lab/sql", { sql: "CREATE TABLE public.x(a int)" });
    assert.equal(denied.results[0].error.code, "42501", "lab role has no CREATE on public");
    const timeout = await ok("/api/lab/sql", { sql: "SELECT count(*) FROM bench_movements a, bench_movements b" });
    assert.equal(timeout.results[0].error.code, "57014", "statement_timeout stops runaway queries");
    const lost = await ok("/api/lab/concurrency", { id: "lost-update" });
    assert.equal(lost.timeline.at(-1).rows[0].final_qty, 80);
    const dl = await ok("/api/lab/concurrency", { id: "deadlock" });
    assert.ok(dl.timeline.some((e: { error?: { code: string } }) => e.error?.code === "40P01"));
    const ser = await ok("/api/lab/concurrency", { id: "serialization-failure" });
    assert.ok(ser.timeline.some((e: { error?: { code: string } }) => e.error?.code === "40001"));
    const ca = await ok("/api/lab/concurrency", { id: "concurrent-allocation" });
    assert.ok(ca.timeline.some((e: { waitedMs?: number; session: string }) => e.session === "T2" && (e.waitedMs ?? 0) > 150), "T2 waited on the row lock");
    assert.equal(ca.timeline.at(-1).rows[0].final_qty, 30);
    const trace = await ok("/api/lab/trace", { quantity: 5 });
    assert.ok(trace.stages.every((s: { ok: boolean }) => s.ok));
    const badTrace = await ok("/api/lab/trace", { quantity: -5 });
    assert.ok(badTrace.stages.some((s: { ok: boolean; stage: string }) => !s.ok && s.stage.includes("Validate")));
    await labDb.end();
  });

  await check("Browser (Playwright): login, every screen, workflow actions, lab run, mobile layout, logout", async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|openstreetmap/.test(m.text())) errors.push(m.text());
      });
      await page.goto(base + "/login");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("Enter a valid e-mail address").waitFor();
      await page.getByLabel("Email", { exact: true }).fill("admin@reliefflow.local");
      await page.getByLabel("Password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("Invalid email or password").waitFor();
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(base + "/");
      await page.getByRole("heading", { name: "Disaster Response Command Center" }).waitFor();
      await page.locator(".kpi-value").first().waitFor();
      await page.waitForTimeout(900);
      await page.screenshot({ path: "docs/screenshots/command-center.png", fullPage: true });
      const routes = [
        "/map", "/disasters", "/requests", "/incidents", "/intelligence", "/analytics",
        ...["camps", "warehouses", "inventory", "resources", "categories", "allocations", "deliveries", "vehicles", "volunteers", "users", "locations", "audit", "changes", "movements"].map((m) => "/manage/" + m),
        ...["", "/concepts", "/er", "/algebra", "/sql", "/advanced", "/optimization", "/normalization", "/transactions", "/security", "/nosql", "/keyvalue", "/graph", "/vector", "/integration"].map((m) => "/lab" + m),
      ];
      for (const route of routes) {
        await page.goto(base + route);
        await page.waitForLoadState("networkidle");
        await page.locator("h1").first().waitFor();
        assert.equal(await page.getByText("Something went wrong").count(), 0, route);
        assert.equal(await page.getByText("Module not found").count(), 0, route);
      }
      // keyboard: the skip link is the first focus target
      await page.goto(base + "/manage/warehouses");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
      // edit through the modal form, with client-side validation first
      await page.getByRole("row").filter({ hasText: "Updated Depot" }).getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByLabel("Warehouse name").fill("");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText("Warehouse name is required").waitFor();
      await page.getByLabel("Warehouse name").fill("Browser Updated Depot");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "updated" }).waitFor();
      await page.reload();
      await page.getByText("Browser Updated Depot", { exact: true }).waitFor();
      await page.getByLabel("Search Warehouses").fill("zzz-no-match");
      await page.getByText("No matching records").waitFor();
      // request workflow: validation, create, approve from the detail drawer
      await page.goto(base + "/requests");
      await page.getByRole("button", { name: "New request" }).click();
      await page.getByRole("button", { name: "Submit request" }).click();
      await page.getByText("Choose a camp and a disaster").waitFor();
      await page.getByLabel("Relief camp *").selectOption({ index: 1 });
      await page.getByLabel("Disaster *").selectOption({ index: 1 });
      await page.getByLabel("Resource 1").selectOption({ index: 1 });
      await page.getByLabel(/^Quantity/).fill("2");
      await page.getByRole("button", { name: "Submit request" }).click();
      await page.getByRole("status").filter({ hasText: "submitted" }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByRole("dialog").filter({ hasText: "Approved requests can receive allocations" }).getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "approved" }).waitFor();
      await page.getByRole("button", { name: "Plan allocation" }).waitFor();
      await page.screenshot({ path: "docs/screenshots/request-workflow.png" });
      await page.keyboard.press("Escape");
      // DBMS lab: run a demo, the ER explorer and a concurrency scenario
      await page.goto(base + "/lab/algebra");
      await page.getByRole("button", { name: "Run", exact: true }).first().click();
      await page.getByText("rolled back", { exact: false }).first().waitFor();
      await page.goto(base + "/lab/er");
      await page.locator(".er-entity").first().waitFor();
      await page.screenshot({ path: "docs/screenshots/er-explorer.png" });
      await page.goto(base + "/lab/transactions");
      await page.getByRole("tab", { name: "Concurrency & locking" }).click();
      await page.getByRole("button", { name: "Run scenario" }).click();
      await page.getByText("ms total, measured", { exact: false }).waitFor();
      await page.screenshot({ path: "docs/screenshots/concurrency-lab.png", fullPage: true });
      // responsive: no horizontal overflow at phone width; drawer navigation works
      await page.setViewportSize({ width: 390, height: 844 });
      for (const route of ["/", "/manage/warehouses", "/requests", "/lab/sql", "/lab/er"]) {
        await page.goto(base + route);
        await page.waitForLoadState("networkidle");
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Mobile overflow on ${route}`);
      }
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("link", { name: "Inventory" }).click();
      await page.waitForURL(base + "/manage/inventory");
      await page.locator("h1").first().waitFor();
      await page.waitForTimeout(600); // let the drawer finish closing before the screenshot
      await page.screenshot({ path: "docs/screenshots/mobile-inventory.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
  await check("Logout and session expiration reject reuse", async () => {
    await ok("/api/auth", {}, "DELETE");
    assert.equal((await call("/api/auth")).status, 401);
    await db.query(`UPDATE sessions SET expires_at=now()-interval '1 second'`);
    assert.equal(
      (await call("/api/auth", undefined, "GET", fieldCookie)).status,
      401,
    );
  });
}
main()
  .catch((e) => {
    results.push({ test: e.message, status: "FAIL" });
    console.error(e);
    console.error(serverLog);
    process.exitCode = 1;
  })
  .finally(async () => {
    server?.kill();
    await db.end();
    await mongo.close();
    // Keep isolated fixtures for reproducible inspection; never drop development or test databases automatically.
    await admin.end();
    writeFileSync(
      "docs/test-results.json",
      JSON.stringify({ database: dbName, results }, null, 2),
    );
    console.log("Isolated fixtures retained in", dbName);
  });
