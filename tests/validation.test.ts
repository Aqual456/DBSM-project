import test from "node:test";
import assert from "node:assert/strict";
import {
  campSchema,
  warehouseSchema,
  disasterSchema,
  requestSchema,
  canTransition,
} from "../src/lib/validation";
test("camp business rules reject negative/over capacity/closed occupancy", () => {
  const d = {
    camp_name: "North Camp",
    location_id: 1,
    capacity: 10,
    current_population: 5,
    status: "OPEN",
  };
  assert(campSchema.safeParse(d).success);
  for (const patch of [
    { capacity: 0 },
    { current_population: -1 },
    { current_population: 11 },
    { status: "CLOSED" },
    { status: "FULL" },
  ])
    assert(!campSchema.safeParse({ ...d, ...patch }).success);
  assert(
    campSchema.safeParse({ ...d, current_population: 10, status: "FULL" })
      .success,
  );
  assert(
    campSchema.safeParse({ ...d, current_population: 0, status: "CLOSED" })
      .success,
  );
});
test("warehouse and disaster fields are trimmed and constrained", () => {
  assert(
    !warehouseSchema.safeParse({
      warehouse_name: "   ",
      location_id: 1,
      capacity: 1,
      status: "ACTIVE",
    }).success,
  );
  assert(
    !warehouseSchema.safeParse({
      warehouse_name: "Central",
      location_id: 1,
      capacity: -1,
      status: "ACTIVE",
    }).success,
  );
  assert(
    !disasterSchema.safeParse({
      disaster_name: "Flood",
      disaster_type: "FLOOD",
      severity: "HIGH",
      started_at: new Date().toISOString(),
    }).success,
  );
});
test("request rejects duplicate resources, fractional precision loss, past dates", () => {
  const d = {
    camp_id: 1,
    disaster_id: 1,
    need_by: new Date(Date.now() + 3600000).toISOString(),
    items: [{ resource_id: 1, quantity_requested: 2 }],
  };
  assert(requestSchema.safeParse(d).success);
  assert(
    !requestSchema.safeParse({ ...d, items: [...d.items, ...d.items] }).success,
  );
  assert(
    !requestSchema.safeParse({
      ...d,
      items: [{ resource_id: 1, quantity_requested: 0.0001 }],
    }).success,
  );
  assert(
    !requestSchema.safeParse({ ...d, need_by: "2020-01-01T00:00:00.000Z" })
      .success,
  );
});
test("controlled transitions reject skips and terminal edits", () => {
  assert(canTransition("request", "PENDING", "APPROVED"));
  assert(!canTransition("request", "PENDING", "DELIVERED"));
  assert(!canTransition("request", "DELIVERED", "PENDING"));
  assert(canTransition("delivery", "PLANNED", "IN_TRANSIT"));
  assert(canTransition("delivery", "IN_TRANSIT", "DELIVERED"));
  assert(!canTransition("delivery", "PLANNED", "DELIVERED"));
  assert(!canTransition("delivery", "DELIVERED", "IN_TRANSIT"));
});
