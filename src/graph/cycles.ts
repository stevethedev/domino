import { defined, getOrThrow } from "../lib/guards";
import type { Cycle, Graph, GraphEdge, GraphNode } from "./types";

type Adjacency = Map<string, { to: string; edgeId: string }[]>;

function blocksAdjacency(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Adjacency {
  const adj: Adjacency = new Map(nodes.map((n) => [n.uid, []]));
  for (const e of edges) {
    if (e.kind !== "blocks") continue;
    adj.get(e.source)?.push({ to: e.target, edgeId: e.id });
  }
  for (const list of adj.values()) list.sort((a, b) => a.to.localeCompare(b.to) || a.edgeId.localeCompare(b.edgeId));
  return adj;
}

/** Tarjan's strongly connected components (iterative, so deep chains can't overflow the stack). */
function stronglyConnected(adj: Adjacency): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];

  for (const root of [...adj.keys()].sort()) {
    if (idx.has(root)) continue;
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    idx.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = adj.get(frame.v) ?? [];
      if (frame.i < succ.length) {
        const w = succ[frame.i++].to;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(getOrThrow(low, frame.v), getOrThrow(idx, w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(getOrThrow(low, parent), getOrThrow(low, frame.v)));
      }
      if (low.get(frame.v) === idx.get(frame.v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = defined(stack.pop(), "Tarjan stack entry");
          onStack.delete(w);
          comp.push(w);
        } while (w !== frame.v);
        out.push(comp);
      }
    }
  }
  return out;
}

/** Orders an SCC's members along an actual cycle where possible (starting at the smallest uid). */
function cycleOrder(members: string[], adj: Adjacency): Cycle {
  const inComp = new Set(members);
  const start = [...members].sort()[0];
  const order = [start];
  const seen = new Set(order);
  let cur = start;
  for (;;) {
    const next = (adj.get(cur) ?? []).find((s) => inComp.has(s.to) && !seen.has(s.to));
    if (!next) break;
    order.push(next.to);
    seen.add(next.to);
    cur = next.to;
  }
  for (const m of [...members].sort()) if (!seen.has(m)) order.push(m);
  return order;
}

/**
 * Finds blocking cycles (any sites). Returns each cycle, the blocks edges inside cycles (for red styling),
 * and a minimal-ish set of DFS back edges whose removal makes the blocks graph acyclic.
 */
export function findCycles(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Pick<Graph, "cycles" | "cycleEdgeIds" | "brokenEdgeIds"> {
  const adj = blocksAdjacency(nodes, edges);
  const comps = stronglyConnected(adj).filter((c) => c.length > 1 || (adj.get(c[0]) ?? []).some((s) => s.to === c[0]));
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => {
    c.forEach((u) => compOf.set(u, i));
  });

  const cycleEdgeIds = new Set<string>();
  for (const e of edges) {
    if (e.kind !== "blocks") continue;
    const a = compOf.get(e.source);
    if (a !== undefined && a === compOf.get(e.target)) cycleEdgeIds.add(e.id);
  }

  // Iterative DFS; an edge to a node still on the DFS path is a back edge.
  const brokenEdgeIds = new Set<string>();
  const state = new Map<string, 1 | 2>(); // 1 = on path, 2 = done
  for (const root of [...adj.keys()].sort()) {
    if (state.has(root)) continue;
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    state.set(root, 1);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = adj.get(frame.v) ?? [];
      if (frame.i < succ.length) {
        const { to, edgeId } = succ[frame.i++];
        const s = state.get(to);
        if (s === 1) brokenEdgeIds.add(edgeId);
        else if (s === undefined) {
          state.set(to, 1);
          work.push({ v: to, i: 0 });
        }
        continue;
      }
      state.set(frame.v, 2);
      work.pop();
    }
  }

  const cycles = comps.map((c) => cycleOrder(c, adj)).sort((a, b) => a[0].localeCompare(b[0]));
  return { cycles, cycleEdgeIds, brokenEdgeIds };
}

/**
 * Whether a card is part of a blocking cycle. A plain card: one in the graph as drawn (`drawnCycles`,
 * uids). A folded epic's summary card: one through the epic or any of its tickets in the full graph
 * (`loadedCycles`), including a cycle between its own tickets that folding hides. Drawn cycles don't
 * count for it: folding can join two of its tickets into a loop that isn't real (x → z → y drawn as
 * summary → z → summary).
 */
export function isInCycle(
  card: Pick<GraphNode, "uid" | "rollup">,
  drawnCycles: ReadonlySet<string>,
  loadedCycles: ReadonlySet<string>,
): boolean {
  if (card.rollup === undefined) return drawnCycles.has(card.uid);
  return loadedCycles.has(card.rollup.epicUid) || card.rollup.members.some((m) => loadedCycles.has(m));
}
