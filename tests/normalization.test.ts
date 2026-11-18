import test from "node:test";
import assert from "node:assert/strict";
import { analyse, bcnfDecompose, candidateKeys, closure, isLossless, minimalCover, parseFDs, threeNFSynthesis } from "../src/lib/normalization";

const R = ["request_id", "camp_id", "camp_name", "resource_id", "unit", "quantity"];
const F = parseFDs("request_id -> camp_id\ncamp_id -> camp_name\nresource_id -> unit\nrequest_id, resource_id -> quantity");

test("attribute closure follows transitive dependencies and records the trace", () => {
  const c = closure(["request_id"], F);
  assert.deepEqual(c.closure, ["camp_id", "camp_name", "request_id"]);
  assert.equal(c.trace.length, 2);
  assert.deepEqual(closure(["request_id", "resource_id"], F).closure.length, R.length);
});

test("candidate keys: single composite key; textbook multi-key case", () => {
  assert.deepEqual(candidateKeys(R, F), [["request_id", "resource_id"]]);
  const keys = candidateKeys(["A", "B", "C"], parseFDs("A,B -> C; C -> B"));
  assert.deepEqual(keys.map((k) => k.join("")).sort(), ["AB", "AC"]);
});

test("normal form detection: 1NF (partial), 2NF (transitive), 3NF-not-BCNF, BCNF", () => {
  assert.equal(analyse(R, F).highest, "1NF");
  assert.equal(analyse(["d", "v", "vt"], parseFDs("d -> v; v -> vt")).highest, "2NF");
  assert.equal(analyse(["vol", "camp", "coord"], parseFDs("vol, camp -> coord; coord -> camp")).highest, "3NF");
  assert.equal(analyse(["w", "r", "q"], parseFDs("w, r -> q")).highest, "BCNF");
});

test("minimal cover removes extraneous attributes and redundant FDs", () => {
  const cover = minimalCover(parseFDs("A -> B, C; B -> C; A, B -> C"));
  const text = cover.map((f) => `${f.lhs.join("")}>${f.rhs.join("")}`).sort();
  assert.deepEqual(text, ["A>B", "B>C"]);
});

test("BCNF decomposition is lossless; 3NF synthesis is lossless", () => {
  const b = bcnfDecompose(R, F);
  assert.ok(b.relations.length >= 3);
  assert.ok(isLossless(R, b.relations, F));
  const s = threeNFSynthesis(R, F);
  assert.ok(isLossless(R, s, F));
  // A lossy split is detected by the chase
  assert.equal(isLossless(["A", "B", "C"], [["A", "B"], ["B", "C"]], parseFDs("A -> B")), false);
});

test("3NF-not-BCNF decomposition cannot preserve coord -> camp together with vol,camp -> coord", () => {
  const r = bcnfDecompose(["vol", "camp", "coord"], parseFDs("vol, camp -> coord; coord -> camp"));
  assert.equal(r.dependencyPreserving, false);
});

test("parseFDs rejects malformed input", () => {
  assert.throws(() => parseFDs("A B C"));
  assert.throws(() => parseFDs("-> B"));
});
