import { z } from "zod";

// ---- primitives ------------------------------------------------------------
export const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const name = z.string().trim().min(2).max(160);
export const quantity = z.number().finite().positive().max(99999999999).multipleOf(0.001);
export const roleName = z.enum(["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER", "DRIVER"]);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// ---- operational entities (strict: unexpected fields are rejected) ------------
export const disasterSchema = z.strictObject({
  disaster_name: name,
  disaster_type: name.max(50),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  started_at: z.iso.datetime().refine((v) => Date.parse(v) <= Date.now() + 86_400_000, "Start date cannot be in the future"),
  event_location_id: id,
  description: optionalText(5000),
  status: z.enum(["ACTIVE", "CONTAINED", "CLOSED"]).default("ACTIVE"),
});

export const campSchema = z
  .strictObject({
    camp_name: name,
    location_id: id,
    capacity: z.number().int().positive().max(10_000_000),
    current_population: z.number().int().nonnegative().max(10_000_000),
    status: z.enum(["OPEN", "FULL", "CLOSED"]),
  })
  .refine((d) => d.current_population <= d.capacity, "Occupancy exceeds capacity")
  .refine((d) => d.status !== "CLOSED" || d.current_population === 0, "Evacuate occupants before closing")
  .refine(
    (d) => d.status === "CLOSED" || (d.status === "FULL") === (d.current_population === d.capacity),
    "Full status must match occupancy",
  );

export const warehouseSchema = z.strictObject({
  warehouse_name: name,
  location_id: id,
  capacity: quantity,
  status: z.enum(["ACTIVE", "INACTIVE", "MAINTENANCE"]),
});

export const locationSchema = z
  .strictObject({
    location_name: name,
    location_type: name.max(40),
    address: name.max(500),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
  })
  .refine((d) => (d.latitude == null) === (d.longitude == null), "Provide both latitude and longitude, or neither");

export const vehicleSchema = z.strictObject({
  vehicle_number: name.max(30).transform((v) => v.toUpperCase()),
  vehicle_type: name.max(50),
  capacity: quantity,
  status: z.enum(["AVAILABLE", "MAINTENANCE"]),
});

export const volunteerSchema = z.strictObject({
  full_name: name.max(120),
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,25}$/, "Invalid phone number"),
  email: z.email(),
  skills: z.string().trim().max(2000).default(""),
  availability_status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
});

export const resourceSchema = z.strictObject({
  resource_name: name.max(120),
  category_id: id,
  unit: name.max(30),
  is_perishable: z.boolean().default(false),
});

export const categorySchema = z.strictObject({
  category_name: name.max(80),
  description: optionalText(1000),
});

export const disasterLocationSchema = z.strictObject({
  disaster_id: id,
  location_id: id,
  impact_level: z.enum(["LOW", "MODERATE", "HIGH", "SEVERE"]),
  affected_population: z.number().int().nonnegative().max(1_000_000_000),
});

export const requestSchema = z
  .strictObject({
    camp_id: id,
    disaster_id: id,
    need_by: z.iso.datetime().refine((v) => Date.parse(v) > Date.now(), "Required date must be in the future"),
    priority_score: z.number().min(0).max(100).default(50),
    priority_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
    medical_emergency: z.boolean().default(false),
    remarks: optionalText(5000),
    items: z.array(z.strictObject({ resource_id: id, quantity_requested: quantity })).min(1).max(100),
  })
  .refine((d) => new Set(d.items.map((i) => i.resource_id)).size === d.items.length, "Duplicate resource");

export const requestStatusSchema = z.strictObject({
  request_id: id,
  status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
});

export const allocationSchema = z.strictObject({
  request_id: id,
  items: z
    .array(z.strictObject({ warehouse_id: id, resource_id: id, quantity_allocated: quantity }))
    .min(1)
    .max(100)
    .refine(
      (items) => new Set(items.map((i) => `${i.warehouse_id}:${i.resource_id}`)).size === items.length,
      "Each warehouse/resource pair may appear once",
    ),
  remarks: optionalText(1000),
});

