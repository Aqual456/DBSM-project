import { endpoint, actor, allRoles, body } from "@/lib/api";
import { labPing, labPool } from "@/lib/lab/sandbox";
import { buildLab } from "@/lib/lab/setup";
import { resetMongoLab } from "@/lib/lab/mongoLab";

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  const ping = await labPing();
  const counts = ping.ok
    ? (await labPool().query("SELECT row_counts FROM sandbox.lab_snapshot ORDER BY taken_at DESC LIMIT 1")).rows[0]?.row_counts
    : null;
  return { ...ping, counts };
});

/** Admin-only: rebuild the lab snapshot from current operational data (read-only on production). */
export const POST = endpoint(async (req) => {
  await actor(req, ["ADMIN"]);
  await body(req);
  const pg = await buildLab();
  const mongo = await resetMongoLab().catch(() => null);
  return { ...pg, mongo };
});
