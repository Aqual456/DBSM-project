"use client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DemoSections } from "@/components/lab/LabKit";

const ops = [
  ["σ", "Selection", "Unary", "Rows satisfying a predicate", "WHERE"],
  ["π", "Projection", "Unary", "Chosen columns (duplicates removed)", "SELECT DISTINCT cols"],
  ["ρ", "Rename", "Unary", "Rename a relation or attributes", "AS alias"],
  ["γ", "Grouping / aggregation", "Unary (extended)", "Aggregate per group", "GROUP BY … HAVING"],
  ["∪", "Union", "Binary (set)", "Tuples in R or S", "UNION"],
  ["−", "Set difference", "Binary (set)", "Tuples in R but not S", "EXCEPT"],
  ["∩", "Intersection", "Binary (set, derived)", "Tuples in both", "INTERSECT"],
  ["×", "Cartesian product", "Binary", "Every pairing of tuples", "CROSS JOIN"],
  ["⋈", "Natural / theta join", "Binary (derived)", "σθ(R × S)", "JOIN … ON / NATURAL JOIN"],
  ["⟕ ⟖ ⟗", "Outer joins", "Binary (extended)", "Keep unmatched tuples, pad with NULL", "LEFT / RIGHT / FULL JOIN"],
  ["÷", "Division", "Binary (derived)", "Tuples related to ALL tuples of S", "NOT EXISTS (… NOT EXISTS …)"],
];

export default function Algebra() {
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 1" title="Relational Algebra Playground" lead="Each operator: its algebra expression, the equivalent SQL, the live result on ReliefFlow data, and what it means." />
      <div className="stack">
        <Card title="Operator reference" subtitle="Fundamental operators: σ, π, ρ, ∪, −, ×. The rest can be derived from them.">
          <div className="table-wrap">
            <table className="data compact">
              <thead><tr><th>Symbol</th><th>Operator</th><th>Arity</th><th>Result</th><th>SQL</th></tr></thead>
              <tbody>{ops.map(([s, n, a, r, q]) => <tr key={n}><td className="algebra" style={{ background: "none", border: 0, padding: "6px 10px" }}>{s}</td><td className="cell-main">{n}</td><td>{a}</td><td>{r}</td><td><code>{q}</code></td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <DemoSections ids={["algebra", "aggregation"]} />
      </div>
    </>
  );
}
