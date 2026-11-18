/**
 * Static checks for SQL typed into the playground. This is defence in depth: the real
 * security boundary is the sandbox (separate database, least-privilege role, timeouts,
 * forced ROLLBACK). The guard gives clear feedback and blocks obviously unsafe input.
 */
export type GuardResult = { ok: true; statement: string; kind: string } | { ok: false; reason: string };

/** Replace string literals, quoted identifiers, dollar-quoted bodies and comments with spaces. */
export function stripLiterals(sql: string) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
      out += " ";
    } else if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === q && sql[i + 1] === q) i += 2;
        else if (sql[i] === q) break;
        else i++;
      }
      if (i >= sql.length) return null;
      i++;
      out += q === "'" ? " '' " : ' "x" ';
    } else if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        if (end < 0) return null;
        i = end + m[0].length;
        out += " '' ";
      } else {
        out += ch;
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const ALLOWED_START = /^(select|with|values|table|explain|insert|update|delete|create|alter|drop|truncate|show)\b/;
const BLOCKED: [RegExp, string][] = [
  [/\b(begin|commit|rollback|savepoint|release|start\s+transaction|abort|end)\b\s*(;|$)/, "Transaction control is managed by the sandbox"],
  [/^\s*(commit|rollback|begin|savepoint|release|abort|end|start)\b/, "Transaction control is managed by the sandbox"],
  [/\bcopy\b/, "COPY is not allowed"],
  [/\b(grant|revoke)\b/, "Privilege changes are not allowed"],
  [/\b(role|user|database|tablespace|extension|subscription|publication|server|foreign\s+data\s+wrapper|event\s+trigger|language|policy)\b\s/, "This object type cannot be managed from the playground"],
  [/\balter\s+system\b/, "ALTER SYSTEM is not allowed"],
  [/\b(function|procedure|trigger|rule|operator|cast|aggregate)\b/, "Creating routines/triggers is not allowed in the playground (see the curated trigger demos)"],
  [/\b(do|call|listen|notify|unlisten|vacuum|cluster|reindex|checkpoint|load|lock|prepare|execute|deallocate|discard|reset|security|import)\b/, "This command is not allowed in the playground"],
  [/^\s*set\b/, "SET is not allowed"],
  [/\b(pg_sleep\w*|pg_read\w*|pg_ls\w*|pg_stat_file|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate\w*|pg_advisory\w*|pg_try_advisory\w*|lo_\w+|dblink\w*|set_config|pg_notify|query_to_xml\w*|table_to_xml\w*|current_setting|pg_file\w*|pg_logical\w*|pg_replication\w*|pg_switch_wal|pg_promote|pg_backup\w*)\s*\(/, "This function is not allowed"],
  [/\b(pg_authid|pg_shadow|pg_user_mapping|pg_hba_file_rules|pg_file_settings|pg_settings)\b/, "System catalogs with server configuration are not available"],
  [/\binto\s+(temp|temporary|unlogged)?\s*(table\s+)?[a-z_]/, "SELECT INTO is not allowed; use CREATE TABLE AS"],
];

export function guardSql(input: string): GuardResult {
  const sql = input.trim();
  if (!sql) return { ok: false, reason: "Enter a SQL statement" };
  if (sql.length > 5000) return { ok: false, reason: "Statement is too long (max 5000 characters)" };
  const stripped = stripLiterals(sql);
  if (stripped === null) return { ok: false, reason: "Unterminated string, identifier or comment" };
  const lower = stripped.toLowerCase().replace(/\s+/g, " ").trim().replace(/;\s*$/, "");
  if (lower.includes(";")) return { ok: false, reason: "Only one statement can be executed at a time" };
  const startsWithParen = lower.replace(/^\(+\s*/, "");
  if (!ALLOWED_START.test(startsWithParen)) return { ok: false, reason: "Statement type not supported in the playground" };
  if (/^select\b/.test(startsWithParen) && /\binto\b/.test(lower) && !/\binsert\s+into\b/.test(lower))
    return { ok: false, reason: "SELECT INTO is not allowed; use CREATE TABLE AS" };
  for (const [re, reason] of BLOCKED) if (re.test(lower)) return { ok: false, reason };
  if (/^create\b/.test(lower) && !/^create (temp |temporary |unlogged )?(table|view|index|unique index|materialized view)\b/.test(lower))
    return { ok: false, reason: "Only CREATE TABLE / VIEW / INDEX are allowed" };
  if (/^(alter|drop)\b/.test(lower) && !/^(alter|drop) (table|view|index|materialized view)\b/.test(lower))
    return { ok: false, reason: "Only ALTER/DROP of tables, views and indexes are allowed" };
  if (/^explain\b/.test(lower) && /\banalyze\b/.test(lower) && /\b(insert|update|delete|create|drop|truncate|alter)\b/.test(lower))
    return { ok: true, statement: sql.replace(/;\s*$/, ""), kind: "explain" };
  return { ok: true, statement: sql.replace(/;\s*$/, ""), kind: startsWithParen.split(" ")[0] };
}
