import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { hash } from "bcryptjs";
async function main() {
  const { pool } = await import("../src/lib/postgres");
  const email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)");
  await pool.query(
    `INSERT INTO app_users(role_id,full_name,email,password_hash) SELECT role_id,'Administrator',$1,$2 FROM roles WHERE role_name='ADMIN' ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash WHERE app_users.password_hash='REPLACE_WITH_ARGON2_HASH'`,
    [email.toLowerCase(), await hash(password, 12)],
  );
  console.log(
    "Administrator setup complete; existing working credentials preserved",
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
