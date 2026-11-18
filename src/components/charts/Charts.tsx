"use client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, LabelList, Cell,
} from "recharts";
import { fmtNumber } from "@/lib/client";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
// Status colours (severity is a state, not a series) — always shown with a text label.
export const STATUS: Record<string, string> = { CRITICAL: "#d03b3b", HIGH: "#ec835a", MODERATE: "#fab219", LOW: "#94a3b8" };

type TT = { active?: boolean; label?: string; payload?: { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }[] };
function Tip({ active, label, payload, unitKey }: TT & { unitKey?: string }) {
  if (!active || !payload?.length) return null;
  const unit = unitKey ? String(payload[0]?.payload?.[unitKey] ?? "") : "";
  return (
    <div className="tt">
      <b>{label}</b>
      {payload.map((p) => (
        <div className="tt-row" key={p.name}>
          <span>
            <i style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num">
            {fmtNumber(p.value, 1)} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

const axis = { stroke: "var(--subtle)", fontSize: 11.5, tickLine: false, axisLine: false } as const;

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend" aria-hidden={false}>
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Grouped horizontal bars: outstanding demand vs available stock per resource. */
export function DemandSupplyChart({ data }: { data: { resource_name: string; unit: string; demand: number; available: number }[] }) {
  const height = Math.max(220, data.length * 38 + 40);
  return (
    <div style={{ width: "100%", height }} role="img" aria-label="Outstanding demand versus available stock by resource">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }} barGap={2} barCategoryGap={10}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" {...axis} tickFormatter={(v) => fmtNumber(v)} />
          <YAxis type="category" dataKey="resource_name" {...axis} width={150} stroke="var(--text-2)" />
          <Tooltip content={<Tip unitKey="unit" />} cursor={{ fill: "rgba(37,99,235,0.05)" }} />
          <Bar dataKey="demand" name="Outstanding demand" fill={SERIES[1]} radius={[0, 4, 4, 0]} barSize={11} animationDuration={700}>
            <LabelList dataKey="demand" position="right" formatter={(v: unknown) => (Number(v) ? fmtNumber(v) : "")} style={{ fill: "var(--muted)", fontSize: 11 }} />
          </Bar>
          <Bar dataKey="available" name="Available stock" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={11} animationDuration={700}>
            <LabelList dataKey="available" position="right" formatter={(v: unknown) => fmtNumber(v)} style={{ fill: "var(--muted)", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, series, label }: { data: Record<string, unknown>[]; series: { key: string; name: string }[]; label: string }) {
  return (
    <div className="chart-box" role="img" aria-label={label}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -12, right: 12, top: 8, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[i]} stopOpacity={0.22} />
                <stop offset="100%" stopColor={SERIES[i]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" {...axis} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...axis} allowDecimals={false} tickFormatter={(v) => fmtNumber(v)} />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
          {series.map((s, i) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={SERIES[i]} strokeWidth={2} fill={`url(#g-${s.key})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} animationDuration={800} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Severity distribution: one bar per level, status colours + text labels. */
export function SeverityChart({ data }: { data: { severity: string; count: number }[] }) {
  return (
    <div style={{ width: "100%", height: 200 }} role="img" aria-label="Open disasters by severity">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -18, right: 8, top: 18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="severity" {...axis} tickFormatter={(v) => String(v).charAt(0) + String(v).slice(1).toLowerCase()} />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(37,99,235,0.05)" }} />
          <Bar dataKey="count" name="Disasters" radius={[4, 4, 0, 0]} barSize={34} animationDuration={700}>
            {data.map((d) => (
              <Cell key={d.severity} fill={STATUS[d.severity] ?? SERIES[0]} />
            ))}
            <LabelList dataKey="count" position="top" style={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Simple ranked bars (one series). */
export function RankBars({ data, x, y, name, unit, color = SERIES[0], height }: { data: Record<string, unknown>[]; x: string; y: string; name: string; unit?: string; color?: string; height?: number }) {
  return (
    <div style={{ width: "100%", height: height ?? Math.max(180, data.length * 34 + 30) }} role="img" aria-label={name}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 52, top: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" {...axis} tickFormatter={(v) => fmtNumber(v)} />
          <YAxis type="category" dataKey={x} {...axis} width={170} stroke="var(--text-2)" />
          <Tooltip content={<Tip />} cursor={{ fill: "rgba(37,99,235,0.05)" }} />
          <Bar dataKey={y} name={name} fill={color} radius={[0, 4, 4, 0]} barSize={14} animationDuration={700}>
            <LabelList dataKey={y} position="right" formatter={(v: unknown) => `${fmtNumber(v, 1)}${unit ?? ""}`} style={{ fill: "var(--muted)", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
