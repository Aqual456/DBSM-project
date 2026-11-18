import { MongoClient, type Db } from "mongodb";

declare global {
  var rfMongo: { client?: MongoClient; connecting?: Promise<MongoClient> } | undefined;
}
const state = (global.rfMongo ??= {});

/** Lazily connect (never during build). Concurrent callers share one connection attempt. */
export async function getMongoClient(): Promise<MongoClient> {
  if (!process.env.MONGODB_URI) throw new Error("MongoDB is not configured");
  if (state.client) return state.client;
  state.connecting ??= (async () => {
    const client = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 4000, maxPoolSize: 10 });
    try {
      await client.connect();
      state.client = client;
      return client;
    } finally {
      state.connecting = undefined;
    }
  })();
  return state.connecting;
}

export async function getMongoDb(name = process.env.MONGODB_DB || "reliefflow"): Promise<Db> {
  return (await getMongoClient()).db(name);
}

export async function mongoPing() {
  const t = performance.now();
  try {
    await (await getMongoDb()).command({ ping: 1 });
    return { ok: true, latencyMs: +(performance.now() - t).toFixed(2) };
  } catch {
    return { ok: false };
  }
}
