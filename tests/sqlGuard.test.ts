import test from "node:test";
import assert from "node:assert/strict";
import { guardSql, stripLiterals } from "../src/lib/lab/sqlGuard";

const ok = (sql: string) => assert.equal(guardSql(sql).ok, true, sql);
const bad = (sql: string) => assert.equal(guardSql(sql).ok, false, sql);

test("allows single read/DML/DDL statements meant for the sandbox", () => {
  ok("SELECT * FROM disasters");
  ok("select 1;");
  ok("WITH x AS (SELECT 1) SELECT * FROM x");
  ok("UPDATE inventory SET quantity_available = 1 WHERE resource_id = 2 RETURNING *");
  ok("CREATE TABLE t AS SELECT 1 AS a");
  ok("EXPLAIN ANALYZE SELECT * FROM bench_movements WHERE warehouse_id = 3");
  ok("SELECT 'a;b' AS has_semicolon_in_string");
  ok("SELECT 1 -- trailing comment; DROP TABLE x");
});

test("rejects multiple statements, including ones hidden after a string", () => {
  bad("SELECT 1; DROP TABLE disasters");
  bad("SELECT 'x'; DELETE FROM inventory");
});

test("rejects transaction control, privileges, roles and system commands", () => {
  for (const s of ["COMMIT", "BEGIN", "ROLLBACK", "GRANT ALL ON disasters TO public", "ALTER SYSTEM SET fsync = off", "CREATE ROLE x", "COPY disasters TO '/tmp/x'", "VACUUM", "SET ROLE postgres", "RESET ALL", "LISTEN x", "DO $$ BEGIN END $$", "CALL refresh_request_status(1)", "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql", "CREATE DATABASE x", "DROP DATABASE reliefflow"])
    bad(s);
});

test("rejects dangerous functions and SELECT INTO", () => {
  for (const s of ["SELECT pg_sleep(10)", "SELECT pg_read_file('/etc/passwd')", "SELECT set_config('role','postgres',false)", "SELECT pg_terminate_backend(1)", "SELECT lo_import('/etc/passwd')", "SELECT * INTO copy FROM disasters", "SELECT * FROM pg_authid", "SELECT pg_advisory_lock(1)"])
    bad(s);
});

test("rejects empty, oversized and unterminated input", () => {
  bad("   ");
  bad("SELECT '" + "x".repeat(6000) + "'");
  bad("SELECT 'unterminated");
  bad("SELECT /* never closed");
});

test("stripLiterals removes strings, identifiers, dollar quotes and comments", () => {
  const s = stripLiterals(`SELECT 'drop;' , "weird;name", $$ ; $$ /* ; */ -- ;\nFROM t`);
  assert.ok(s && !s.includes(";"));
});
