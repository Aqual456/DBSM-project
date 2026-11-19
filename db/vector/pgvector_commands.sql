-- ReliefFlow — pgvector commands (vector database).
-- Part A runs a self-contained toy example in a temporary schema; part B shows the real
-- table the application maintains (src/lib/vector.ts). Run with:
--   docker exec -i reliefflow-vectordb psql -U postgres -d reliefflow_vectors -v ON_ERROR_STOP=1 < db/vector/pgvector_commands.sql

-- ===================== A. Concepts on toy 3-dimensional vectors =====================
CREATE EXTENSION IF NOT EXISTS vector;
DROP SCHEMA IF EXISTS vector_demo CASCADE;
CREATE SCHEMA vector_demo;

CREATE TABLE vector_demo.docs (
  id        SERIAL PRIMARY KEY,
  title     TEXT NOT NULL,
  embedding vector(3) NOT NULL          -- fixed-dimension vector column
);
INSERT INTO vector_demo.docs (title, embedding) VALUES
  ('water contamination',  '[0.9, 0.1, 0.0]'),
  ('diarrhoea outbreak',   '[0.8, 0.3, 0.1]'),
  ('roof blown off',       '[0.0, 0.2, 0.9]'),
  ('need blankets',        '[0.1, 0.9, 0.2]');

-- HNSW index for approximate nearest-neighbour search with the cosine operator class
CREATE INDEX docs_hnsw ON vector_demo.docs USING hnsw (embedding vector_cosine_ops);

-- Distance operators: <=> cosine distance, <-> Euclidean (L2), <#> negative inner product
SELECT title,
       round((embedding <=> '[0.85, 0.2, 0.05]')::numeric, 4)     AS cosine_distance,
       round((1 - (embedding <=> '[0.85, 0.2, 0.05]'))::numeric, 4) AS cosine_similarity,
       round((embedding <-> '[0.85, 0.2, 0.05]')::numeric, 4)     AS l2_distance
FROM vector_demo.docs
ORDER BY embedding <=> '[0.85, 0.2, 0.05]'      -- k-nearest neighbours
LIMIT 3;

-- Vector arithmetic and helpers
SELECT vector_dims('[1,2,3]'::vector) AS dims, vector_norm('[3,4]'::vector) AS norm,
       '[1,2,3]'::vector + '[1,1,1]'::vector AS added;

DROP SCHEMA vector_demo CASCADE;

-- ===================== B. The application's real vector table =====================
-- Created by src/lib/vector.ts (ensureSchema): one row per embedded document and provider.
-- CREATE TABLE document_vectors (
--   source TEXT CHECK (source IN ('incident','disaster','request')), source_id TEXT,
--   provider TEXT, dims INT, title TEXT, content TEXT, metadata JSONB,
--   embedding vector NOT NULL, synced_at TIMESTAMPTZ,
--   PRIMARY KEY (source, source_id, provider));
-- CREATE INDEX dv_hnsw_minilm ON document_vectors
--   USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE provider = 'minilm';

\d document_vectors
SELECT provider, source, count(*) AS vectors, max(dims) AS dims FROM document_vectors GROUP BY 1, 2 ORDER BY 1, 2;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'document_vectors';

-- Nearest neighbours of one stored incident (find similar historical incidents):
WITH probe AS (
  SELECT embedding::vector(384) AS e FROM document_vectors
  WHERE provider = 'minilm' AND source = 'incident' ORDER BY source_id LIMIT 1)
SELECT d.source, d.title, round((1 - (d.embedding::vector(384) <=> p.e))::numeric, 4) AS cosine_similarity
FROM document_vectors d, probe p
WHERE d.provider = 'minilm'
ORDER BY d.embedding::vector(384) <=> p.e
LIMIT 5;
