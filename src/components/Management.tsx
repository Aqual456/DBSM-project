"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw, Pencil, Trash2, UserPlus, KeyRound, LogOut, Ban, CheckCircle2, Truck, Undo2, SlidersHorizontal, Eye, Users, ArrowRight } from "lucide-react";
import { api, useApi, fmtDate, fmtNumber, fmtRelative, titleCase, toLocalInput } from "@/lib/client";
import { Badge, Button, EmptyState, PageHeader, Alert, Meter } from "@/components/ui/primitives";
import { DataTable, type Column, type Filter } from "@/components/ui/DataTable";
import { Modal, useConfirm, useToast } from "@/components/ui/overlays";
import { useMe, isManager, type Me } from "@/components/shell/AppShell";

type Row = Record<string, unknown>;
type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "ref" | "textarea" | "email" | "password" | "datetime" | "checkbox" | "multi";
  options?: string[];
  source?: { kind: string; id: string; label: (r: Row) => string; filter?: (r: Row) => boolean };
  required?: boolean;
  hint?: string;
  full?: boolean;
  step?: string;
  min?: number;
  section?: string;
  createOnly?: boolean;
};
type Ctx = {
  me: Me | null;
  manager: boolean;
  reload: () => void;
  run: (kind: string, body: unknown, msg: string, method?: string) => Promise<boolean>;
  confirm: ReturnType<typeof useConfirm>;
  openForm: (values?: Row, editing?: boolean) => void;
  openCustom: (node: ReactNode, title: string) => void;
  closeCustom: () => void;
};
type ModuleDef = {
  title: string;
  eyebrow: string;
  lead: string;
  key?: string;
  kind?: string;
  writeKind?: string;
  columns: Column<Row>[];
  filters?: Filter<Row>[];
  fields?: FieldDef[];
  canCreate?: (me: Me | null) => boolean;
  canEdit?: (me: Me | null) => boolean;
  deletable?: boolean;
  createLabel?: string;
  rowActions?: (r: Row, c: Ctx) => ReactNode;
  banner?: (rows: Row[] | null, c: Ctx) => ReactNode;
  detail?: boolean;
  initialSort?: { key: string; dir: "asc" | "desc" };
};

const main = (title: unknown, sub?: unknown) => (
  <div>
    <div className="cell-main">{String(title ?? "—")}</div>
    {sub != null && sub !== "" && <div className="cell-sub">{String(sub)}</div>}
  </div>
);
const mgr = (me: Me | null) => isManager(me);
const admin = (me: Me | null) => me?.role_name === "ADMIN";

