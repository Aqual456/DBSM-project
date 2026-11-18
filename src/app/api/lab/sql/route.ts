import { z } from "zod";
import { endpoint, actor, allRoles, body, HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/cache";
import { guardSql } from "@/lib/lab/sqlGuard";
import { runSandboxed } from "@/lib/lab/sandbox";
import { logger } from "@/lib/logger";

/**
 * SQL playground. Security layers: (1) authenticated + rate limited; (2) static guard:
 * one statement, allow-listed statement types, blocked commands/functions; (3) separate
 * lab database with sanitised data; (4) non-superuser role with only table privileges;
 * (5) statement/lock timeouts; (6) the transaction is ALWAYS rolled back.
 */
export const POST = endpoint(async (req) => {
  const u = await actor(req, allRoles);
  const { sql } = z.strictObject({ sql: z.string().max(5000) }).parse(await body(req));
  const limit = await rateLimit(`rf:rl:sql:${u.user_id}`, 30, 60);
  if (!limit.allowed) throw new HttpError(429, "Rate limit reached (30 statements per minute)", "RATE_LIMITED");
  const g = guardSql(sql);
  if (!g.ok) throw new HttpError(400, g.reason, "SQL_REJECTED");
  logger.info("lab sql", { user: u.user_id, kind: g.kind, chars: sql.length });
  try {
    const r = await runSandboxed([g.statement], { timeoutMs: 4000 });
    return { ...r, kind: g.kind, remaining: limit.remaining };
  } catch (e) {
    if (["28P01", "3D000", "ECONNREFUSED"].includes((e as { code?: string }).code ?? ""))
      throw new HttpError(503, "The lab database is not set up. Run: npm run lab:setup", "LAB_UNAVAILABLE");
    throw e;
  }
});
