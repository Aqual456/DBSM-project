import { z } from "zod";
import { endpoint, actor, allRoles, body, HttpError } from "@/lib/api";
import { rateLimit } from "@/lib/cache";
import { catalog, findDemo, sections } from "@/lib/lab/demos";
import { runSandboxed } from "@/lib/lab/sandbox";

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  const unit = Number(req.nextUrl.searchParams.get("unit")) || undefined;
  return { sections, demos: catalog(unit) };
});

export const POST = endpoint(async (req) => {
  const u = await actor(req, allRoles);
  const { id } = z.strictObject({ id: z.string().max(80) }).parse(await body(req));
  const demo = findDemo(id);
  if (!demo) throw new HttpError(404, "Unknown demonstration", "NOT_FOUND");
  if (!(await rateLimit(`rf:rl:lab:${u.user_id}`, 60, 60)).allowed) throw new HttpError(429, "Too many lab runs. Wait a minute", "RATE_LIMITED");
  try {
    return { id, ...(await runSandboxed(demo.steps, { timeoutMs: 8000 })) };
  } catch (e) {
    if (["28P01", "3D000", "ECONNREFUSED"].includes((e as { code?: string }).code ?? ""))
      throw new HttpError(503, "The lab database is not set up. Run: npm run lab:setup", "LAB_UNAVAILABLE");
    throw e;
  }
});
