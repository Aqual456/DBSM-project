"use client";
import { useState } from "react";
import { RefreshCw, Search, Sparkles } from "lucide-react";
import { api, useApi, fmtDate, titleCase } from "@/lib/client";
import { Alert, Badge, Button, Card, Meter, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Provider = { id: string; label: string; semantic: boolean; dims: number };
type Status = {
  configured: boolean; ok: boolean; provider: Provider;
  stats: { counts: { source: string; n: number; synced_at: string }[]; pgvector: string | null } | null;
  runs: { run_id: string; status: string; records_synced: number; detail: string; started_at: string }[];
  plan: string | null;
};
type Hit = { source: string; source_id: string; title: string; content: string; similarity: number };
type SearchRes = { provider: Provider; dims: number; queryVectorPreview: number[]; embedMs: number; searchMs: number; results: Hit[]; keyword: { _id: string; description: string; reportType: string; severity: string; score: number }[] | null };

const samples = ["children sick after drinking contaminated water", "families sleeping outside need shelter", "power outage lighting", "road blocked convoy delayed", "elderly cold at night"];

export default function VectorLab() {
  const { data, reload } = useApi<Status>("/api/vector");
  const me = useMe();
  const toast = useToast();
  const [q, setQ] = useState(samples[0]);
  const [source, setSource] = useState("");
  const [res, setRes] = useState<SearchRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState("");

  const search = async (text = q) => {
    setBusy(true);
    setErr("");
    try {
      const qs = new URLSearchParams({ q: text });
      if (source) qs.set("source", source);
      setRes(await api<SearchRes>(`/api/vector?${qs}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ status: string; records: number }>("/api/vector", { body: {} });
      toast(r.status === "SUCCEEDED" ? "success" : "error", r.status === "SUCCEEDED" ? `Embedded ${r.records} documents` : "Sync failed — previous vectors kept");
      await reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };
  const total = data?.stats?.counts.reduce((s, c) => s + c.n, 0) ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 4"
        title="Vector Search (pgvector)"
        lead="Incident reports, requests and disasters are turned into embedding vectors and stored in a separate PostgreSQL + pgvector database with an HNSW index. Queries return nearest neighbours by cosine similarity, shown next to MongoDB keyword search."
        actions={isManager(me) && data?.configured ? <Button variant="primary" icon={<RefreshCw size={15} />} loading={syncing} onClick={sync}>Re-embed documents</Button> : undefined}
      />
      <div className="stack">
        {!data ? (
          <div className="card"><SkeletonRows /></div>
        ) : (
          <>
            {!data.configured && <Alert kind="warn">VECTOR_DATABASE_URL is not configured. Start the store with <code>docker compose --profile optional up -d vectordb</code>. The rest of ReliefFlow is unaffected.</Alert>}
            {data.configured && !data.ok && <Alert kind="error">The vector store is configured but unreachable.</Alert>}
            {!data.provider.semantic ? (
              <Alert kind="warn">
                <span>
                  <b>Lexical fallback active — this is not semantic search.</b> No embedding API key is configured (VOYAGE_API_KEY or OPENAI_API_KEY), so vectors are
                  {" "}{data.provider.dims}-dimensional feature-hashed bag-of-words (+ bigrams). Similarity is real cosine similarity, but it matches shared vocabulary, not meaning.
                  Set an API key and press <i>Re-embed</i> for semantic embeddings.
                </span>
              </Alert>
            ) : (
              <Alert kind="ok">Semantic embeddings from {data.provider.label} ({data.provider.dims} dimensions).</Alert>
            )}
          </>
        )}
        <div className="grid g-main">
          <Card title="Similarity search" subtitle="Natural-language query → embedding → ORDER BY embedding <=> query LIMIT 8">
            <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
              <div className="search" style={{ flex: 1 }}>
                <Search size={15} aria-hidden />
                <input className="input" aria-label="Search text" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} />
              </div>
              <select className="input" style={{ width: "auto" }} aria-label="Document type" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">All sources</option>
                <option value="incident">Incidents</option>
                <option value="request">Requests</option>
                <option value="disaster">Disasters</option>
              </select>
              <Button type="submit" variant="primary" icon={<Sparkles size={14} />} loading={busy} disabled={!data?.ok || q.trim().length < 2}>Search</Button>
            </form>
            <div className="chip-row" style={{ marginTop: 10 }}>
              {samples.map((s) => <button key={s} className="chip" onClick={() => { setQ(s); void search(s); }}>{s}</button>)}
            </div>
          </Card>
          <Card title="Store">
            {data?.stats ? (
              <dl className="kv">
                <dt>pgvector</dt><dd>v{data.stats.pgvector}</dd>
                <dt>Provider</dt><dd>{data.provider.label}</dd>
                <dt>Vectors</dt><dd>{total} ({data.stats.counts.map((c) => `${c.n} ${c.source}s`).join(", ")})</dd>
                <dt>Last sync</dt><dd>{data.runs[0] ? `${fmtDate(data.runs[0].started_at)} · ${titleCase(data.runs[0].status)}` : "never"}</dd>
              </dl>
            ) : <p className="small muted">No statistics available.</p>}
          </Card>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {res && (
          <div className="grid g-2">
            <Card title="Nearest neighbours (vector)" subtitle={`query embedded in ${res.embedMs} ms · HNSW search ${res.searchMs} ms · ${res.dims} dims`}>
              <p className="small muted" style={{ marginBottom: 10 }}>Query vector (first 12 of {res.dims}): <code>[{res.queryVectorPreview.map((v) => v.toFixed(3)).join(", ")}, …]</code></p>
              {!res.results.length && <p className="small muted">No vectors yet — re-embed documents first.</p>}
              {res.results.map((h) => (
                <div className="list-item" key={`${h.source}-${h.source_id}`} style={{ alignItems: "flex-start" }}>
                  <Badge value="x" color={h.source === "incident" ? "amber" : h.source === "request" ? "blue" : "red"} label={h.source} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cell-main small">{h.title}</div>
                    <div className="cell-sub">{h.content.slice(0, 160)}{h.content.length > 160 ? "…" : ""}</div>
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1 }}><Meter value={Math.max(0, h.similarity)} max={1} tone="teal" /></div>
                      <span className="small num">cos {h.similarity.toFixed(3)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
            <Card title="Keyword search (MongoDB $text)" subtitle="Exact-term matching with stemming — compare what each approach finds">
              {res.keyword === null ? <p className="small muted">MongoDB unavailable.</p> : !res.keyword.length ? <p className="small muted">No keyword matches. Vector search can still return related documents that share no exact term.</p> : res.keyword.map((k) => (
                <div className="list-item" key={k._id} style={{ alignItems: "flex-start" }}>
                  <Badge value={k.severity} />
                  <div style={{ flex: 1 }}>
                    <div className="small">{k.description}</div>
                    <div className="cell-sub">{titleCase(k.reportType)} · textScore {k.score.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}
        <div className="grid g-2">
          <Card title="How it works">
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li><b>Embedding:</b> text → fixed-length vector; similar texts land close together.</li>
              <li><b>Storage:</b> <code>document_vectors(embedding vector)</code> in pgvector, one row per source document and provider.</li>
              <li><b>Cosine similarity:</b> cos θ = (a·b)/(‖a‖‖b‖); pgvector&apos;s <code>&lt;=&gt;</code> returns cosine <i>distance</i> = 1 − cos θ.</li>
              <li><b>Nearest-neighbour search:</b> an approximate HNSW index (partial, per provider and dimension) avoids scanning every vector.</li>
              <li><b>Sync:</b> explicit, recorded in <code>integration_sync_runs</code>; sources stay authoritative.</li>
            </ol>
          </Card>
          <Card title="Query plan" subtitle="EXPLAIN of the nearest-neighbour query (seq scan disabled to reveal the index on a small table)">
            {data?.plan ? <pre className="code" style={{ whiteSpace: "pre-wrap", maxHeight: 220 }}>{data.plan.replace(/'\[[^\]]+\]'/g, "'[…]'")}</pre> : <p className="small muted">Unavailable.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
