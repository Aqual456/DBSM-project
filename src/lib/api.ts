import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { ZodError } from "zod";
import { pool } from "./postgres";
import { logger } from "./logger";
import { cacheInvalidate } from "./cache";

export type Role = "ADMIN" | "RELIEF_COORDINATOR" | "FIELD_OFFICER" | "DRIVER";
export type Actor = { user_id: string; role_name: Role; full_name: string; email?: string };
export const managers: Role[] = ["ADMIN", "RELIEF_COORDINATOR"];
export const staff: Role[] = ["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER"];
export const allRoles: Role[] = ["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER", "DRIVER"];

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

/** Same-origin enforcement for state-changing requests (CSRF defence in depth with SameSite=strict cookies). */
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    throw new HttpError(403, "Cross-origin write rejected", "CSRF_REJECTED");
  const site = req.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site))
    throw new HttpError(403, "Cross-site write rejected", "CSRF_REJECTED");
  if (
    ["POST", "PATCH", "PUT"].includes(req.method) &&
    !req.headers.get("content-type")?.startsWith("application/json")
  )
    throw new HttpError(415, "JSON content type required", "UNSUPPORTED_MEDIA_TYPE");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve the signed-in user from the opaque session cookie and enforce roles. */
export async function actor(req: NextRequest, roles?: readonly Role[]): Promise<Actor> {
  if (!["GET", "HEAD"].includes(req.method)) checkOrigin(req);
  const token = req.cookies.get("rf_session")?.value;
  if (!token || token.length > 200) throw new HttpError(401, "Please sign in", "UNAUTHENTICATED");
  const r = await pool.query(
    `SELECT u.user_id, u.full_name, u.email, r.role_name
       FROM sessions s JOIN app_users u USING (user_id) JOIN roles r USING (role_id)
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [hashToken(token)],
  );
  if (!r.rowCount) throw new HttpError(401, "Session expired. Please sign in again", "SESSION_EXPIRED");
  if (roles && !roles.includes(r.rows[0].role_name))
    throw new HttpError(403, "You do not have permission for this action", "FORBIDDEN");
  return r.rows[0];
}

/** Parse a JSON body; malformed JSON becomes a 400 rather than a 500. */
export async function body(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 256_000) throw new HttpError(413, "Request body too large", "PAYLOAD_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Malformed JSON body", "MALFORMED_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HttpError(400, "JSON object expected", "MALFORMED_JSON");
  return parsed as Record<string, unknown>;
}

type PgError = { code?: string; message?: string; errno?: number };
const connectionCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "57P03", "08006", "08001", "08003"]);

/** Map any thrown error to a safe JSON response. Raw database errors never reach clients. */
export function toErrorResponse(e: unknown, requestId: string) {
  const respond = (status: number, code: string, error: string, details?: unknown) =>
    NextResponse.json({ error, code, requestId, ...(details ? { details } : {}) }, { status, headers: { "x-request-id": requestId } });
  if (e instanceof HttpError) return respond(e.status, e.code, e.message);
  if (e instanceof ZodError)
    return respond(
      400,
      "VALIDATION_ERROR",
      e.issues.slice(0, 3).map((i) => `${i.path.join(".") || "Input"}: ${i.message}`).join("; "),
      e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  if (e instanceof SyntaxError) return respond(400, "MALFORMED_JSON", "Malformed JSON body");
  const { code, message } = (e ?? {}) as PgError;
  switch (code) {
    case "23505": return respond(409, "DUPLICATE", "A matching record already exists");
    case "23503": return respond(409, "REFERENCE_VIOLATION", "Referenced record does not exist or is still in use");
    case "23514": return respond(409, "CONSTRAINT_VIOLATION", "Operation violates a data constraint");
    case "23502": return respond(400, "MISSING_VALUE", "A required value is missing");
    case "P0001": return respond(409, "BUSINESS_RULE", message ?? "Business rule violated");
    case "22P02": case "22003": case "22007": case "22008":
      return respond(400, "INVALID_VALUE", "A value has an invalid format or is out of range");
    case "40P01": return respond(409, "DEADLOCK", "Concurrent update conflict (deadlock). Please retry");
    case "40001": return respond(409, "SERIALIZATION_FAILURE", "Concurrent update conflict. Please retry");
    case "55P03": return respond(409, "LOCK_TIMEOUT", "Record is busy. Please retry");
    case "57014": return respond(504, "QUERY_TIMEOUT", "Query exceeded its time limit");
  }
  if (code && connectionCodes.has(code))
    return respond(503, "SERVICE_UNAVAILABLE", "Database unavailable. Check configuration");
  if (message && /MongoDB is not configured|MongoServerSelectionError|connect ECONNREFUSED/.test(message))
    return respond(503, "SERVICE_UNAVAILABLE", "A required database is unavailable");
  logger.error("unhandled error", { requestId, code, name: (e as Error)?.name });
  return respond(500, "INTERNAL_ERROR", "Unexpected server error");
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<unknown>;

/** Standard route wrapper: request id, structured access log, error mapping and cache invalidation after writes. */
export function endpoint<C = unknown>(fn: Handler<C>) {
  return async (req: NextRequest, ctx: C) => {
    const requestId = randomUUID();
    const started = performance.now();
    let status = 200;
    try {
      const result = await fn(req, ctx);
      if (result instanceof NextResponse) {
        status = result.status;
        result.headers.set("x-request-id", requestId);
        return result;
      }
      if (req.method !== "GET" && req.method !== "HEAD") await cacheInvalidate("rf:cache:");
      return NextResponse.json(result ?? null, { headers: { "x-request-id": requestId } });
    } catch (e) {
      const res = toErrorResponse(e, requestId);
      status = res.status;
      return res;
    } finally {
      logger.info("api", {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        kind: req.nextUrl.searchParams.get("kind") ?? undefined,
        status,
        ms: +(performance.now() - started).toFixed(1),
      });
    }
  };
}

/** Run fn in a single PostgreSQL transaction. The acting user is exposed to triggers via reliefflow.user_id. */
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>, user?: Actor) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '5s'");
    if (user) await c.query("SELECT set_config('reliefflow.user_id', $1, true)", [String(user.user_id)]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(c: PoolClient, user: Actor, action: string, data: unknown) {
  await c.query("INSERT INTO audit_logs(user_id, action, details) VALUES ($1, $2, $3)", [
    user.user_id,
    action,
    JSON.stringify(data ?? {}),
  ]);
}

/** Parse ?page=&pageSize= safely. */
export function paging(req: NextRequest, defaultSize = 25, max = 200) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10) || 1));
  const pageSize = Math.max(1, Math.min(max, Number.parseInt(req.nextUrl.searchParams.get("pageSize") ?? String(defaultSize), 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
