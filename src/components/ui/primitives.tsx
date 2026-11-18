"use client";
import { type ReactNode, type ButtonHTMLAttributes, useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { titleCase } from "@/lib/client";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "danger" | "danger-solid" | "ghost" | "default";
  size?: "sm" | "md";
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
};
export function Button({ variant = "default", size = "md", icon, loading, iconOnly, children, className = "", ...rest }: BtnProps) {
  return (
    <button
      className={`btn ${variant !== "default" ? variant : ""} ${size === "sm" ? "sm" : ""} ${iconOnly ? "icon" : ""} ${className}`}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

const tone: Record<string, string> = {
  ACTIVE: "red", CRITICAL: "red", SEVERE: "red", REJECTED: "red", CANCELLED: "gray", FAILED: "red", NO_STOCK: "red", SHORTAGE: "red",
  HIGH: "amber", DELAYED: "amber", PENDING: "amber", PARTIALLY_FULFILLED: "amber", FULL: "amber", MAINTENANCE: "amber", MONITORING: "amber", RUNNING: "amber", ASSIGNED: "amber",
  MODERATE: "blue", MEDIUM: "blue", APPROVED: "blue", ALLOCATED: "violet", IN_TRANSIT: "violet", PLANNED: "blue", IN_USE: "violet", OPTIONS: "blue",
  LOW: "gray", CONTAINED: "teal", OPEN: "teal", AVAILABLE: "green", DELIVERED: "green", FULFILLED: "green", RESOLVED: "green", SUCCEEDED: "green", CLOSED: "gray", INACTIVE: "gray", UNAVAILABLE: "gray", COVERED: "green", OK: "green",
};
/** Status pill: colour is always paired with the text label (never colour alone). */
export function Badge({ value, label, color }: { value?: unknown; label?: ReactNode; color?: string }) {
  const v = String(value ?? "");
  return <span className={`badge ${color ?? tone[v] ?? "gray"}`}>{label ?? titleCase(v)}</span>;
}

export function Card({ title, subtitle, actions, children, className = "", pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, lead, actions }: { eyebrow?: string; title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Skeleton({ h = 16, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} aria-hidden />;
}
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={18} w={`${92 - (i % 3) * 14}%`} />
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <Inbox size={22} />}</div>
      <h3>{title}</h3>
      {text && <p className="small">{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert">
      <div className="empty-icon" style={{ background: "var(--danger-50)", color: "var(--danger)" }}>
        <AlertTriangle size={22} />
      </div>
      <h3>Something went wrong</h3>
      <p className="small">{message}</p>
      {onRetry && (
        <div style={{ marginTop: 14 }}>
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "error" | "warn" | "ok"; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Meter({ value, max = 100, tone: t }: { value: number; max?: number; tone?: "teal" | "warn" | "danger" }) {
  const pct = Math.max(0, Math.min(100, (100 * value) / (max || 1)));
  return (
    <div className={`meter ${t ?? ""}`} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kpi({ label, value, foot, icon, iconTone, meter, delay = 0 }: { label: string; value: ReactNode; foot?: ReactNode; icon?: ReactNode; iconTone?: string; meter?: { value: number; max?: number; tone?: "teal" | "warn" | "danger" }; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.article
      className="card kpi"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className={`kpi-icon ${iconTone ?? ""}`}>{icon}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
      {meter && <Meter {...meter} />}
    </motion.article>
  );
}

export function Field({ label, hint, error, children, full }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; full?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {hint && !error && <small>{hint}</small>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" className="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}>
      {children}
    </motion.div>
  );
}
