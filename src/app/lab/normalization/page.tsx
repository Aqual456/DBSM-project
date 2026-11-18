"use client";
import { useMemo, useState } from "react";
import { Badge, Card, PageHeader, Alert } from "@/components/ui/primitives";
import { DemoSections } from "@/components/lab/LabKit";
import { analyse, bcnfDecompose, closure, fdText, isLossless, parseFDs, threeNFSynthesis } from "@/lib/normalization";

const presets = [
  {
    name: "RequestLine (1NF, partial dependencies)",
    attrs: "request_id, camp_id, camp_name, camp_capacity, resource_id, resource_name, unit, quantity",
    fds: "request_id -> camp_id\ncamp_id -> camp_name, camp_capacity\nresource_id -> resource_name, unit\nrequest_id, resource_id -> quantity",
  },
  {
    name: "DeliveryInfo (2NF, transitive dependencies)",
    attrs: "delivery_id, vehicle_id, vehicle_number, vehicle_type, driver_id, driver_name",
    fds: "delivery_id -> vehicle_id, driver_id\nvehicle_id -> vehicle_number, vehicle_type\ndriver_id -> driver_name",
  },
  {
    name: "CampDuty (3NF but not BCNF)",
    attrs: "volunteer, camp, coordinator",
    fds: "volunteer, camp -> coordinator\ncoordinator -> camp",
  },
  {
    name: "inventory as implemented (BCNF)",
    attrs: "warehouse_id, resource_id, quantity_available, minimum_threshold, last_updated",
    fds: "warehouse_id, resource_id -> quantity_available, minimum_threshold, last_updated",
  },
];

const nfLadder = [
  ["UNF", "Repeating groups or non-atomic values.", "A request row holding \"Food:250; Water:500\" in one cell."],
  ["1NF", "Atomic values; one fact per cell; a key exists.", "One row per (request, resource) line."],
  ["2NF", "1NF + no non-prime attribute depends on PART of a candidate key.", "resource_name depends only on resource_id → move to RESOURCE."],
  ["3NF", "2NF + no transitive dependency of a non-prime attribute on a key.", "delivery → vehicle → vehicle_type: move vehicle facts to VEHICLE."],
  ["BCNF", "Every determinant of a non-trivial FD is a superkey.", "coordinator → camp in CampDuty violates BCNF although it is 3NF."],
  ["4NF", "BCNF + no non-trivial multivalued dependency X →→ Y unless X is a superkey.", "camp →→ resource and camp →→ skill stored together: split them."],
  ["5NF", "Every join dependency is implied by candidate keys.", "warehouse–resource–vehicle shipping rule needs all three projections (see SQL demo)."],
];

