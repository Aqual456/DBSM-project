# Testing report — 18 November 2026

## Executed

| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors) |
| `npx eslint src scripts tests` | PASS (0 errors, 0 warnings) |
| `npm run build` | PASS (44 routes) |
| `npm test` | PASS — 25/25 unit tests |
| `npm run test:integration` | PASS — 28/28 checks (fresh PostgreSQL + MongoDB databases, production build, Playwright/Chrome) |
| `npm run test:services` | PASS — 4/4 (Redis, Neo4j sync, Neo4j forced-failure retry, pgvector) |

Details: `docs/test-results.json`, `docs/services-test-results.json`, screenshots in `docs/screenshots/`.

All results above are from the final run after the last code change (join-strategy demo now produces Hash Join → Merge Join → Nested Loop; services-test typing fix).

## Coverage

**Unit:** state machines (request, allocation, delivery), quantity/fulfilment maths, camp status, haversine, id validation, zero/negative/huge quantities, duplicates, unexpected fields, past dates, password rules, coordinates, incident validation, FD closure/keys/minimal cover/NF detection/BCNF/3NF/chase, SQL guard (multi-statement, transaction control, privileges, dangerous functions, unterminated input), lexical embeddings never claim to be semantic.

**Integration (HTTP + SQL + MongoDB):** authentication, cookie flags, throttling; disasters (duplicates, edit); camps (capacity, closing with occupants); warehouses; inventory (negative stock, history); requests (ownership, duplicates, transitions); direct-API authorisation for every role and CSRF; allocations (partial, over-allocation, atomic rollback); concurrent allocations; vehicle/volunteer/driver double booking incl. concurrent; delivery lifecycle and driver ownership; cancel twice / after shipment; stock restored exactly once; DB-level guards bypassing the API; MongoDB references, validation, text search, facets, embedded updates; analytics vs SQL; cache hit + invalidation; malformed JSON, wrong content type, invalid ids; optimistic concurrency (stale edits, stale stock); 12 concurrent camp admissions with no lost update; views/functions/procedure/audit trigger; last-admin protection, password reset and deactivation revoking sessions; read models; degraded mode with optional services off; lab rollback, playground guard, privilege denial, statement timeout, concurrency scenarios (40P01, 40001, lock waits), trace.

**Browser:** login validation and failure, all 34 screens without errors, keyboard skip link, modal edit with validation, search empty state, request creation + approval, lab demo, ER explorer, concurrency scenario, no horizontal overflow at 390 px on 5 screens, mobile drawer navigation, logout, zero console/page errors.

## Measured (lab benchmark, 300,000 synthetic rows)

| Query | Before | After |
|---|---|---|
| Filter on resource_id + date | Seq Scan, 13.3 ms | Bitmap Index Scan, 1.6 ms |
| Covering composite index | — | Index Only Scan, 0.11 ms |
| `date_trunc(...) =` vs range predicate | 3.1 ms | 0.06 ms |

Numbers vary per run; the lab re-measures each time.

## Defects found and fixed during testing

* PATCH /api/disasters: parameter type conflict (text vs varchar) → 500. Fixed with casts.
* Request response missing `requested_by`.
* MongoDB `$text` without a text index → 500. Now falls back to an escaped regex search (reported as `regex-fallback`).
* ER introspection: `name[]` catalog arrays not parsed by node-pg → 500. Cast to `text[]`.
* Mobile overflow on the ER page; hamburger visible on desktop.
* Lab setup failed on legacy rows violating a NOT VALID constraint; the copy now mirrors production constraints exactly.

## Known limitations

* Semantic vector search requires `VOYAGE_API_KEY` or `OPENAI_API_KEY`; without one the clearly labelled lexical fallback is used.
* Neo4j and the vector store are projections refreshed on demand, not in real time.
* Map tiles need internet access (markers still render without them).
* Legacy duplicate/inconsistent rows (see DATABASE_DESIGN.md) were deliberately left unchanged.
* `npm audit` dev-dependency advisories from the original project were not re-assessed.
