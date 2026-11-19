import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// `next dev` and production builds use separate output folders, so running the test
// suite (which builds) never disturbs a dev server that is already running.
export default function config(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next-build",
    // the local embedding model runs natively on the server; keep it out of the bundle
    serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  };
}
