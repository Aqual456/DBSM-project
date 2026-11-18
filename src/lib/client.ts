"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** JSON fetch wrapper used by every screen. Errors carry the server's safe message. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const res = await fetch(url, {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    signal: opts.signal,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname);
    }
    throw new ApiError(res.status, d.error || `Request failed (${res.status})`, d.code);
  }
  return data as T;
}

/** Load data with loading/error state and an explicit reload. */
export function useApi<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(url);
      if (mine === seq.current) setData(d);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Loading failed");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

export function fmtNumber(v: unknown, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}
export function fmtDate(v: unknown, withTime = true) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}
export function fmtRelative(v: unknown) {
  if (!v) return "—";
  const ms = Date.now() - new Date(String(v)).getTime();
  const abs = Math.abs(ms);
  const units: [number, string][] = [
    [86400000, "d"],
    [3600000, "h"],
    [60000, "m"],
  ];
  for (const [u, s] of units) if (abs >= u) return ms >= 0 ? `${Math.floor(abs / u)}${s} ago` : `in ${Math.floor(abs / u)}${s}`;
  return "just now";
}
export function titleCase(v: unknown) {
  return String(v ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function toLocalInput(d: Date) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 16);
}
