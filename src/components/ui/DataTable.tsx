"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EmptyState, ErrorState, SkeletonRows, Button } from "./primitives";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  value?: (row: T) => unknown; // used for sort/search
  align?: "right";
  sortable?: boolean;
  width?: number | string;
};
export type Filter<T> = { key: string; label: string; options: string[]; value: (row: T) => unknown };

/** Client-side search, filter, sort and pagination over rows already authorised by the API. */
export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  loading,
  error,
  onRetry,
  rowKey,
  onRowClick,
  actions,
  filters = [],
  searchPlaceholder = "Search…",
  pageSize = 12,
  empty,
  toolbar,
  initialSort,
  label,
}: {
  rows: T[] | null;
  columns: Column<T>[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  actions?: (row: T) => ReactNode;
  filters?: Filter<T>[];
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: ReactNode;
  toolbar?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  label: string;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<Record<string, string>>({});
  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : r[c.key]);

  const filtered = useMemo(() => {
    let out = rows ?? [];
    for (const f of filters) if (active[f.key]) out = out.filter((r) => String(f.value(r)) === active[f.key]);
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => columns.some((c) => String(val(c, r) ?? "").toLowerCase().includes(needle)));
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c)
        out = [...out].sort((a, b) => {
          const x = val(c, a), y = val(c, b);
          const nx = Number(x), ny = Number(y);
          const cmp = x == null ? 1 : y == null ? -1 : Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "" ? nx - ny : String(x).localeCompare(String(y));
          return sort.dir === "asc" ? cmp : -cmp;
        });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, active, columns, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="table-tools">
        <div className="search">
          <Search size={15} aria-hidden />
          <input
            className="input"
            type="search"
            placeholder={searchPlaceholder}
            aria-label={`Search ${label}`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {filters.map((f) => (
          <select
            key={f.key}
            className="input"
            aria-label={`Filter by ${f.label}`}
            value={active[f.key] ?? ""}
            onChange={(e) => {
              setActive({ ...active, [f.key]: e.target.value });
              setPage(1);
            }}
          >
            <option value="">All {f.label.toLowerCase()}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        ))}
        <div className="spacer" />
        {toolbar}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading && !rows ? (
        <SkeletonRows />
      ) : !filtered.length ? (
        (rows?.length ?? 0) > 0 ? <EmptyState title="No matching records" text="Try a different search or clear the filters." /> : empty ?? <EmptyState title="No records yet" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data" aria-label={label} aria-busy={loading || undefined}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={c.align === "right" ? "num" : ""} style={{ width: c.width }} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.sortable === false ? (
                        c.header
                      ) : (
                        <button type="button" onClick={() => setSort(sort?.key === c.key && sort.dir === "asc" ? { key: c.key, dir: "desc" } : { key: c.key, dir: "asc" })}>
                          {c.header}
                          {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      )}
                    </th>
                  ))}
                  {actions && (
                    <th className="num" style={{ width: 1 }}>
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className={onRowClick ? "clickable" : ""}
                    onClick={onRowClick ? (e) => !(e.target as HTMLElement).closest("button,a,input,select") && onRowClick(r) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => e.key === "Enter" && e.target === e.currentTarget && onRowClick(r) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "num" : ""}>
                        {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                      </td>
                    ))}
                    {actions && (
                      <td>
                        <div className="row-actions">{actions(r)}</div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>
              {filtered.length === (rows?.length ?? 0) ? `${filtered.length} records` : `${filtered.length} of ${rows?.length ?? 0} records`}
            </span>
            {pages > 1 && (
              <div className="row">
                <Button size="sm" iconOnly aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)} icon={<ChevronLeft size={14} />} />
                <span className="num">
                  Page {current} of {pages}
                </span>
                <Button size="sm" iconOnly aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)} icon={<ChevronRight size={14} />} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
