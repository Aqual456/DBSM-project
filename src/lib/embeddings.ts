/**
 * Embedding providers. A semantic provider is used ONLY when its API key is configured.
 * Otherwise the "lexical-hash" fallback is used and is labelled as such everywhere:
 * it is a genuine vector representation (feature-hashed bag of words + bigrams) and
 * cosine similarity over it is real, but it captures shared vocabulary, not meaning.
 */
export type Provider = { id: string; label: string; semantic: boolean; dims: number; model?: string };

export function activeProvider(): Provider {
  if (process.env.VOYAGE_API_KEY) return { id: "voyage", label: "Voyage AI voyage-3.5-lite", semantic: true, dims: 1024, model: "voyage-3.5-lite" };
  if (process.env.OPENAI_API_KEY) return { id: "openai", label: "OpenAI text-embedding-3-small", semantic: true, dims: 1536, model: "text-embedding-3-small" };
  return { id: "lexical-hash", label: "Lexical hashing fallback (not semantic)", semantic: false, dims: 256 };
}

const STOP = new Set(
  "the a an and or of to in on at for with from by is are was were be been this that these those it its as into near our we they them their has have had not no but over under after before about than then there here also more most very can will would should could may might per via".split(
    " ",
  ),
);
function stem(w: string) {
  return w.replace(/(ing|edly|edly|ed|es|s)$/u, (m) => (w.length - m.length >= 4 ? "" : m));
}
export function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}
function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function lexicalEmbedding(text: string, dims = 256): number[] {
  const toks = tokenize(text);
  const feats = [...toks, ...toks.slice(1).map((t, i) => `${toks[i]}_${t}`)];
  const tf = new Map<string, number>();
  for (const f of feats) tf.set(f, (tf.get(f) ?? 0) + 1);
  const v = new Array<number>(dims).fill(0);
  for (const [f, n] of tf) {
    const h = fnv1a(f);
    v[h % dims] += (h & 0x80000000 ? -1 : 1) * (1 + Math.log(n)) * (f.includes("_") ? 0.5 : 1);
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => +(x / norm).toFixed(6));
}
export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

async function remote(p: Provider, inputs: string[], kind: "document" | "query"): Promise<number[][]> {
  const url = p.id === "voyage" ? "https://api.voyageai.com/v1/embeddings" : "https://api.openai.com/v1/embeddings";
  const key = p.id === "voyage" ? process.env.VOYAGE_API_KEY : process.env.OPENAI_API_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(p.id === "voyage" ? { input: inputs, model: p.model, input_type: kind } : { input: inputs, model: p.model }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`Embedding provider returned ${res.status}`), { code: "EMBEDDING_FAILED" });
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embed(inputs: string[], kind: "document" | "query" = "document", p = activeProvider()) {
  if (!p.semantic) return inputs.map((t) => lexicalEmbedding(t, p.dims));
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += 64) out.push(...(await remote(p, inputs.slice(i, i + 64), kind)));
  return out;
}
