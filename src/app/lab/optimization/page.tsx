"use client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { DemoSections } from "@/components/lab/LabKit";

const stages = [
  ["1 Parse", "Lexer + grammar build a parse tree. Syntax errors stop here."],
  ["2 Analyse", "Names resolved against the catalog; types checked; permissions verified."],
  ["3 Rewrite", "Rules applied — views are replaced by their defining query."],
  ["4 Plan / optimise", "Cost-based search over scan methods, join orders and join algorithms using table statistics."],
  ["5 Execute", "The executor pulls tuples through the plan tree (iterator model)."],
  ["6 Return", "Rows are sent to the client; with EXPLAIN ANALYZE, actual times and rows are reported per node."],
];

export default function Optimization() {
  return (
    <>
      <PageHeader eyebrow="Lab · Unit 3" title="Query Processing & Optimisation" lead="Plans and timings below are produced by EXPLAIN (ANALYZE, BUFFERS) on this server each time you press Run. The benchmark table holds 300,000 synthetic movement rows (clearly synthetic, generated with a fixed seed)." />
      <div className="stack">
        <Card title="Query processing pipeline">
          <div className="grid g-3" style={{ gap: 10 }}>
            {stages.map(([t, d]) => (
              <div key={t} className="card card-pad" style={{ boxShadow: "none" }}>
                <div className="cell-main">{t}</div>
                <div className="small muted">{d}</div>
              </div>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Reading plans: <b>Seq Scan</b> reads every page; <b>Index Scan</b> walks a B-tree then fetches heap rows; <b>Bitmap Heap Scan</b> collects matching row locations first;
            <b> Index Only Scan</b> answers from the index alone. Cost is in planner units (sequential page = 1.0); actual time is wall-clock milliseconds.
          </p>
        </Card>
        <DemoSections ids={["optimization", "processing"]} />
      </div>
    </>
  );
}
