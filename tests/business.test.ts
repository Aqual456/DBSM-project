import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransition, nextStates, remainingQuantity, fulfillmentPct, campStatusFor, haversineKm,
  allocationSchema, inventoryAdjustSchema, deliverySchema, campOccupancySchema, disasterSchema, userCreateSchema, incidentSchema, incidentUpdateSchema, locationSchema, requestSchema, id,
} from "../src/lib/validation";
import { cosine, lexicalEmbedding, tokenize, activeProvider } from "../src/lib/embeddings";

const future = () => new Date(Date.now() + 86400000).toISOString();

test("delivery, request and allocation state machines", () => {
  assert.ok(canTransition("delivery", "PLANNED", "IN_TRANSIT"));
  assert.ok(canTransition("delivery", "DELAYED", "DELIVERED"));
  assert.ok(!canTransition("delivery", "DELIVERED", "IN_TRANSIT"));
  assert.ok(!canTransition("delivery", "PLANNED", "DELIVERED"), "cannot skip dispatch");
  assert.ok(!canTransition("delivery", "IN_TRANSIT", "CANCELLED"), "cannot cancel after shipment");
  assert.ok(canTransition("allocation", "ALLOCATED", "CANCELLED"));
  assert.ok(!canTransition("allocation", "CANCELLED", "CANCELLED"), "cancel twice");
  assert.ok(!canTransition("allocation", "IN_TRANSIT", "CANCELLED"), "cancel after shipment");
  assert.ok(!canTransition("request", "REJECTED", "APPROVED"));
  assert.deepEqual(nextStates("request", "PENDING"), ["APPROVED", "REJECTED", "CANCELLED"]);
  assert.deepEqual(nextStates("delivery", "DELIVERED"), []);
});

test("quantity and fulfilment calculations", () => {
  assert.equal(remainingQuantity(100, [{ quantity: 30, cancelled: false }, { quantity: 50, cancelled: true }]), 70);
  assert.equal(remainingQuantity(10, [{ quantity: 15, cancelled: false }]), 0);
  assert.equal(remainingQuantity(0.3, [{ quantity: 0.1, cancelled: false }, { quantity: 0.2, cancelled: false }]), 0);
  assert.equal(fulfillmentPct(200, 50), 25);
  assert.equal(fulfillmentPct(0, 10), 0);
  assert.equal(fulfillmentPct(3, 1), 33.3);
  assert.equal(fulfillmentPct(10, 20), 100);
  assert.equal(campStatusFor(100, 100, "OPEN"), "FULL");
  assert.equal(campStatusFor(10, 100, "FULL"), "OPEN");
  assert.equal(campStatusFor(0, 100, "CLOSED"), "CLOSED");
});

test("haversine distance (Bengaluru → Mysuru ≈ 128 km)", () => {
  const d = haversineKm({ lat: 12.9716, lon: 77.5946 }, { lat: 12.2958, lon: 76.6394 });
  assert.ok(d > 120 && d < 135, String(d));
  assert.equal(haversineKm({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }), 0);
});

test("ids reject zero, negatives, fractions, strings and overflow", () => {
  for (const v of [0, -1, 1.5, "abc", Number.MAX_SAFE_INTEGER + 2, null]) assert.equal(id.safeParse(v).success, false, String(v));
  assert.equal(id.parse("12"), 12);
});

