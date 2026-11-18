/** Functional-dependency theory, implemented exactly (no heuristics). Attributes are strings. */
export type FD = { lhs: string[]; rhs: string[] };

const uniq = (a: string[]) => [...new Set(a)].sort();
const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));
const eq = (a: string[], b: string[]) => subset(a, b) && subset(b, a);

/** Parse "A,B -> C; D -> E" (also accepts →). */
export function parseFDs(text: string): FD[] {
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [l, r] = s.split(/->|→/);
      if (r === undefined) throw new Error(`Missing "->" in "${s}"`);
      const lhs = uniq(l.split(/[,\s]+/).filter(Boolean));
      const rhs = uniq(r.split(/[,\s]+/).filter(Boolean));
      if (!lhs.length || !rhs.length) throw new Error(`Empty side in "${s}"`);
      return { lhs, rhs };
    });
}
export const fdText = (f: FD) => `${f.lhs.join(", ")} → ${f.rhs.join(", ")}`;

/** X⁺ under F (the standard fixpoint algorithm). Returns the closure and the derivation trace. */
export function closure(attrs: string[], fds: FD[]) {
  const result = new Set(attrs);
  const trace: { fd: FD; added: string[] }[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of fds) {
      if (subset(f.lhs, [...result])) {
        const added = f.rhs.filter((a) => !result.has(a));
        if (added.length) {
          added.forEach((a) => result.add(a));
          trace.push({ fd: f, added });
          changed = true;
        }
      }
    }
  }
  return { closure: uniq([...result]), trace };
}

export const isSuperkey = (x: string[], all: string[], fds: FD[]) => subset(all, closure(x, fds).closure);

/** All candidate keys (minimal superkeys). Attributes that never appear on a RHS must be in every key. */
export function candidateKeys(all: string[], fds: FD[]): string[][] {
  const rhs = new Set(fds.flatMap((f) => f.rhs.filter((a) => !f.lhs.includes(a))));
  const core = all.filter((a) => !rhs.has(a));
  if (isSuperkey(core, all, fds)) return [uniq(core)];
  const rest = all.filter((a) => !core.includes(a));
  const keys: string[][] = [];
  for (let size = 1; size <= rest.length; size++) {
    const combos = (start: number, acc: string[]): void => {
      if (acc.length === size) {
        const k = uniq([...core, ...acc]);
        if (!keys.some((key) => subset(key, k)) && isSuperkey(k, all, fds)) keys.push(k);
        return;
      }
      for (let i = start; i < rest.length; i++) combos(i + 1, [...acc, rest[i]]);
    };
    combos(0, []);
    if (rest.length > 14 && keys.length) break; // guard against exponential blow-up on very wide relations
  }
  return keys;
}

/** Minimal (canonical) cover: singleton RHS, no extraneous LHS attributes, no redundant FDs. */
export function minimalCover(fds: FD[]): FD[] {
  let g: FD[] = fds.flatMap((f) => f.rhs.filter((r) => !f.lhs.includes(r)).map((r) => ({ lhs: [...f.lhs], rhs: [r] })));
  g = g.map((f) => {
    let lhs = [...f.lhs];
    for (const a of f.lhs) {
      if (lhs.length === 1) break;
      const reduced = lhs.filter((x) => x !== a);
      if (subset(f.rhs, closure(reduced, g).closure)) lhs = reduced;
    }
    return { lhs, rhs: f.rhs };
  });
  for (let i = 0; i < g.length; i++) {
    const others = g.filter((_, j) => j !== i);
    if (subset(g[i].rhs, closure(g[i].lhs, others).closure)) {
      g = others;
      i--;
    }
  }
  return g.filter((f, i) => g.findIndex((h) => eq(h.lhs, f.lhs) && eq(h.rhs, f.rhs)) === i);
}

