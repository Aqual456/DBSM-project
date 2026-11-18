import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { hash } from "bcryptjs";

/**
 * Local recovery tool: sets a new password for an existing account and signs it out everywhere.
 * Usage (PowerShell):
 *   $env:RESET_EMAIL='admin@reliefflow.local'; $env:RESET_PASSWORD='new-password-12+chars'; npm.cmd run db:reset-password
 */
async function main() {
  const { pool } = await import("../src/lib/postgres");
  const email = process.env.RESET_EMAIL?.trim().toLowerCase();
  const password = process.env.RESET_PASSWORD ?? "";
  if (!email || password.length < 12 || Buffer.byteLength(password, "utf8") > 72)
    throw new Error("Set RESET_EMAIL and RESET_PASSWORD (12-72 characters)");
  const r = await pool.query("UPDATE app_users SET password_hash = $1, is_active = true WHERE lower(email) = $2 RETURNING user_id", [await hash(password, 12), email]);
  if (!r.rowCount) throw new Error(`No account with e-mail ${email}`);
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [r.rows[0].user_id]);
  await pool.query("DELETE FROM login_attempts WHERE email = $1", [email]);
  console.log(`Password updated for ${email}. Existing sessions were signed out.`);
  await pool.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