const modules: Record<string, ModuleDef> = {
  camps: {
    title: "Relief Camps",
    eyebrow: "Disaster operations",
    lead: "Shelter capacity and occupancy. Admissions and discharges are atomic database updates, so concurrent changes are never lost.",
    key: "camp_id",
    columns: [
      { key: "camp_name", header: "Camp", render: (r) => main(r.camp_name, r.location_name) },
      { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      {
        key: "occupancy_pct",
        header: "Occupancy",
        value: (r) => Number(r.occupancy_pct),
        render: (r) => (
          <div style={{ minWidth: 150 }}>
            <div className="row small" style={{ justifyContent: "space-between" }}>
              <span className="num">
                {fmtNumber(r.current_population)} / {fmtNumber(r.capacity)}
              </span>
              <span className="num muted">{fmtNumber(r.occupancy_pct, 1)}%</span>
            </div>
            <Meter value={Number(r.current_population)} max={Number(r.capacity)} tone={Number(r.occupancy_pct) >= 100 ? "danger" : Number(r.occupancy_pct) > 85 ? "warn" : "teal"} />
          </div>
        ),
      },
      { key: "established_at", header: "Established", render: (r) => fmtDate(r.established_at, false) },
    ],
    filters: [{ key: "status", label: "Statuses", options: ["OPEN", "FULL", "CLOSED"], value: (r) => r.status }],
    fields: [
      { key: "camp_name", label: "Camp name", required: true, full: true },
      { key: "location_id", label: "Location", type: "ref", source: { kind: "locations", id: "location_id", label: (r) => String(r.location_name) }, required: true },
      { key: "status", label: "Status", type: "select", options: ["OPEN", "FULL", "CLOSED"], hint: "FULL must match capacity; CLOSED requires zero occupants" },
      { key: "capacity", label: "Capacity (people)", type: "number", min: 1, required: true },
      { key: "current_population", label: "Current occupancy", type: "number", min: 0, required: true },
    ],
    canCreate: mgr,
    canEdit: mgr,
    rowActions: (r, c) =>
      r.status !== "CLOSED" && c.me?.role_name !== "DRIVER" ? (
        <Button size="sm" icon={<Users size={13} />} onClick={() => c.openCustom(<OccupancyForm camp={r} ctx={c} />, `Admit or discharge — ${r.camp_name}`)}>
          Admit / discharge
        </Button>
      ) : null,
  },
  warehouses: {
    title: "Warehouses",
    eyebrow: "Resource management",
    lead: "Storage sites and their live stock position. A warehouse cannot leave ACTIVE while allocations from it await dispatch.",
    key: "warehouse_id",
    columns: [
      { key: "warehouse_name", header: "Warehouse", render: (r) => main(r.warehouse_name, r.location_name) },
      { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      { key: "resource_lines", header: "Lines", align: "right", value: (r) => Number(r.resource_lines) },
      { key: "units_available", header: "Units on hand", align: "right", value: (r) => Number(r.units_available), render: (r) => fmtNumber(r.units_available) },
      { key: "low_stock_lines", header: "Low stock", align: "right", value: (r) => Number(r.low_stock_lines), render: (r) => (Number(r.low_stock_lines) ? <Badge value="HIGH" label={`${r.low_stock_lines} low`} /> : <span className="muted">—</span>) },
      { key: "capacity", header: "Capacity", align: "right", render: (r) => fmtNumber(r.capacity) },
    ],
    filters: [{ key: "status", label: "Statuses", options: ["ACTIVE", "INACTIVE", "MAINTENANCE"], value: (r) => r.status }],
    fields: [
      { key: "warehouse_name", label: "Warehouse name", required: true, full: true },
      { key: "location_id", label: "Location", type: "ref", source: { kind: "locations", id: "location_id", label: (r) => String(r.location_name) }, required: true },
      { key: "status", label: "Status", type: "select", options: ["ACTIVE", "INACTIVE", "MAINTENANCE"] },
      { key: "capacity", label: "Storage capacity", type: "number", min: 0.001, step: "0.001", required: true },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  locations: {
    title: "Locations",
    eyebrow: "Administration",
    lead: "Places referenced by disasters, camps, warehouses and deliveries. Coordinates drive the operations map and distance-based recommendations.",
    key: "location_id",
    deletable: true,
    columns: [
      { key: "location_name", header: "Location", render: (r) => main(r.location_name, r.address) },
      { key: "location_type", header: "Type", render: (r) => <Badge value={r.location_type} color="gray" label={titleCase(r.location_type)} /> },
      { key: "latitude", header: "Coordinates", render: (r) => (r.latitude != null ? <span className="num small">{Number(r.latitude).toFixed(4)}, {Number(r.longitude).toFixed(4)}</span> : <span className="muted small">not set</span>) },
    ],
    fields: [
      { key: "location_name", label: "Name", required: true },
      { key: "location_type", label: "Type", type: "select", options: ["DISTRICT", "CAMP_AREA", "DEPOT", "WARD", "VILLAGE", "CITY"] },
      { key: "address", label: "Address", required: true, full: true },
      { key: "latitude", label: "Latitude", type: "number", step: "0.000001", hint: "−90 to 90" },
      { key: "longitude", label: "Longitude", type: "number", step: "0.000001", hint: "−180 to 180" },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  vehicles: {
    title: "Vehicles",
    eyebrow: "Logistics",
    lead: "Fleet availability. A vehicle on an active delivery is locked (IN_USE) and cannot be edited or double-booked.",
    key: "vehicle_id",
    deletable: true,
    columns: [
      { key: "vehicle_number", header: "Registration", render: (r) => main(r.vehicle_number, titleCase(r.vehicle_type)) },
      { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      { key: "capacity", header: "Capacity", align: "right", render: (r) => fmtNumber(r.capacity) },
      { key: "current_location", header: "Last known location", render: (r) => String(r.current_location ?? "—") },
    ],
    filters: [{ key: "status", label: "Statuses", options: ["AVAILABLE", "IN_USE", "MAINTENANCE"], value: (r) => r.status }],
    fields: [
      { key: "vehicle_number", label: "Registration number", required: true },
      { key: "vehicle_type", label: "Type", type: "select", options: ["TRUCK", "MINI_TRUCK", "VAN", "4X4_PICKUP", "BOAT", "AMBULANCE"] },
      { key: "capacity", label: "Capacity (kg)", type: "number", min: 0.001, required: true },
      { key: "status", label: "Status", type: "select", options: ["AVAILABLE", "MAINTENANCE"] },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  volunteers: {
    title: "Volunteers",
    eyebrow: "Logistics",
    lead: "Registered volunteers and their availability. Assignment to a delivery is atomic: a volunteer can only be on one active delivery.",
    key: "volunteer_id",
    deletable: true,
    columns: [
      { key: "full_name", header: "Volunteer", render: (r) => main(r.full_name, r.email ?? r.phone) },
      { key: "skills", header: "Skills", render: (r) => <span className="small">{String(r.skills || "—")}</span> },
      { key: "availability_status", header: "Availability", render: (r) => <Badge value={r.availability_status} /> },
      { key: "deliveries_supported", header: "Deliveries", align: "right" },
    ],
    filters: [{ key: "availability_status", label: "Availability", options: ["AVAILABLE", "ASSIGNED", "UNAVAILABLE"], value: (r) => r.availability_status }],
    fields: [
      { key: "full_name", label: "Full name", required: true },
      { key: "phone", label: "Phone", required: true, hint: "+91 98450 00000" },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "availability_status", label: "Availability", type: "select", options: ["AVAILABLE", "UNAVAILABLE"] },
      { key: "skills", label: "Skills", type: "textarea", full: true },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  resources: {
    title: "Resources",
    eyebrow: "Resource management",
    lead: "Catalogue of relief items. Total availability is computed by the resource_availability() SQL function.",
    key: "resource_id",
    deletable: true,
    columns: [
      { key: "resource_name", header: "Resource", render: (r) => main(r.resource_name, r.is_perishable ? "Perishable" : undefined) },
      { key: "category_name", header: "Category", render: (r) => <Badge value={r.category_name} color="blue" label={titleCase(r.category_name)} /> },
      { key: "unit", header: "Unit" },
      { key: "total_available", header: "Available (active warehouses)", align: "right", value: (r) => Number(r.total_available), render: (r) => fmtNumber(r.total_available) },
    ],
    fields: [
      { key: "resource_name", label: "Resource name", required: true },
      { key: "category_id", label: "Category", type: "ref", source: { kind: "categories", id: "category_id", label: (r) => String(r.category_name) }, required: true },
      { key: "unit", label: "Unit of measure", required: true, hint: "kg, litre, kit, piece…" },
      { key: "is_perishable", label: "Perishable", type: "checkbox" },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  categories: {
    title: "Resource Categories",
    eyebrow: "Resource management",
    lead: "Grouping for resources. Categories still referenced by resources cannot be deleted (FOREIGN KEY … ON DELETE RESTRICT).",
    key: "category_id",
    deletable: true,
    columns: [
      { key: "category_name", header: "Category", render: (r) => main(titleCase(r.category_name), r.description) },
      { key: "resource_count", header: "Resources", align: "right" },
    ],
    fields: [
      { key: "category_name", label: "Category name", required: true },
      { key: "description", label: "Description", type: "textarea", full: true },
    ],
    canCreate: mgr,
    canEdit: mgr,
  },
  inventory: {
    title: "Inventory",
    eyebrow: "Resource management",
    lead: "Stock per warehouse and resource. Adjustments are relative and checked against the quantity you saw, so stale screens cannot overwrite newer stock.",
    columns: [
      { key: "resource_name", header: "Resource", render: (r) => main(r.resource_name, titleCase(r.category_name)) },
      { key: "warehouse_name", header: "Warehouse", render: (r) => main(r.warehouse_name, r.warehouse_status !== "ACTIVE" ? titleCase(r.warehouse_status) : undefined) },
      {
        key: "quantity_available",
        header: "Available",
        align: "right",
        value: (r) => Number(r.quantity_available),
        render: (r) => (
          <span className="num">
            {fmtNumber(r.quantity_available, 3)} <span className="muted small">{String(r.unit)}</span>
          </span>
        ),
      },
      { key: "minimum_threshold", header: "Threshold", align: "right", value: (r) => Number(r.minimum_threshold), render: (r) => fmtNumber(r.minimum_threshold) },
      { key: "quantity_committed", header: "Committed", align: "right", value: (r) => Number(r.quantity_committed), render: (r) => fmtNumber(r.quantity_committed) },
      { key: "low_stock", header: "State", value: (r) => (r.low_stock ? "LOW" : "OK"), render: (r) => (r.low_stock ? <Badge value="HIGH" label="Low stock" /> : <Badge value="OK" label="Healthy" />) },
      { key: "last_updated", header: "Updated", render: (r) => <span className="small muted">{fmtRelative(r.last_updated)}</span> },
    ],
    filters: [{ key: "low", label: "Stock states", options: ["LOW", "OK"], value: (r) => (r.low_stock ? "LOW" : "OK") }],
    canCreate: mgr,
    createLabel: "Adjust stock",
    rowActions: (r, c) =>
      c.manager ? (
        <Button size="sm" icon={<SlidersHorizontal size={13} />} onClick={() => c.openCustom(<StockForm row={r} ctx={c} />, "Adjust stock")}>
          Adjust
        </Button>
      ) : null,
    banner: () => (
      <p className="small muted">
        Every change is written to <Link href="/manage/movements">stock movement history</Link> by the <code>inventory_history</code> trigger.
      </p>
    ),
  },
  allocations: {
    title: "Allocations",
    eyebrow: "Logistics",
    lead: "Stock committed to approved requests. Allocate from a request's detail panel; plan the delivery or cancel (restoring stock exactly once) here.",
    columns: [
      { key: "allocation_id", header: "Allocation", value: (r) => Number(r.allocation_id), render: (r) => main(`#${r.allocation_id}`, fmtDate(r.allocated_at)) },
      { key: "camp_name", header: "Request", render: (r) => main(r.camp_name, `Request #${r.request_id} · ${titleCase(r.priority_level)}`) },
      {
        key: "items",
        header: "Lines",
        sortable: false,
        value: (r) => ((r.items as Row[]) ?? []).map((i) => i.resource_name).join(" "),
        render: (r) => (
          <div className="small">
            {((r.items as Row[]) ?? []).map((i, n) => (
              <div key={n}>
                {fmtNumber(i.quantity, 3)} {String(i.unit)} {String(i.resource_name)} <span className="muted">from {String(i.warehouse_name)}</span>
              </div>
            ))}
          </div>
        ),
      },
      { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      { key: "delivery_status", header: "Delivery", render: (r) => (r.delivery_status ? <Badge value={r.delivery_status} /> : <span className="muted small">not planned</span>) },
    ],
    filters: [{ key: "status", label: "Statuses", options: ["ALLOCATED", "IN_TRANSIT", "DELIVERED", "CANCELLED"], value: (r) => r.status }],
    initialSort: { key: "allocation_id", dir: "desc" },
    rowActions: (r, c) =>
      c.manager && r.status === "ALLOCATED" && !r.delivery_status ? (
        <>
          <Button size="sm" icon={<Truck size={13} />} onClick={() => c.openCustom(<DeliveryForm ctx={c} allocationId={String(r.allocation_id)} />, "Plan delivery")}>
            Plan delivery
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Undo2 size={13} />}
            onClick={async () => {
              if (await c.confirm({ title: `Cancel allocation #${r.allocation_id}?`, text: "The allocated stock is returned to its warehouses and the request reopens for allocation.", confirmLabel: "Cancel allocation", danger: true }))
                await c.run("allocation-cancel", { allocation_id: Number(r.allocation_id) }, `Allocation #${r.allocation_id} cancelled and stock restored`);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Link href={`/requests?id=${r.request_id}`} className="btn sm ghost">
          Request <ArrowRight size={13} />
        </Link>
      ),
  },
  deliveries: {
    title: "Deliveries",
    eyebrow: "Logistics",
    lead: "Transport of allocated supplies. Status follows a state machine enforced by both the API and a database trigger.",
    columns: [
      { key: "delivery_id", header: "Delivery", value: (r) => Number(r.delivery_id), render: (r) => main(`#${r.delivery_id}`, `Allocation #${r.allocation_id}`) },
      { key: "route", header: "Route", value: (r) => `${r.source_name} ${r.destination_name}`, render: (r) => main(`${r.source_name} → ${r.destination_name}`) },
      { key: "vehicle_number", header: "Vehicle & driver", render: (r) => main(r.vehicle_number, r.driver_name) },
      { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      { key: "expected_arrival", header: "ETA / arrived", value: (r) => String(r.actual_arrival ?? r.expected_arrival), render: (r) => <span className="small">{r.actual_arrival ? `Arrived ${fmtDate(r.actual_arrival)}` : fmtDate(r.expected_arrival)}</span> },
      { key: "volunteers", header: "Crew", sortable: false, render: (r) => <span className="small">{((r.volunteers as Row[]) ?? []).map((v) => v.full_name).join(", ") || "—"}</span> },
    ],
    filters: [{ key: "status", label: "Statuses", options: ["PLANNED", "IN_TRANSIT", "DELAYED", "DELIVERED", "CANCELLED"], value: (r) => r.status }],
    initialSort: { key: "delivery_id", dir: "desc" },
    canCreate: mgr,
    createLabel: "Plan delivery",
    rowActions: (r, c) => {
      const mine = c.me?.role_name === "DRIVER" && String(r.driver_id) === String(c.me.user_id);
      if (!c.manager && !mine) return null;
      const next: Record<string, string[]> = { PLANNED: ["IN_TRANSIT", "CANCELLED"], IN_TRANSIT: ["DELAYED", "DELIVERED"], DELAYED: ["IN_TRANSIT", "DELIVERED"] };
      const label: Record<string, string> = { IN_TRANSIT: r.status === "DELAYED" ? "Resume" : "Dispatch", DELAYED: "Mark delayed", DELIVERED: "Mark delivered", CANCELLED: "Cancel" };
      return (next[String(r.status)] ?? [])
        .filter((s) => c.manager || s !== "CANCELLED")
        .map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "DELIVERED" ? "primary" : s === "CANCELLED" ? "danger" : "default"}
            onClick={async () => {
              if (await c.confirm({ title: `${label[s]} delivery #${r.delivery_id}?`, text: s === "DELIVERED" ? "The vehicle and crew are released and the request's fulfilment is updated." : s === "CANCELLED" ? "The vehicle and crew are released; the allocation stays reserved for a new delivery." : "The delivery status will be updated.", confirmLabel: label[s], danger: s === "CANCELLED" }))
                await c.run("delivery-status", { delivery_id: Number(r.delivery_id), status: s }, `Delivery #${r.delivery_id}: ${titleCase(s)}`);
            }}
          >
            {label[s]}
          </Button>
        ));
    },
  },
  users: {
    title: "Users & Access",
    eyebrow: "Administration",
    lead: "Accounts and roles. Role changes, deactivation and password resets revoke every session of that user immediately.",
    columns: [
      { key: "full_name", header: "User", render: (r) => main(r.full_name, r.email) },
      { key: "role_name", header: "Role", render: (r) => <Badge value={r.role_name} color={r.role_name === "ADMIN" ? "violet" : r.role_name === "RELIEF_COORDINATOR" ? "blue" : r.role_name === "DRIVER" ? "amber" : "teal"} label={titleCase(r.role_name)} /> },
      { key: "is_active", header: "Status", value: (r) => (r.is_active ? "ACTIVE" : "INACTIVE"), render: (r) => <Badge value={r.is_active ? "AVAILABLE" : "INACTIVE"} label={r.is_active ? "Active" : "Deactivated"} /> },
      { key: "active_sessions", header: "Sessions", align: "right" },
      { key: "created_at", header: "Created", render: (r) => <span className="small">{fmtDate(r.created_at, false)}</span> },
    ],
    filters: [{ key: "role_name", label: "Roles", options: ["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER", "DRIVER"], value: (r) => r.role_name }],
    fields: [
      { key: "full_name", label: "Full name", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "role_name", label: "Role", type: "select", options: ["FIELD_OFFICER", "RELIEF_COORDINATOR", "DRIVER", "ADMIN"] },
      { key: "password", label: "Initial password", type: "password", required: true, hint: "12–72 characters" },
    ],
    canCreate: admin,
    createLabel: "Add user",
    rowActions: (r, c) =>
      String(r.user_id) === String(c.me?.user_id) ? (
        <span className="small muted">You</span>
      ) : (
        <>
          <Button size="sm" icon={<Pencil size={13} />} onClick={() => c.openCustom(<RoleForm user={r} ctx={c} />, "Change role")}>
            Role
          </Button>
          <Button size="sm" icon={<KeyRound size={13} />} onClick={() => c.openCustom(<PasswordForm user={r} ctx={c} />, "Set password")}>
            Password
          </Button>
          <Button
            size="sm"
            variant={r.is_active ? "danger" : "default"}
            icon={r.is_active ? <Ban size={13} /> : <CheckCircle2 size={13} />}
            onClick={async () => {
              if (await c.confirm({ title: `${r.is_active ? "Deactivate" : "Activate"} ${r.full_name}?`, text: r.is_active ? "They are signed out everywhere and can no longer sign in." : "They will be able to sign in again.", danger: Boolean(r.is_active), confirmLabel: r.is_active ? "Deactivate" : "Activate" }))
                await c.run("user-role", { user_id: Number(r.user_id), role_name: r.role_name, is_active: !r.is_active }, `${r.full_name} ${r.is_active ? "deactivated" : "activated"}`);
            }}
          >
            {r.is_active ? "Deactivate" : "Activate"}
          </Button>
          {Number(r.active_sessions) > 0 && (
            <Button
              size="sm"
              iconOnly
              aria-label={`Sign ${r.full_name} out everywhere`}
              title="Revoke sessions"
              icon={<LogOut size={13} />}
              onClick={async () => {
                if (await c.confirm({ title: `Sign ${r.full_name} out everywhere?`, text: `${r.active_sessions} active session(s) will be revoked.`, confirmLabel: "Revoke sessions" }))
                  await c.run("user-sessions-revoke", { user_id: Number(r.user_id) }, "Sessions revoked");
              }}
            />
          )}
        </>
      ),
  },
  audit: {
    title: "Audit Log",
    eyebrow: "Administration",
    lead: "Application-level audit trail written in the same transaction as each change (so audits never describe changes that rolled back).",
    detail: true,
    columns: [
      { key: "audit_id", header: "#", value: (r) => Number(r.audit_id) },
      { key: "created_at", header: "When", render: (r) => <span className="small">{fmtDate(r.created_at)}</span> },
      { key: "user_name", header: "User" },
      { key: "action", header: "Action", render: (r) => <code>{String(r.action)}</code> },
      { key: "details", header: "Details", sortable: false, value: (r) => JSON.stringify(r.details), render: (r) => <span className="small muted">{JSON.stringify(r.details).slice(0, 90)}…</span> },
    ],
    initialSort: { key: "audit_id", dir: "desc" },
  },
  changes: {
    title: "Data Change Log",
    eyebrow: "Administration",
    lead: "Row-level history captured by the log_row_change() trigger: every INSERT/UPDATE/DELETE on key tables with a field-level diff and the acting user.",
    detail: true,
    columns: [
      { key: "change_id", header: "#", value: (r) => Number(r.change_id) },
      { key: "changed_at", header: "When", render: (r) => <span className="small">{fmtDate(r.changed_at)}</span> },
      { key: "table_name", header: "Table", render: (r) => <code>{String(r.table_name)}</code> },
      { key: "operation", header: "Operation", render: (r) => <Badge value={r.operation === "DELETE" ? "CRITICAL" : r.operation === "INSERT" ? "AVAILABLE" : "APPROVED"} label={String(r.operation)} /> },
      { key: "changed_fields", header: "Changed fields", sortable: false, value: (r) => Object.keys((r.changed_fields as Row) ?? {}).join(" "), render: (r) => <span className="small">{r.changed_fields ? Object.keys(r.changed_fields as Row).join(", ") : "—"}</span> },
      { key: "changed_by_name", header: "By", render: (r) => String(r.changed_by_name ?? "system") },
    ],
    filters: [{ key: "table", label: "Tables", options: ["disasters", "relief_camps", "warehouses", "vehicles", "volunteers", "resource_requests", "app_users", "deliveries"], value: (r) => r.table_name }],
    initialSort: { key: "change_id", dir: "desc" },
  },
  movements: {
    title: "Stock Movements",
    eyebrow: "Resource management",
    lead: "Every change to inventory.quantity_available, recorded automatically by the inventory_history trigger.",
    columns: [
      { key: "movement_id", header: "#", value: (r) => Number(r.movement_id) },
      { key: "created_at", header: "When", render: (r) => <span className="small">{fmtDate(r.created_at)}</span> },
      { key: "warehouse_name", header: "Warehouse" },
      { key: "resource_name", header: "Resource" },
      { key: "delta", header: "Change", align: "right", value: (r) => Number(r.delta), render: (r) => <span className="num" style={{ color: Number(r.delta) < 0 ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>{Number(r.delta) > 0 ? "+" : ""}{fmtNumber(r.delta, 3)} {String(r.unit)}</span> },
      { key: "reason", header: "Reason" },
    ],
    initialSort: { key: "movement_id", dir: "desc" },
  },
};

// ---------------------------------------------------------------------------
function useOptions(kinds: string[]) {
  const [opts, setOpts] = useState<Record<string, Row[]>>({});
  const key = kinds.join(",");
  useEffect(() => {
    let live = true;
    Promise.all(kinds.map(async (k) => [k, await api<Row[]>(`/api/operations?kind=${k}`).catch(() => [])] as const)).then((e) => live && setOpts(Object.fromEntries(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return opts;
}

function EntityForm({ def, initial, editing, onDone, onCancel, writeKind }: { def: ModuleDef; initial: Row; editing: boolean; onDone: () => void; onCancel: () => void; writeKind: string }) {
  const fields = (def.fields ?? []).filter((f) => !(editing && f.createOnly));
  const sources = useOptions([...new Set(fields.filter((f) => f.source).map((f) => f.source!.kind))]);
  const [values, setValues] = useState<Row>(() => {
    const v: Row = { ...initial };
    for (const f of fields) if (v[f.key] === undefined || v[f.key] === null) v[f.key] = f.type === "checkbox" ? false : f.type === "select" ? f.options?.[0] : "";
    return v;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const body: Row = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === "number" || f.type === "ref") body[f.key] = v === "" || v === null ? (f.required ? NaN : null) : Number(v);
      else if (f.type === "checkbox") body[f.key] = Boolean(v);
      else body[f.key] = typeof v === "string" ? v.trim() : v;
      if (f.required && (body[f.key] === "" || Number.isNaN(body[f.key]))) {
        setError(`${f.label} is required`);
        return;
      }
    }
    if (editing && def.key) {
      body[def.key] = Number(initial[def.key]);
      if (initial.row_version) body.row_version = initial.row_version;
    }
    setBusy(true);
    try {
      await api(`/api/operations?kind=${writeKind}`, { body });
      toast("success", editing ? `${def.title.replace(/s$/, "")} updated` : `${def.title.replace(/s$/, "")} created`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        {fields.map((f) => (
          <div className={`field ${f.full || f.type === "textarea" ? "full" : ""}`} key={f.key}>
            {f.type === "checkbox" ? (
              <label className="check">
                <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}
              </label>
            ) : (
              <>
                <label className="field-label" htmlFor={`f-${f.key}`}>
                  {f.label}
                  {f.required && <span aria-hidden style={{ color: "var(--danger)" }}> *</span>}
                </label>
                {f.type === "select" ? (
                  <select id={`f-${f.key}`} className="input" value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {titleCase(o)}
                      </option>
                    ))}
                  </select>
                ) : f.type === "ref" ? (
                  <select id={`f-${f.key}`} className="input" required={f.required} value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">Select…</option>
                    {(sources[f.source!.kind] ?? []).filter(f.source!.filter ?? (() => true)).map((r) => (
                      <option key={String(r[f.source!.id])} value={String(r[f.source!.id])}>
                        {f.source!.label(r)}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea id={`f-${f.key}`} className="input" value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} maxLength={5000} />
                ) : (
                  <input
                    id={`f-${f.key}`}
                    className="input"
                    type={f.type ?? "text"}
                    step={f.step ?? (f.type === "number" ? "any" : undefined)}
                    min={f.min}
                    required={f.required}
                    autoComplete={f.type === "password" ? "new-password" : "off"}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
                {f.hint && <small>{f.hint}</small>}
              </>
            )}
          </div>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 14 }}>
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

function FormShell({ ctx, title, children, onSubmit, busy, error, submitLabel = "Save" }: { ctx: Ctx; title: string; children: ReactNode; onSubmit: () => void; busy: boolean; error: string; submitLabel?: string }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
      aria-label={title}
    >
      {children}
      {error && (
        <div style={{ marginTop: 14 }}>
          <Alert kind="error">{error}</Alert>
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
        <Button type="button" onClick={ctx.closeCustom}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function useSubmit(ctx: Ctx) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const submit = async (kind: string, body: unknown, msg: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/operations?kind=${kind}`, { body });
      toast("success", msg);
      ctx.closeCustom();
      ctx.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit };
}

function OccupancyForm({ camp, ctx }: { camp: Row; ctx: Ctx }) {
  const [mode, setMode] = useState<"admit" | "discharge">("admit");
  const [n, setN] = useState("10");
  const s = useSubmit(ctx);
  const free = Number(camp.capacity) - Number(camp.current_population);
  return (
    <FormShell
      ctx={ctx}
      title="Change occupancy"
      busy={s.busy}
      error={s.error}
      submitLabel={mode === "admit" ? "Admit" : "Discharge"}
      onSubmit={() => {
        const v = Number.parseInt(n, 10);
        if (!Number.isInteger(v) || v <= 0) return s.setError("Enter a whole number greater than zero");
        void s.submit("camp-occupancy", { camp_id: Number(camp.camp_id), delta: mode === "admit" ? v : -v }, `${camp.camp_name}: ${mode === "admit" ? "admitted" : "discharged"} ${v}`);
      }}
    >
      <p className="muted small" style={{ marginBottom: 14 }}>
        {String(camp.camp_name)} currently shelters {fmtNumber(camp.current_population)} of {fmtNumber(camp.capacity)} ({fmtNumber(free)} free). The change is applied as{" "}
        <code>current_population = current_population ± n</code> in one statement, so simultaneous updates are never lost.
      </p>
      <div className="form-grid">
        <div className="field">
          <span className="field-label">Action</span>
          <div className="segmented" role="group" aria-label="Action">
            <button type="button" aria-pressed={mode === "admit"} onClick={() => setMode("admit")}>
              Admit
            </button>
            <button type="button" aria-pressed={mode === "discharge"} onClick={() => setMode("discharge")}>
              Discharge
            </button>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="occ-n">
            Number of people
          </label>
          <input id="occ-n" className="input" type="number" min={1} step={1} value={n} onChange={(e) => setN(e.target.value)} />
        </div>
      </div>
    </FormShell>
  );
}

function StockForm({ row, ctx }: { row?: Row; ctx: Ctx }) {
  const sources = useOptions(row ? [] : ["warehouses", "resources"]);
  const [v, setV] = useState({ warehouse_id: String(row?.warehouse_id ?? ""), resource_id: String(row?.resource_id ?? ""), delta: "", minimum_threshold: String(row?.minimum_threshold ?? "0"), reason: "" });
  const s = useSubmit(ctx);
  return (
    <FormShell
      ctx={ctx}
      title="Adjust stock"
      busy={s.busy}
      error={s.error}
      onSubmit={() => {
        const delta = Number(v.delta);
        if (!v.warehouse_id || !v.resource_id) return s.setError("Choose a warehouse and resource");
        if (!Number.isFinite(delta) || v.delta === "") return s.setError("Enter the quantity change (negative to remove)");
        if (v.reason.trim().length < 3) return s.setError("Give a reason (at least 3 characters)");
        void s.submit(
          "inventory",
          { warehouse_id: Number(v.warehouse_id), resource_id: Number(v.resource_id), delta, minimum_threshold: Number(v.minimum_threshold || 0), reason: v.reason.trim(), ...(row ? { expected_quantity: Number(row.quantity_available) } : {}) },
          "Stock adjusted",
        );
      }}
    >
      {row ? (
        <Alert kind="info">
          {String(row.resource_name)} at {String(row.warehouse_name)}: <b className="num">{fmtNumber(row.quantity_available, 3)} {String(row.unit)}</b> available when you opened this form. If someone changes it first, your adjustment is rejected rather than applied to stale data.
        </Alert>
      ) : null}
      <div className="form-grid" style={{ marginTop: 14 }}>
        {!row && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="st-w">Warehouse</label>
              <select id="st-w" className="input" value={v.warehouse_id} onChange={(e) => setV({ ...v, warehouse_id: e.target.value })}>
                <option value="">Select…</option>
                {(sources.warehouses ?? []).filter((w) => w.status === "ACTIVE").map((w) => (
                  <option key={String(w.warehouse_id)} value={String(w.warehouse_id)}>{String(w.warehouse_name)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="st-r">Resource</label>
              <select id="st-r" className="input" value={v.resource_id} onChange={(e) => setV({ ...v, resource_id: e.target.value })}>
                <option value="">Select…</option>
                {(sources.resources ?? []).map((r) => (
                  <option key={String(r.resource_id)} value={String(r.resource_id)}>{String(r.resource_name)} ({String(r.unit)})</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label className="field-label" htmlFor="st-d">Quantity change</label>
          <input id="st-d" className="input" type="number" step="0.001" value={v.delta} onChange={(e) => setV({ ...v, delta: e.target.value })} placeholder="+500 or -20" />
          <small>Positive to receive, negative to write off</small>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="st-t">Low-stock threshold</label>
          <input id="st-t" className="input" type="number" min={0} step="0.001" value={v.minimum_threshold} onChange={(e) => setV({ ...v, minimum_threshold: e.target.value })} />
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="st-reason">Reason</label>
          <input id="st-reason" className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Donation received, stock count correction…" />
        </div>
      </div>
    </FormShell>
  );
}

function DeliveryForm({ ctx, allocationId }: { ctx: Ctx; allocationId?: string }) {
  const o = useOptions(["allocations", "vehicles", "drivers", "volunteers"]);
  const [v, setV] = useState({ allocation_id: allocationId ?? "", vehicle_id: "", driver_id: "", expected_arrival: toLocalInput(new Date(Date.now() + 86400000)) });
  const [crew, setCrew] = useState<number[]>([]);
  const s = useSubmit(ctx);
  const allocs = (o.allocations ?? []).filter((a) => a.status === "ALLOCATED" && !a.delivery_status);
  return (
    <FormShell
      ctx={ctx}
      title="Plan delivery"
      busy={s.busy}
      error={s.error}
      submitLabel="Plan delivery"
      onSubmit={() => {
        if (!v.allocation_id || !v.vehicle_id || !v.driver_id) return s.setError("Choose an allocation, vehicle and driver");
        const eta = new Date(v.expected_arrival);
        if (Number.isNaN(eta.getTime()) || eta.getTime() <= Date.now()) return s.setError("Expected arrival must be in the future");
        void s.submit("deliveries", { allocation_id: Number(v.allocation_id), vehicle_id: Number(v.vehicle_id), driver_id: Number(v.driver_id), expected_arrival: eta.toISOString(), volunteer_ids: crew }, "Delivery planned; vehicle and crew reserved");
      }}
    >
      <div className="form-grid">
        <div className="field full">
          <label className="field-label" htmlFor="dl-a">Allocation</label>
          <select id="dl-a" className="input" value={v.allocation_id} onChange={(e) => setV({ ...v, allocation_id: e.target.value })}>
            <option value="">Select…</option>
            {allocs.map((a) => (
              <option key={String(a.allocation_id)} value={String(a.allocation_id)}>
                #{String(a.allocation_id)} — {String(a.camp_name)} ({((a.items as Row[]) ?? []).map((i) => i.resource_name).join(", ")})
              </option>
            ))}
          </select>
          {o.allocations && !allocs.length && <small>No allocation is waiting for a delivery.</small>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dl-v">Vehicle</label>
          <select id="dl-v" className="input" value={v.vehicle_id} onChange={(e) => setV({ ...v, vehicle_id: e.target.value })}>
            <option value="">Select…</option>
            {(o.vehicles ?? []).filter((x) => x.status === "AVAILABLE").map((x) => (
              <option key={String(x.vehicle_id)} value={String(x.vehicle_id)}>{String(x.vehicle_number)} · {titleCase(x.vehicle_type)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dl-d">Driver</label>
          <select id="dl-d" className="input" value={v.driver_id} onChange={(e) => setV({ ...v, driver_id: e.target.value })}>
            <option value="">Select…</option>
            {(o.drivers ?? []).map((x) => (
              <option key={String(x.user_id)} value={String(x.user_id)} disabled={Boolean(x.busy)}>{String(x.full_name)}{x.busy ? " (on a delivery)" : ""}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="dl-e">Expected arrival</label>
          <input id="dl-e" className="input" type="datetime-local" value={v.expected_arrival} onChange={(e) => setV({ ...v, expected_arrival: e.target.value })} />
        </div>
        <fieldset className="field full" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 6 }}>Volunteer crew (optional)</legend>
          <div className="chip-row">
            {(o.volunteers ?? []).filter((x) => x.availability_status === "AVAILABLE").map((x) => {
              const idn = Number(x.volunteer_id);
              const on = crew.includes(idn);
              return (
                <button type="button" key={idn} className="chip" aria-pressed={on} onClick={() => setCrew(on ? crew.filter((c) => c !== idn) : [...crew, idn])}>
                  {String(x.full_name)}
                </button>
              );
            })}
            {o.volunteers && !(o.volunteers ?? []).some((x) => x.availability_status === "AVAILABLE") && <span className="small muted">No volunteers available.</span>}
          </div>
        </fieldset>
      </div>
    </FormShell>
  );
}

function RoleForm({ user, ctx }: { user: Row; ctx: Ctx }) {
  const [role, setRole] = useState(String(user.role_name));
  const s = useSubmit(ctx);
  return (
    <FormShell ctx={ctx} title="Change role" busy={s.busy} error={s.error} onSubmit={() => void s.submit("user-role", { user_id: Number(user.user_id), role_name: role, is_active: Boolean(user.is_active) }, `Role updated for ${user.full_name}`)}>
      <div className="field">
        <label className="field-label" htmlFor="role-sel">Role for {String(user.full_name)}</label>
        <select id="role-sel" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          {["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER", "DRIVER"].map((r) => (
            <option key={r} value={r}>{titleCase(r)}</option>
          ))}
        </select>
        <small>Existing sessions are revoked so the new permissions apply immediately.</small>
      </div>
    </FormShell>
  );
}

function PasswordForm({ user, ctx }: { user: Row; ctx: Ctx }) {
  const [pw, setPw] = useState("");
  const s = useSubmit(ctx);
  return (
    <FormShell
      ctx={ctx}
      title="Set password"
      busy={s.busy}
      error={s.error}
      onSubmit={() => {
        if (pw.length < 12) return s.setError("Use at least 12 characters");
        void s.submit("user-password", { user_id: Number(user.user_id), password: pw }, `Password set for ${user.full_name}`);
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="pw-new">New password for {String(user.full_name)}</label>
        <input id="pw-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={12} maxLength={72} />
        <small>12–72 characters. The user is signed out of every device.</small>
      </div>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
export default function Management({ module }: { module: string }) {
  const def = Object.hasOwn(modules, module) ? modules[module] : undefined;
  const me = useMe();
  const manager = isManager(me);
  const kind = def?.kind ?? module;
  const { data, error, loading, reload } = useApi<Row[]>(def ? `/api/operations?kind=${kind}` : null, [module]);
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<{ values: Row; editing: boolean } | null>(null);
  const [custom, setCustom] = useState<{ node: ReactNode; title: string } | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);

  const ctx: Ctx = useMemo(
    () => ({
      me,
      manager,
      reload: () => void reload(),
      confirm,
      run: async (k, body, msg, method) => {
        try {
          await api(`/api/operations?kind=${k}`, { body, method });
          toast("success", msg);
          await reload();
          return true;
        } catch (e) {
          toast("error", e instanceof Error ? e.message : "Operation failed");
          return false;
        }
      },
      openForm: (values = {}, editing = false) => setForm({ values, editing }),
      openCustom: (node, title) => setCustom({ node, title }),
      closeCustom: () => setCustom(null),
    }),
    [me, manager, reload, confirm, toast],
  );

  if (!def)
    return (
      <EmptyState
        title="Module not found"
        text="This page does not exist."
        action={
          <Link href="/" className="btn">
            Back to Command Center
          </Link>
        }
      />
    );

  const canCreate = def.canCreate?.(me) ?? false;
  const canEdit = def.canEdit?.(me) ?? false;
  const createNow = () => {
    if (module === "inventory") ctx.openCustom(<StockForm ctx={ctx} />, "Adjust stock");
    else if (module === "deliveries") ctx.openCustom(<DeliveryForm ctx={ctx} />, "Plan delivery");
    else ctx.openForm({}, false);
  };
  const hasActions = Boolean(def.rowActions || (canEdit && def.key) || def.detail || (def.deletable && manager));

  return (
    <>
      <PageHeader
        eyebrow={def.eyebrow}
        title={def.title}
        lead={def.lead}
        actions={
          <>
            <Button icon={<RefreshCw size={15} />} onClick={() => void reload()} loading={loading && Boolean(data)}>
              Refresh
            </Button>
            {canCreate && (
              <Button variant="primary" icon={module === "users" ? <UserPlus size={15} /> : <Plus size={15} />} onClick={createNow}>
                {def.createLabel ?? `New ${def.title.replace(/s$/, "").toLowerCase()}`}
              </Button>
            )}
          </>
        }
      />
      {def.banner && <div style={{ marginBottom: 14 }}>{def.banner(data, ctx)}</div>}
      {me?.role_name === "DRIVER" && module === "deliveries" && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="info">You see only deliveries assigned to you. Update progress as you dispatch and arrive.</Alert>
        </div>
      )}
      <DataTable
        label={def.title}
        rows={data}
        columns={def.columns}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        filters={def.filters}
        initialSort={def.initialSort}
        rowKey={(r) => String(r[def.key ?? ""] ?? r.audit_id ?? r.change_id ?? r.movement_id ?? r.delivery_id ?? r.allocation_id ?? `${r.warehouse_id}-${r.resource_id}`)}
        onRowClick={def.detail ? setDetail : undefined}
        empty={<EmptyState title={`No ${def.title.toLowerCase()} yet`} text={canCreate ? "Create the first record to get started." : undefined} action={canCreate ? <Button variant="primary" icon={<Plus size={14} />} onClick={createNow}>{def.createLabel ?? "Create"}</Button> : undefined} />}
        actions={
          hasActions
            ? (r) => (
                <>
                  {def.rowActions?.(r, ctx)}
                  {def.detail && (
                    <Button size="sm" iconOnly aria-label="View details" icon={<Eye size={13} />} onClick={() => setDetail(r)} />
                  )}
                  {canEdit && def.key && (
                    <Button size="sm" icon={<Pencil size={13} />} onClick={() => ctx.openForm(r, true)}>
                      Edit
                    </Button>
                  )}
                  {def.deletable && manager && def.key && (
                    <Button
                      size="sm"
                      variant="danger"
                      iconOnly
                      aria-label="Delete"
                      title="Delete"
                      icon={<Trash2 size={13} />}
                      onClick={async () => {
                        if (await confirm({ title: "Delete this record?", text: "This cannot be undone. Records still referenced elsewhere are protected by foreign keys and will not be deleted.", danger: true, confirmLabel: "Delete" }))
                          await ctx.run(`${kind}&id=${r[def.key!]}`, undefined, "Record deleted", "DELETE");
                      }}
                    />
                  )}
                </>
              )
            : undefined
        }
      />
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.editing ? `Edit ${def.title.replace(/s$/, "").toLowerCase()}` : def.createLabel ?? `New ${def.title.replace(/s$/, "").toLowerCase()}`} description={form?.editing ? "Changes are checked against the version you loaded." : undefined}>
        {form && <EntityForm def={def} initial={form.values} editing={form.editing} writeKind={def.writeKind ?? kind} onCancel={() => setForm(null)} onDone={() => { setForm(null); void reload(); }} />}
      </Modal>
      <Modal open={Boolean(custom)} onClose={() => setCustom(null)} title={custom?.title ?? ""}>
        {custom?.node}
      </Modal>
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Record details" drawer>
        {detail && <pre className="code" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(detail, null, 2)}</pre>}
      </Modal>
    </>
  );
}
