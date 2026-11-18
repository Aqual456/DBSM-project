import { z } from "zod";
import { endpoint, actor, allRoles, managers, body, HttpError } from "@/lib/api";
import { mongoDemos, resetMongoLab, runMongoDemo } from "@/lib/lab/mongoLab";

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  return Object.entries(mongoDemos).map(([id, d]) => ({ id, title: d.title, explain: d.explain }));
});

export const POST = endpoint(async (req) => {
  const b = z.strictObject({ id: z.string().max(40) }).parse(await body(req));
  if (b.id === "reset") {
    await actor(req, managers);
    return resetMongoLab();
  }
  await actor(req, allRoles);
  if (!Object.hasOwn(mongoDemos, b.id)) throw new HttpError(404, "Unknown demo", "NOT_FOUND");
  return runMongoDemo(b.id);
});
