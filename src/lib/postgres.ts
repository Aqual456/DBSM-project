import { Pool } from "pg";
declare global {
  var postgresPool: Pool | undefined;
}
export const pool =
  global.postgresPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
if (process.env.NODE_ENV !== "production") global.postgresPool = pool;