export const inventoryAdjustSchema = z.strictObject({
  warehouse_id: id,
  resource_id: id,
  delta: z.number().finite().min(-99999999999).max(99999999999).multipleOf(0.001),
  minimum_threshold: z.number().finite().min(0).max(99999999999),
  reason: z.string().trim().min(3).max(500),
  /** Optimistic concurrency: if supplied, the adjustment only applies when stock still equals this value. */
  expected_quantity: z.number().finite().min(0).optional(),
});

export const deliverySchema = z.strictObject({
  allocation_id: id,
  vehicle_id: id,
  driver_id: id,
  expected_arrival: z.iso.datetime().refine((v) => Date.parse(v) > Date.now(), "Arrival must be in the future"),
  volunteer_ids: z.array(id).max(30).default([]).refine((v) => new Set(v).size === v.length, "Duplicate volunteers"),
});

export const deliveryStatusSchema = z.strictObject({
  delivery_id: id,
  status: z.enum(["IN_TRANSIT", "DELAYED", "DELIVERED", "CANCELLED"]),
});

export const campOccupancySchema = z.strictObject({
  camp_id: id,
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "Change must not be zero"),
});

export const userCreateSchema = z.strictObject({
  full_name: name.max(120),
  email: z.email().transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password exceeds bcrypt byte limit"),
  role_name: roleName,
});

export const userRoleSchema = z.strictObject({ user_id: id, role_name: roleName, is_active: z.boolean() });

export const incidentSchema = z.strictObject({
  disasterId: id,
  reportType: z.enum(["DAMAGE", "MEDICAL", "SUPPLY", "SAFETY", "GENERAL"]),
  description: z.string().trim().min(10).max(10000),
  location: z.strictObject({
    label: name.max(200),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
  }),
  severity: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
});

export const incidentUpdateSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{24}$/, "Invalid incident id"),
  note: z.string().trim().min(3).max(2000).optional(),
  status: z.enum(["OPEN", "MONITORING", "RESOLVED"]).optional(),
}).refine((d) => d.note || d.status, "Provide a note or a status");

// ---- state machines ------------------------------------------------------------
const transitions = {
  request: { PENDING: ["APPROVED", "REJECTED", "CANCELLED"], APPROVED: ["CANCELLED"] } as Record<string, string[]>,
  delivery: {
    PLANNED: ["IN_TRANSIT", "CANCELLED"],
    IN_TRANSIT: ["DELAYED", "DELIVERED"],
    DELAYED: ["IN_TRANSIT", "DELIVERED"],
  } as Record<string, string[]>,
  allocation: { ALLOCATED: ["IN_TRANSIT", "CANCELLED"], IN_TRANSIT: ["DELIVERED"] } as Record<string, string[]>,
};
export function canTransition(kind: keyof typeof transitions, from: string, to: string) {
  return transitions[kind][from]?.includes(to) ?? false;
}
export function nextStates(kind: keyof typeof transitions, from: string) {
  return transitions[kind][from] ?? [];
}

// ---- pure business calculations (shared by API, UI and tests) ----------------
export function remainingQuantity(requested: number, allocations: { quantity: number; cancelled: boolean }[]) {
  const used = allocations.filter((a) => !a.cancelled).reduce((s, a) => s + a.quantity, 0);
  return Math.max(0, +(requested - used).toFixed(3));
}
export function fulfillmentPct(requested: number, allocated: number) {
  if (requested <= 0) return 0;
  return Math.min(100, Math.round((1000 * allocated) / requested) / 10);
}
export function campStatusFor(population: number, capacity: number, current: "OPEN" | "FULL" | "CLOSED") {
  if (current === "CLOSED") return "CLOSED";
  return population >= capacity ? "FULL" : "OPEN";
}
/** Great-circle distance in km (used to explain allocation recommendations). */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
