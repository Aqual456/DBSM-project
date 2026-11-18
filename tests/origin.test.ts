import test from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin } from "../src/lib/api";

const h = (o: Record<string, string>) => new Headers(o);
const CONFIGURED = "http://localhost:3000";

test("same-site requests pass however the app was opened", () => {
  assert.ok(isSameOrigin("http://localhost:3000", h({ host: "localhost:3000" }), CONFIGURED));
  assert.ok(isSameOrigin("http://127.0.0.1:3000", h({ host: "127.0.0.1:3000" }), CONFIGURED), "opened via 127.0.0.1");
  assert.ok(isSameOrigin("http://192.168.1.20:3000", h({ host: "192.168.1.20:3000" }), CONFIGURED), "opened via LAN IP");
  assert.ok(isSameOrigin("https://relief.example.org", h({ host: "internal:3000", "x-forwarded-host": "relief.example.org", "x-forwarded-proto": "https" }), CONFIGURED), "behind a proxy");
});

test("cross-site and malformed origins are rejected", () => {
  assert.equal(isSameOrigin("https://evil.example", h({ host: "localhost:3000" }), CONFIGURED), false);
  assert.equal(isSameOrigin("http://localhost:3001", h({ host: "localhost:3000" }), CONFIGURED), false, "different port");
  assert.equal(isSameOrigin("https://127.0.0.1:3000", h({ host: "127.0.0.1:3000" }), CONFIGURED), false, "scheme mismatch");
  assert.equal(isSameOrigin("null", h({ host: "localhost:3000" }), CONFIGURED), false);
  assert.equal(isSameOrigin("http://127.0.0.1:3000", h({}), CONFIGURED), false, "no host header");
});