export default function Normalization() {
  const [attrs, setAttrs] = useState(presets[0].attrs);
  const [fds, setFds] = useState(presets[0].fds);
  const [probe, setProbe] = useState("request_id");
  const result = useMemo(() => {
    try {
      const all = [...new Set(attrs.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
      const F = parseFDs(fds);
      const unknown = F.flatMap((f) => [...f.lhs, ...f.rhs]).filter((a) => !all.includes(a));
      if (unknown.length) throw new Error(`Unknown attribute(s) in FDs: ${[...new Set(unknown)].join(", ")}`);
      if (all.length > 16) throw new Error("Use at most 16 attributes");
      const a = analyse(all, F);
      const bcnf = bcnfDecompose(all, F);
      const syn = threeNFSynthesis(all, F);
      const pr = probe.split(/[,\s]+/).filter(Boolean).filter((x) => all.includes(x));
      return { all, F, a, bcnf, syn, bcnfLossless: isLossless(all, bcnf.relations, F), synLossless: isLossless(all, syn, F), cl: pr.length ? closure(pr, F) : null, pr };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invalid input" };
    }
  }, [attrs, fds, probe]);

  return (
    <>
      <PageHeader eyebrow="Lab · Unit 3" title="Functional Dependencies & Normalisation" lead="An exact FD engine (closure, candidate keys, minimal cover, normal-form tests, BCNF decomposition and 3NF synthesis) plus SQL demonstrations that verify anomalies and lossless joins on real data." />
      <div className="stack">
        <div className="grid g-main">
          <Card title="Relation & functional dependencies" subtitle="Edit freely — results update as you type">
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {presets.map((p) => (
                <button key={p.name} className="chip" aria-pressed={attrs === p.attrs} onClick={() => { setAttrs(p.attrs); setFds(p.fds); setProbe(p.attrs.split(",")[0].trim()); }}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <div className="field full">
                <label className="field-label" htmlFor="nf-attrs">Attributes of R</label>
                <input id="nf-attrs" className="input mono" value={attrs} onChange={(e) => setAttrs(e.target.value)} />
              </div>
              <div className="field full">
                <label className="field-label" htmlFor="nf-fds">Functional dependencies (one per line, A, B -&gt; C)</label>
                <textarea id="nf-fds" className="input mono" style={{ minHeight: 110 }} value={fds} onChange={(e) => setFds(e.target.value)} />
              </div>
              <div className="field full">
                <label className="field-label" htmlFor="nf-probe">Attribute closure X⁺ for X =</label>
                <input id="nf-probe" className="input mono" value={probe} onChange={(e) => setProbe(e.target.value)} />
              </div>
            </div>
          </Card>
          <div className="stack">
            {"error" in result ? (
              <Alert kind="error">{result.error}</Alert>
            ) : (
              <>
                <Card title="Highest normal form" actions={<Badge value="x" color={result.a.highest === "BCNF" ? "green" : result.a.highest === "3NF" ? "teal" : result.a.highest === "2NF" ? "amber" : "red"} label={result.a.highest} />}>
                  <dl className="kv">
                    <dt>Candidate keys</dt><dd>{result.a.keys.map((k) => `{${k.join(", ")}}`).join("  ")}</dd>
                    <dt>Prime attributes</dt><dd>{result.a.prime.join(", ") || "—"}</dd>
                    <dt>Non-prime</dt><dd>{result.a.nonPrime.join(", ") || "—"}</dd>
                  </dl>
                </Card>
                {result.cl && (
                  <Card title={`{${result.pr.join(", ")}}⁺ = {${result.cl.closure.join(", ")}}`} subtitle={result.cl.closure.length === result.all.length ? "X is a superkey" : "X is not a superkey"}>
                    <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      <li>start: {"{"}{result.pr.join(", ")}{"}"}</li>
                      {result.cl.trace.map((t, i) => <li key={i}>apply {fdText(t.fd)} → add {t.added.join(", ")}</li>)}
                    </ol>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
        {!("error" in result) && (
          <div className="grid g-3">
            <Card title="Minimal cover" subtitle="Singleton RHS, no extraneous attributes, no redundant FDs">
              {result.a.cover.map((f, i) => <div key={i} className="mono small">{fdText(f)}</div>)}
            </Card>
            <Card title="Violations" subtitle="Partial (2NF), transitive (3NF) and non-superkey determinants (BCNF)">
              {[...result.a.twoNF.map((v) => ["2NF", v] as const), ...result.a.threeNF.map((v) => ["3NF", v] as const), ...result.a.bcnf.map((v) => ["BCNF", v] as const)].map(([nf, v], i) => (
                <div key={i} className="small" style={{ marginBottom: 6 }}>
                  <Badge value="x" color={nf === "2NF" ? "red" : nf === "3NF" ? "amber" : "violet"} label={nf} /> <span className="mono">{fdText(v.fd)}</span>
                  <div className="cell-sub">{v.reason}</div>
                </div>
              ))}
              {!result.a.bcnf.length && <p className="small muted">None — the relation is in BCNF.</p>}
            </Card>
            <Card title="Decompositions">
              <div className="field-label">BCNF decomposition</div>
              {result.bcnf.relations.map((r, i) => <div key={i} className="mono small">R{i + 1}({r.join(", ")})</div>)}
              <div className="row" style={{ margin: "6px 0 10px" }}>
                <Badge value={result.bcnfLossless ? "OK" : "CRITICAL"} label={result.bcnfLossless ? "Lossless (chase test)" : "Lossy"} />
                <Badge value={result.bcnf.dependencyPreserving ? "OK" : "HIGH"} label={result.bcnf.dependencyPreserving ? "Dependency-preserving" : "Loses a dependency"} />
              </div>
              <div className="field-label">3NF synthesis</div>
              {result.syn.map((r, i) => <div key={i} className="mono small">S{i + 1}({r.join(", ")})</div>)}
              <div className="row" style={{ marginTop: 6 }}>
                <Badge value={result.synLossless ? "OK" : "CRITICAL"} label={result.synLossless ? "Lossless" : "Lossy"} />
                <Badge value="OK" label="Dependency-preserving (by construction)" />
              </div>
            </Card>
          </div>
        )}
        <Card title="Normal forms at a glance">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Form</th><th>Rule</th><th>ReliefFlow example</th></tr></thead>
              <tbody>{nfLadder.map(([a, b, c]) => <tr key={a}><td><Badge value="x" color="blue" label={a} /></td><td>{b}</td><td>{c}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Dependency vocabulary: <b>trivial</b> X→Y with Y⊆X (e.g. request_id, resource_id → request_id); <b>full</b> dependency on the whole key (request_id, resource_id → quantity);
            <b> partial</b> on part of it (resource_id → unit); <b>transitive</b> through a non-key (delivery_id → vehicle_id → vehicle_type).
          </p>
        </Card>
        <DemoSections ids={["normalization"]} />
      </div>
    </>
  );
}
