import type { Graph, GraphNode } from "./types";

const isOpen = (n: GraphNode | undefined) => !n || n.statusCategory !== "done";

/** A chain of issues and the blocks edges between consecutive ones. */
export type Chain = { nodes: string[]; edges: string[] };

/** Open blockers per uid: distinct blockers that aren't Done (unknown-status ghosts count as open). */
export function openBlockerCounts(graph: Graph): Map<string, number> {
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const blockers = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "blocks" || e.source === e.target) continue;
    if (!isOpen(byUid.get(e.source))) continue;
    let set = blockers.get(e.target);
    if (!set) blockers.set(e.target, (set = new Set()));
    set.add(e.source);
  }
  return new Map([...blockers].map(([uid, s]) => [uid, s.size]));
}

/** In-scope issues that aren't Done and have no open blockers. */
export function readyIssues(graph: Graph): Set<string> {
  const counts = openBlockerCounts(graph);
  return new Set(
    graph.nodes.filter((n) => !n.ghost && n.statusCategory !== "done" && !counts.get(n.uid)).map((n) => n.uid),
  );
}

function compareUids(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = a[i].localeCompare(b[i]);
    if (c) return c;
  }
  return a.length - b.length;
}

/**
 * Longest chain (by issue count) of blocks edges among in-scope, not-Done issues, after cycle breaking.
 * Ties go to the lexicographically smallest uid sequence. Returns the uids and the edge ids on the path.
 */
export function criticalPath(graph: Graph): Chain {
  const eligible = new Set(graph.nodes.filter((n) => !n.ghost && n.statusCategory !== "done").map((n) => n.uid));
  const edges = graph.edges.filter(
    (e) =>
      e.kind === "blocks" &&
      !graph.brokenEdgeIds.has(e.id) &&
      e.source !== e.target &&
      eligible.has(e.source) &&
      eligible.has(e.target),
  );
  const indeg = new Map([...eligible].map((u) => [u, 0]));
  const out = new Map<string, { to: string; id: string }[]>();
  for (const e of edges) {
    indeg.set(e.target, indeg.get(e.target)! + 1);
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push({ to: e.target, id: e.id });
  }
  // best[v] = best path ending at v
  const best = new Map<string, Chain>(
    [...eligible].map((u) => [u, { nodes: [u], edges: [] }]),
  );
  const queue = [...eligible].filter((u) => indeg.get(u) === 0).sort();
  while (queue.length) {
    const v = queue.shift()!;
    const bv = best.get(v)!;
    for (const { to, id } of out.get(v) ?? []) {
      const cand = { nodes: [...bv.nodes, to], edges: [...bv.edges, id] };
      const cur = best.get(to)!;
      if (cand.nodes.length > cur.nodes.length || (cand.nodes.length === cur.nodes.length && compareUids(cand.nodes, cur.nodes) < 0)) {
        best.set(to, cand);
      }
      indeg.set(to, indeg.get(to)! - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
    queue.sort();
  }
  let result: Chain = { nodes: [], edges: [] };
  for (const p of best.values()) {
    if (p.nodes.length > result.nodes.length || (p.nodes.length === result.nodes.length && compareUids(p.nodes, result.nodes) < 0)) {
      result = p;
    }
  }
  // A single isolated issue isn't a "chain".
  return result.nodes.length > 1 ? result : { nodes: [], edges: [] };
}

/** All ancestors and descendants of `uid` through blocks edges (any site), plus the edges connecting them. */
export function blockingChain(graph: Graph, uid: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([uid]);
  const edges = new Set<string>();
  const blocks = graph.edges.filter((e) => e.kind === "blocks");
  const walk = (dir: "down" | "up") => {
    const seen = new Set([uid]);
    const queue = [uid];
    while (queue.length) {
      const v = queue.shift()!;
      for (const e of blocks) {
        const from = dir === "down" ? e.source : e.target;
        const to = dir === "down" ? e.target : e.source;
        if (from !== v) continue;
        edges.add(e.id);
        nodes.add(to);
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
  };
  walk("down");
  walk("up");
  return { nodes, edges };
}
