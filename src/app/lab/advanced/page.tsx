"use client";
import { PageHeader } from "@/components/ui/primitives";
import { DemoSections } from "@/components/lab/LabKit";

export default function Advanced() {
  return (
    <>
      <PageHeader
        eyebrow="Lab · Unit 2"
        title="Advanced SQL Lab"
        lead="Modification, set operations, NULL semantics, nested and correlated subqueries, joins, views, ReliefFlow's real triggers and routines, CTEs (including recursion), window functions and full-text search."
      />
      <DemoSections ids={["modification", "set-ops", "nulls", "subqueries", "joins", "views", "triggers", "routines", "cte", "windows", "fts"]} />
    </>
  );
}
