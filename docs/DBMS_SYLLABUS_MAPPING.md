# DBMS syllabus mapping

Every item points to an executable implementation. "Demo id" = runnable card in the lab (`src/lib/lab/demos.ts`), executed on the sanitised lab snapshot and rolled back.

## Unit 1 — Introduction to DBMS & SQL

| Topic | Where |
|---|---|
| Purpose, advantages, DB vs file system, views of data, architecture, three-schema architecture, data independence | `/lab/concepts` |
| ER modelling: entities, attributes, relationships, cardinality, participation, weak entities | `/lab/er` (live from catalog), `/lab/concepts` |
| Primary, candidate, alternate, composite, foreign keys | `/lab/er`; demos `keys-catalog`, `fk-graph`, `violations` |
| Relational algebra σ π ∪ − ∩ × ρ ⋈ ⟕ ÷ γ | `/lab/algebra`; demos `ra-*`, `agg-basic` (expression + SQL + live result + explanation) |
| Unary vs binary operations | `/lab/algebra` operator table |
| Aggregates, GROUP BY, HAVING | demos `agg-basic`, `group-having` |
| SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE, WHERE, ORDER BY, DISTINCT, LIMIT | `/lab/sql`; demos `select-where-order`, `distinct-limit`, `insert-update-delete`, `ddl`, `truncate` |
| Constraints and keys | demos `violations`, `keys-catalog`; migrations 001/005/007 |
| SQL playground (restricted, rolled back) | `/lab/sql` → `POST /api/lab/sql` |

## Unit 2 — Advanced SQL

| Topic | Where |
|---|---|
| INSERT…SELECT, UPDATE…FROM, DELETE with subquery, UPSERT | demos `insert-select`, `update-from`, `delete-subquery`, `upsert` |
| UNION / UNION ALL / INTERSECT / EXCEPT | demos `union-all`, `intersect-except` |
| NULL handling, COALESCE, NULLIF, aggregates | demos `three-valued`, `coalesce-nullif`, `null-aggregates` |
| Nested & correlated subqueries (stock below average, camps above threshold, warehouses holding a resource, high-demand disasters) | demos `below-average`, `correlated-threshold`, `holding-resource`, `high-demand` |
| INNER/LEFT/RIGHT/FULL/CROSS/SELF joins | demos `inner-left-right`, `full-outer`, `cross-self` |
| Views (low stock, fulfilment, warehouse summary, disaster summary, demand) | `007_dbms_engineering.sql`; demos `views-in-use`, `view-definition`; used by the API |
| Triggers: stock deduction, movement history, audit, allocation validation, business rules | `001/005/006/007`; demos `trigger-catalog`, `trigger-deduction`, `trigger-validation`, `trigger-audit` |
| Functions & procedures | `remaining_request_quantity`, `resource_availability`, `request_fulfillment_pct`, `operational_summary`, `CALL refresh_request_status` (used by the API); demos `functions`, `procedure` |
| CTE, multiple CTEs, recursive CTEs | demos `cte-basic`, `cte-recursive-depletion`, `cte-recursive-graph` |
| Window functions (ROW_NUMBER, RANK, DENSE_RANK, LAG, LEAD, SUM/AVG OVER, PARTITION BY) vs GROUP BY | demos `ranking`, `partition`, `lag-lead-running`, `window-vs-group` |
| Full-text search (PostgreSQL) | generated tsvector + GIN; Disasters page search; demos `fulltext`, `trigram` |
| MongoDB text search | Incidents page; `/lab/nosql` "Text search" |

## Unit 3 — Design & implementation

| Topic | Where |
|---|---|
| Query processing (parse, analyse, rewrite, plan, execute) | `/lab/optimization`; demos `parse-error`, `view-rewrite`, `plan-tree` |
| EXPLAIN / EXPLAIN ANALYZE, seq vs index vs index-only, composite indexes, cost, time | demos `seq-vs-index`, `index-only`, `composite-order`, `sargable`, `statistics` (300k-row synthetic benchmark; plan tree viewer) |
| Join strategies | demo `join-strategies` (hash, merge, nested loop, measured) |
| Functional dependencies, trivial/non-trivial, full/partial/transitive, closure, candidate keys | `/lab/normalization` FD engine (`src/lib/normalization.ts`, unit tested) |
| 1NF → BCNF, decomposition, lossless join, dependency preservation | FD engine (BCNF decomposition, 3NF synthesis, chase test); demos `anomalies`, `decomposition` |
| 4NF, 5NF | demos `fourth-nf`, `fifth-nf` (verified with EXCEPT) |

## Unit 4 — Next-gen data management

| Topic | Where |
|---|---|
| ACID, COMMIT/ROLLBACK/SAVEPOINT, failure halfway through an allocation | `/lab/transactions`; demos `atomic-allocation`, `savepoints`, `consistency`, `durability`; API `transaction()` |
| Concurrency, shared/exclusive locks, row locks, deadlocks, isolation levels, dirty/non-repeatable/phantom reads, lost updates | 9 two-session scenarios (`src/lib/lab/concurrency.ts`); production code uses ordered row locks, atomic updates, partial unique indexes, optimistic `row_version` |
| Relational vs NoSQL | `/lab/nosql` |
| MongoDB: documents, BSON, CRUD, embedded docs, references, validation, indexes, text, aggregation | Incidents feature; `/lab/nosql` demos `document`, `crud`, `validation`, `indexes`, `text`, `aggregation` |
| Key-value (Redis) | dashboard cache, invalidation, rate limits; `/lab/keyvalue` |
| Graph (Neo4j, Cypher) | `src/lib/graph.ts`; `/lab/graph` (sync with retries, 5 queries incl. shortest path, force-directed view) |
| Vector DB (pgvector, embeddings, cosine, k-NN) | `src/lib/vector.ts`; `/lab/vector` (HNSW; semantic only with an API key, otherwise labelled lexical fallback) |
| Relational + NoSQL integration and ownership | `/lab/nosql` ownership table; `docs/ARCHITECTURE.md` |
| Next.js ↔ SQL integration | `/lab/integration` (timed live trace) |
