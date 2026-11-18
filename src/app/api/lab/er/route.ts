import { endpoint, actor, allRoles } from "@/lib/api";
import { pool } from "@/lib/postgres";
import { cached } from "@/lib/cache";

/**
 * Live ER model, introspected from the operational database catalog (metadata only).
 * Cardinality is derived from constraints, not hand-written:
 *  - FK columns that are also exactly a PK/UNIQUE key  -> 1:1
 *  - otherwise                                         -> N:1 (many children per parent)
 *  - a table whose PK is made only of two FKs          -> associative entity (M:N)
 *  - NOT NULL FK                                       -> total participation of the child
 */
const HIDDEN = new Set(["schema_migrations", "login_attempts"]);

async function load() {
  const [tables, columns, keys, fks, checks, rows] = await Promise.all([
    pool.query(`SELECT c.relname AS name, obj_description(c.oid) AS comment FROM pg_class c
                 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' ORDER BY 1`),
    pool.query(`SELECT table_name, column_name, data_type, udt_name, is_nullable = 'YES' AS nullable, column_default, is_generated <> 'NEVER' AS generated,
                       character_maximum_length, numeric_precision, numeric_scale, ordinal_position
                  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`),
    pool.query(`SELECT conrelid::regclass::text AS table_name, contype, conname,
                       array(SELECT attname::text FROM unnest(conkey) k JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k ORDER BY array_position(conkey, k)) AS cols
                  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('p','u')`),
    pool.query(`SELECT conname, conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
                       array(SELECT attname::text FROM unnest(conkey) k JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k ORDER BY array_position(conkey, k)) AS cols,
                       array(SELECT attname::text FROM unnest(confkey) k JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k ORDER BY array_position(confkey, k)) AS ref_cols,
                       confdeltype
                  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'f'`),
    pool.query(`SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def, convalidated
                  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'c'`),
    pool.query(`SELECT relname AS table_name, n_live_tup::int AS rows FROM pg_stat_user_tables WHERE schemaname = 'public'`),
  ]);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const entities = tables.rows
    .filter((t) => !HIDDEN.has(t.name))
    .map((t) => {
      const pk = keys.rows.find((k) => k.table_name === t.name && k.contype === "p")?.cols ?? [];
      const uniques = keys.rows.filter((k) => k.table_name === t.name && k.contype === "u").map((k) => k.cols as string[]);
      const tfks = fks.rows.filter((f) => f.child === t.name);
      const fkCols = new Set(tfks.flatMap((f) => f.cols as string[]));
      const associative = pk.length >= 2 && tfks.length >= 2 && pk.every((c: string) => fkCols.has(c));
      return {
        name: t.name,
        rows: rows.rows.find((r) => r.table_name === t.name)?.rows ?? 0,
        kind: associative ? "associative" : pk.length > 1 ? "composite-key" : "entity",
        primaryKey: pk,
        candidateKeys: uniques,
        attributes: columns.rows
          .filter((c) => c.table_name === t.name && c.column_name !== "search_vector")
          .map((c) => ({
            name: c.column_name,
            type: c.character_maximum_length ? `${c.udt_name}(${c.character_maximum_length})` : c.numeric_precision && c.udt_name === "numeric" ? `numeric(${c.numeric_precision},${c.numeric_scale})` : c.udt_name,
            nullable: c.nullable,
            pk: pk.includes(c.column_name),
            fk: fkCols.has(c.column_name),
            unique: uniques.some((u) => u.length === 1 && u[0] === c.column_name),
            generated: c.generated,
            default: c.column_default && !String(c.column_default).startsWith("nextval") ? String(c.column_default).slice(0, 40) : null,
          })),
        checks: checks.rows.filter((c) => c.table_name === t.name).map((c) => ({ name: c.conname, definition: c.def, validated: c.convalidated })),
      };
    });
  const names = new Set(entities.map((e) => e.name));
  const relationships = fks.rows
    .filter((f) => names.has(f.child) && names.has(f.parent))
    .map((f) => {
      const child = entities.find((e) => e.name === f.child)!;
      const oneToOne = same(f.cols, child.primaryKey) || child.candidateKeys.some((k) => same(f.cols, k));
      const mandatory = (f.cols as string[]).every((c) => !child.attributes.find((a) => a.name === c)?.nullable);
      return {
        name: f.conname,
        from: f.child,
        to: f.parent,
        columns: f.cols,
        references: f.ref_cols,
        cardinality: oneToOne ? "1:1" : "N:1",
        childParticipation: mandatory ? "total" : "partial",
        onDelete: { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" }[f.confdeltype as "a"] ?? f.confdeltype,
      };
    });
  const manyToMany = entities
    .filter((e) => e.kind === "associative")
    .map((e) => {
      const parents = relationships.filter((r) => r.from === e.name).map((r) => r.to);
      return { via: e.name, between: [...new Set(parents)] };
    });
  return { entities, relationships, manyToMany, source: "PostgreSQL system catalog (live)" };
}

export const GET = endpoint(async (req) => {
  await actor(req, allRoles);
  return (await cached("rf:cache:er:v1", 300, load)).value;
});
