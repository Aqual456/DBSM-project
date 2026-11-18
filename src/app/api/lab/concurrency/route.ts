import { z } from "zod";
import { endpoint, actor, allRoles, body, HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/cache";
import { runScenario, scenarios } from "@/lib/lab/concurrency";

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  return Object.entries(scenarios).map(([id, s]) => ({ id, title: s.title, level: s.level, explain: s.explain, outcome: s.outcome }));
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, allRoles);
  const { id } = z.strictObject({ id: z.string().max(60) }).parse(await body(req));
  if (!Object.hasOwn(scenarios, id)) throw new HttpError(404, "Unknown scenario", "NOT_FOUND");
  if (!(await rateLimit(`rf:rl:conc:${u.user_id}`, 20, 60)).allowed) throw new HttpError(429, "Too many runs. Wait a minute", "RATE_LIMITED");
  return runScenario(id);
});