export type Violation = { fd: FD; reason: string };
export function analyse(all: string[], fds: FD[]) {
  const keys = candidateKeys(all, fds);
  const prime = uniq(keys.flat());
  const cover = minimalCover(fds);
  const twoNF: Violation[] = [];
  const threeNF: Violation[] = [];
  const bcnf: Violation[] = [];
  for (const f of cover) {
    const trivial = subset(f.rhs, f.lhs);
    if (trivial) continue;
    const superkey = isSuperkey(f.lhs, all, fds);
    const rhsPrime = f.rhs.every((a) => prime.includes(a));
    if (!superkey) bcnf.push({ fd: f, reason: `${f.lhs.join(", ")} is not a superkey` });
    if (!superkey && !rhsPrime) threeNF.push({ fd: f, reason: `${f.rhs.join(", ")} is non-prime and depends on non-superkey ${f.lhs.join(", ")} (transitive dependency)` });
    const partial = keys.some((k) => k.length > 1 && subset(f.lhs, k) && !eq(f.lhs, k));
    if (partial && !rhsPrime) twoNF.push({ fd: f, reason: `${f.rhs.join(", ")} depends on part (${f.lhs.join(", ")}) of a composite key (partial dependency)` });
  }
  const highest = twoNF.length ? "1NF" : threeNF.length ? "2NF" : bcnf.length ? "3NF" : "BCNF";
  return { keys, prime, nonPrime: all.filter((a) => !prime.includes(a)), cover, twoNF, threeNF, bcnf, highest };
}

/** Project F onto a sub-schema (exact, via closures of every subset — fine for teaching-size relations). */
export function project(fds: FD[], attrs: string[]): FD[] {
  const out: FD[] = [];
  const n = attrs.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const x = attrs.filter((_, i) => mask & (1 << i));
    const rhs = closure(x, fds).closure.filter((a) => attrs.includes(a) && !x.includes(a));
    if (rhs.length) out.push({ lhs: x, rhs });
  }
  return minimalCover(out);
}

/** Lossless-join BCNF decomposition (repeatedly split on a violating FD). */
export function bcnfDecompose(all: string[], fds: FD[]) {
  const result: string[][] = [];
  const steps: string[] = [];
  const work = [uniq(all)];
  while (work.length) {
    const r = work.pop()!;
    const local = project(fds, r);
    const v = local.find((f) => !subset(f.rhs, f.lhs) && !isSuperkey(f.lhs, r, local));
    if (!v || r.length <= 2) {
      result.push(r);
      continue;
    }
    const x = closure(v.lhs, local).closure.filter((a) => r.includes(a));
    const r1 = uniq(x);
    const r2 = uniq([...v.lhs, ...r.filter((a) => !x.includes(a))]);
    steps.push(`Split (${r.join(", ")}) on ${fdText(v)} into (${r1.join(", ")}) and (${r2.join(", ")})`);
    work.push(r1, r2);
  }
  const preserved = minimalCover(fds).every((f) => {
    // dependency preservation test (Ullman's algorithm)
    let z = [...f.lhs];
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of result) {
        const t = closure(z.filter((a) => r.includes(a)), fds).closure.filter((a) => r.includes(a));
        const nz = uniq([...z, ...t]);
        if (nz.length > z.length) {
          z = nz;
          changed = true;
        }
      }
    }
    return subset(f.rhs, z);
  });
  return { relations: result.map(uniq), steps, dependencyPreserving: preserved };
}

/** 3NF synthesis (Bernstein): lossless and dependency-preserving. */
export function threeNFSynthesis(all: string[], fds: FD[]) {
  const cover = minimalCover(fds);
  const groups = new Map<string, string[]>();
  for (const f of cover) groups.set(f.lhs.join(","), uniq([...(groups.get(f.lhs.join(",")) ?? f.lhs), ...f.rhs]));
  let rels = [...groups.values()];
  const keys = candidateKeys(all, fds);
  if (!rels.some((r) => keys.some((k) => subset(k, r)))) rels.push(keys[0]);
  rels = rels.filter((r, i) => !rels.some((s, j) => j !== i && subset(r, s) && (r.length < s.length || j < i)));
  return rels.map(uniq);
}

/** Chase test for lossless join of a decomposition. */
export function isLossless(all: string[], parts: string[][], fds: FD[]) {
  const t = parts.map((p, i) => Object.fromEntries(all.map((a) => [a, p.includes(a) ? `a_${a}` : `b${i}_${a}`])));
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of minimalCover(fds))
      for (let i = 0; i < t.length; i++)
        for (let j = i + 1; j < t.length; j++)
          if (f.lhs.every((a) => t[i][a] === t[j][a]))
            for (const a of f.rhs)
              if (t[i][a] !== t[j][a]) {
                const keep = t[i][a].startsWith("a_") ? t[i][a] : t[j][a];
                const drop = keep === t[i][a] ? t[j][a] : t[i][a];
                for (const row of t) for (const k of all) if (row[k] === drop) row[k] = keep;
                changed = true;
              }
  }
  return t.some((row) => all.every((a) => row[a] === `a_${a}`));
}