test("allocation input: zero/negative/huge quantities, duplicates, unexpected fields", () => {
  const base = { request_id: 1, items: [{ warehouse_id: 1, resource_id: 2, quantity_allocated: 5 }] };
  assert.ok(allocationSchema.safeParse(base).success);
  for (const q of [0, -5, 1e12, 0.0001]) assert.equal(allocationSchema.safeParse({ ...base, items: [{ ...base.items[0], quantity_allocated: q }] }).success, false, String(q));
  assert.equal(allocationSchema.safeParse({ ...base, items: [base.items[0], base.items[0]] }).success, false);
  assert.equal(allocationSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(allocationSchema.safeParse({ ...base, allocated_by: 99 }).success, false, "client cannot choose allocated_by");
});

test("inventory, occupancy and delivery inputs", () => {
  assert.ok(inventoryAdjustSchema.safeParse({ warehouse_id: 1, resource_id: 1, delta: -5, minimum_threshold: 0, reason: "count" }).success);
  assert.equal(inventoryAdjustSchema.safeParse({ warehouse_id: 1, resource_id: 1, delta: 5, minimum_threshold: -1, reason: "x" }).success, false);
  assert.equal(campOccupancySchema.safeParse({ camp_id: 1, delta: 0 }).success, false);
  assert.equal(campOccupancySchema.safeParse({ camp_id: 1, delta: 2.5 }).success, false);
  assert.equal(deliverySchema.safeParse({ allocation_id: 1, vehicle_id: 1, driver_id: 1, expected_arrival: "2000-01-01T00:00:00Z" }).success, false, "past ETA");
  assert.equal(deliverySchema.safeParse({ allocation_id: 1, vehicle_id: 1, driver_id: 1, expected_arrival: future(), volunteer_ids: [3, 3] }).success, false, "duplicate volunteer");
  assert.equal(deliverySchema.safeParse({ allocation_id: 1, vehicle_id: 1, driver_id: 1, expected_arrival: "not a date" }).success, false);
});

test("disaster, request, user, location and incident inputs", () => {
  const d = { disaster_name: "Flood", disaster_type: "FLOOD", severity: "HIGH", started_at: new Date().toISOString(), event_location_id: 1 };
  assert.ok(disasterSchema.safeParse(d).success);
  assert.equal(disasterSchema.safeParse({ ...d, started_at: new Date(Date.now() + 5 * 86400000).toISOString() }).success, false, "future start");
  assert.equal(disasterSchema.safeParse({ ...d, severity: "EXTREME" }).success, false);
  assert.equal(disasterSchema.safeParse({ ...d, created_by: 1 }).success, false, "unexpected field");
  assert.equal(requestSchema.safeParse({ camp_id: 1, disaster_id: 1, need_by: future(), items: [{ resource_id: 1, quantity_requested: 1 }], priority_score: 101 }).success, false);
  assert.equal(userCreateSchema.safeParse({ full_name: "A B", email: "a@b.co", password: "short", role_name: "ADMIN" }).success, false);
  assert.equal(userCreateSchema.safeParse({ full_name: "A B", email: "a@b.co", password: "x".repeat(12), role_name: "ROOT" }).success, false);
  assert.equal(locationSchema.safeParse({ location_name: "Ward", location_type: "WARD", address: "Somewhere", latitude: 12 }).success, false, "lat without lon");
  assert.equal(locationSchema.safeParse({ location_name: "Ward", location_type: "WARD", address: "Somewhere", latitude: 91, longitude: 0 }).success, false);
  assert.equal(incidentSchema.safeParse({ disasterId: 1, reportType: "MEDICAL", description: "short", location: { label: "X1" }, severity: "LOW" }).success, false);
  assert.equal(incidentUpdateSchema.safeParse({ id: "not-an-object-id", note: "hello" }).success, false);
  assert.equal(incidentUpdateSchema.safeParse({ id: "a".repeat(24) }).success, false, "needs note or status");
});

test("lexical fallback embeddings are unit vectors and rank shared vocabulary higher", () => {
  const a = lexicalEmbedding("Contaminated water making children sick");
  const b = lexicalEmbedding("children fell sick from contaminated drinking water");
  const c = lexicalEmbedding("roof blown off by storm surge");
  assert.equal(a.length, 256);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-3);
  assert.ok(cosine(a, b) > cosine(a, c));
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6);
  assert.deepEqual(tokenize("The flooding of the wards"), ["flood", "ward"]);
  const saved = process.env.EMBEDDING_PROVIDER;
  process.env.EMBEDDING_PROVIDER = "lexical";
  if (!process.env.VOYAGE_API_KEY && !process.env.OPENAI_API_KEY) assert.equal(activeProvider().semantic, false, "the lexical fallback is never labelled semantic");
  process.env.EMBEDDING_PROVIDER = saved;
});
