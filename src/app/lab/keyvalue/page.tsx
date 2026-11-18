"use client";
import { useState } from "react";
import { Gauge, RefreshCw, Trash2 } from "lucide-react";
import { api, useApi, fmtNumber } from "@/lib/client";
import { Alert, Badge, Button, Card, PageHeader, SkeletonRows } from "@/components/ui/primitives";
import { RankBars, SERIES } from "@/components/charts/Charts";
import { useToast } from "@/components/ui/overlays";
import { useMe, isManager } from "@/components/shell/AppShell";

type Inspect = { kind: string; configured: boolean; stats: { hits: number; misses: number; sets: number; invalidations: number }; keys: { key: string; ttl: number; bytes: number; type: string }[]; info: Record<string, string> };
type Bench = { backend: string; firstMiss: boolean; readThroughMs: number; runs: { source: string; ms: number }[]; avgPostgresMs: number; avgCacheMs: number; ttlSeconds: number };

export default function KeyValue() {
  const { data, reload } = useApi<Inspect>("/api/lab/cache");
  const me = useMe();
  const toast = useToast();
  const [bench, setBench] = useState<Bench | null>(null);
  const [busy, setBusy] = useState(false);
  const runBench = async () => {
    setBusy(true);
    try {
      setBench(await api<Bench>("/api/lab/cache", { body: { action: "benchmark" } }));
      await reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Benchmark failed");
    } finally {
      setBusy(false);
    }
  };
  const invalidate = async () => {
    try {
      await api("/api/lab/cache", { body: { action: "invalidate" } });
      toast("success", "Cache invalidated");
      await reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Invalidation failed");
    }
  };
  const ratio = data ? Math.round((100 * data.stats.hits) / Math.max(1, data.stats.hits + data.stats.misses)) : 0;
  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 4"
        title="Key-Value Store (Redis)"
        lead="Redis caches dashboard metrics (30 s TTL, invalidated after every successful write) and holds rate-limit counters. If Redis is down, an in-process map takes over automatically and the app keeps working."
        actions={<Button icon={<RefreshCw size={15} />} onClick={reload}>Refresh</Button>}
      />
      <div className="stack">
        {data && !data.configured && <Alert kind="warn">REDIS_URL is not configured — using the in-memory fallback. Start Redis with <code>docker compose --profile optional up -d redis</code>.</Alert>}
        <div className="grid g-4">
          <div className="card kpi">
            <span className="kpi-label">Backend</span>
            <div className="kpi-value" style={{ fontSize: 20 }}>{data ? <Badge value={data.kind === "redis" ? "AVAILABLE" : "HIGH"} label={data.kind === "redis" ? "Redis" : "In-memory fallback"} /> : "…"}</div>
            <div className="kpi-foot">{data?.info.redis_version ? `v${data.info.redis_version} · ${data.info.used_memory_human} · ${data.info.dbsize} keys` : ""}</div>
          </div>
          <div className="card kpi"><span className="kpi-label">Hits</span><div className="kpi-value">{data?.stats.hits ?? "…"}</div><div className="kpi-foot">this server process</div></div>
          <div className="card kpi"><span className="kpi-label">Misses</span><div className="kpi-value">{data?.stats.misses ?? "…"}</div><div className="kpi-foot">hit ratio {ratio}%</div></div>
          <div className="card kpi"><span className="kpi-label">Invalidations</span><div className="kpi-value">{data?.stats.invalidations ?? "…"}</div><div className="kpi-foot">one per successful write</div></div>
        </div>
        <div className="grid g-2">
          <Card title="Measured benchmark" subtitle="The same aggregate query 5× from PostgreSQL vs 5× from the cache (GET + JSON.parse)" actions={<Button size="sm" variant="primary" icon={<Gauge size={13} />} loading={busy} onClick={runBench}>Run benchmark</Button>}>
            {!bench ? (
              <p className="small muted">Press Run to measure on this machine.</p>
            ) : (
              <>
                <RankBars data={[{ name: "PostgreSQL (avg)", ms: bench.avgPostgresMs }, { name: `${bench.backend === "redis" ? "Redis" : "Memory"} cache (avg)`, ms: bench.avgCacheMs }]} x="name" y="ms" name="Average latency (ms)" unit=" ms" color={SERIES[0]} height={130} />
                <p className="small muted" style={{ marginTop: 8 }}>
                  First read was a miss ({String(bench.firstMiss)}) and populated the key with a {bench.ttlSeconds}s TTL in {bench.readThroughMs} ms. Runs: {bench.runs.map((r) => `${r.source === "postgres" ? "PG" : "cache"} ${r.ms}`).join(" · ")} ms
                </p>
              </>
            )}
          </Card>
          <Card title="Key design" subtitle="Namespaced keys make prefix invalidation safe">
            <table className="data compact">
              <tbody>
                <tr><td><code>rf:cache:dashboard:v2</code></td><td className="small">Dashboard aggregates (STRING, JSON, EX 30)</td></tr>
                <tr><td><code>rf:cache:er:v1</code></td><td className="small">ER model from the catalog (EX 300)</td></tr>
                <tr><td><code>rf:rl:sql:&lt;user&gt;</code></td><td className="small">Playground rate limit (INCR + EXPIRE 60)</td></tr>
                <tr><td><code>rf:rl:lab:&lt;user&gt;</code></td><td className="small">Lab run rate limit</td></tr>
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>Sessions deliberately stay in PostgreSQL: revocation must be transactional with role changes.</p>
          </Card>
        </div>
        <Card title="Live keys" subtitle="SCAN MATCH rf:* (never KEYS in production paths)" actions={isManager(me) ? <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={invalidate}>Invalidate rf:cache:*</Button> : undefined}>
          {!data ? (
            <SkeletonRows />
          ) : !data.keys.length ? (
            <p className="small muted">No keys right now — open the Command Center to populate the dashboard cache.</p>
          ) : (
            <table className="data compact">
              <thead><tr><th>Key</th><th>Type</th><th className="num">TTL (s)</th><th className="num">Bytes</th></tr></thead>
              <tbody>{data.keys.map((k) => <tr key={k.key}><td><code>{k.key}</code></td><td>{k.type}</td><td className="num">{k.ttl}</td><td className="num">{fmtNumber(k.bytes)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
