"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type GNode = { id: string; label: string; name: string; props: Record<string, unknown> };
export type GEdge = { source: string; target: string; type: string };
export const LABEL_COLORS: Record<string, string> = {
  Disaster: "#d03b3b", Location: "#64748b", Camp: "#0f9d8a", Warehouse: "#2563eb", Resource: "#eda100", Request: "#eb6834", Allocation: "#6d4fd8", Delivery: "#1baf7a",
};

/** Small dependency-free force-directed layout (springs + repulsion), rendered as SVG. */
export default function ForceGraph({ nodes, edges, height = 560 }: { nodes: GNode[]; edges: GEdge[]; height?: number }) {
  const W = 900;
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hover, setHover] = useState<GNode | null>(null);
  const raf = useRef<number | null>(null);
  const key = useMemo(() => nodes.map((n) => n.id).join("|") + ":" + edges.length, [nodes, edges]);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const p = new Map(nodes.map((n, i) => [n.id, { x: W / 2 + 260 * Math.cos((2 * Math.PI * i) / nodes.length), y: height / 2 + 200 * Math.sin((2 * Math.PI * i) / nodes.length), vx: 0, vy: 0 }]));
    let iter = 0;
    const tick = () => {
      const arr = [...p.values()];
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = Math.max(dx * dx + dy * dy, 40);
          const d = Math.sqrt(d2);
          const f = 2600 / d2;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
      for (const e of edges) {
        const a = p.get(e.source), b = p.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.02;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const v of arr) {
        v.vx += (W / 2 - v.x) * 0.004;
        v.vy += (height / 2 - v.y) * 0.004;
        v.x = Math.max(20, Math.min(W - 20, v.x + v.vx * 0.5));
        v.y = Math.max(20, Math.min(height - 20, v.y + v.vy * 0.5));
        v.vx *= 0.6;
        v.vy *= 0.6;
      }
      iter++;
    };
    const publish = () => setPos(new Map([...p.entries()].map(([k, v]) => [k, { x: v.x, y: v.y }])));
    if (reduce) {
      for (let i = 0; i < 300; i++) tick();
      publish();
      return;
    }
    const loop = () => {
      tick();
      if (iter % 3 === 0) publish();
      if (iter < 300) raf.current = requestAnimationFrame(loop);
      else publish();
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, height]);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height: "auto", background: "#fbfcfe", borderRadius: 10 }} role="img" aria-label={`Graph with ${nodes.length} nodes and ${edges.length} relationships`}>
        <defs>
          <marker id="ga" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b6c2d2" /></marker>
        </defs>
        {edges.map((e, i) => {
          const a = pos.get(e.source), b = pos.get(e.target);
          if (!a || !b) return null;
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c8d2df" strokeWidth={1.2} markerEnd="url(#ga)" />
              {edges.length < 60 && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} fontSize={8.5} fill="#94a3b8" textAnchor="middle">{e.type}</text>}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
              <circle r={n.label === "Disaster" ? 11 : n.label === "Resource" ? 7 : 8} fill={LABEL_COLORS[n.label] ?? "#94a3b8"} stroke="#fff" strokeWidth={2} />
              {(nodes.length < 45 || ["Disaster", "Warehouse", "Camp"].includes(n.label)) && (
                <text y={-13} fontSize={9.5} textAnchor="middle" fill="#334155">{n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div style={{ position: "absolute", top: 10, right: 10, background: "#0f1a2c", color: "#e6edf7", borderRadius: 10, padding: "9px 11px", fontSize: 12, maxWidth: 260 }}>
          <b>{hover.label}: {hover.name}</b>
          {Object.entries(hover.props).filter(([k]) => k !== "name").slice(0, 6).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
        </div>
      )}
    </div>
  );
}
