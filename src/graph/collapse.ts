import { findCycles } from "./cycles";
import type { Insights } from "./insights";
import type { EpicRollup, Graph, GraphEdge, GraphNode, StatusCategory } from "./types";

export const summaryUid = (epicUid: string) => `epic-summary:${epicUid}`;

export type CollapsedGraph = {
  graph: Graph;
  /** Original issue uid -> the node it is shown as (itself, or its epic's summary). */
  shownAs: ReadonlyMap<string, string>;
};

function rollupCategory(members: readonly GraphNode[]): StatusCategory {
  if (members.length && members.every((m) => m.statusCategory === "done")) return "done";
  if (members.some((m) => m.statusCategory === "inprogress" || m.statusCategory === "done")) return "inprogress";
  return "todo";
}

/**
 * The epic-level map: every epic not in `expanded` becomes one summary node standing for its
 * loaded issues (and the epic itself). Links between different nodes are combined into one edge
 * per direction and kind, counting the links and how many are still open (blocker not Done);
 * links inside an epic disappear. Issues without an epic, ghosts and expanded epics' issues stay
 * as they are, so nothing is hidden. Cycles are recomputed at the epic level.
 */
export function collapseEpics(graph: Graph, insights: Insights, expanded: ReadonlySet<string>): CollapsedGraph {
  const byUid = new Map(graph.nodes.map((n) => [n.uid, n]));
  const shownAs = new Map<string, string>();
  const members = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    const epicUid = n.ghost ? undefined : n.epic?.uid;
    if (!epicUid || expanded.has(epicUid)) {
      shownAs.set(n.uid, n.uid);
      continue;
    }
    shownAs.set(n.uid, summaryUid(epicUid));
    if (n.uid !== epicUid) members.set(epicUid, [...(members.get(epicUid) ?? []), n]);
    else if (!members.has(epicUid)) members.set(epicUid, []);
  }
  // An epic that's only present as a ghost (linked, not loaded) folds into its summary too.
  for (const epicUid of members.keys()) {
    if (byUid.get(epicUid)?.ghost) shownAs.set(epicUid, summaryUid(epicUid));
  }

  const summaries: GraphNode[] = [...members].map(([epicUid, ms]) => {
    const node = byUid.get(epicUid);
    const epic = node && !node.ghost ? node : undefined; // ghosts carry no epic ref
    const ref = (epic ?? ms.find((m) => m.epic))!.epic!;
    const site = epic ?? ms[0];
    const rollup: EpicRollup = {
      epicUid,
      members: ms.map((m) => m.uid),
      done: ms.filter((m) => m.statusCategory === "done").length,
      blocked: ms.filter((m) => insights.blocked.has(m.uid)).length,
      aging: ms.filter((m) => insights.aging.has(m.uid)).length,
    };
    // With no loaded children, the epic's own status is the best signal.
    const category = ms.length ? rollupCategory(ms) : (epic?.statusCategory ?? "todo");
    const statusName = !ms.length && epic ? epic.statusName : category === "done" ? "Done" : category === "inprogress" ? "In Progress" : "To Do";
    return {
      uid: summaryUid(epicUid),
      siteId: site.siteId,
      siteLabel: site.siteLabel,
      siteColor: site.siteColor,
      key: ref.key,
      summary: ref.summary ?? epic?.summary ?? ref.key,
      issueType: "Epic",
      statusName,
      statusCategory: category,
      url: ref.url,
      ghost: false,
      rollup,
    };
  });

  const kept: GraphEdge[] = [];
  const combined = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const [s, t] = [shownAs.get(e.source)!, shownAs.get(e.target)!];
    if (s === t) continue; // inside one epic
    if (s === e.source && t === e.target) {
      kept.push(e);
      continue;
    }
    const id = `agg:${e.kind}:${s}->${t}`;
    const open = byUid.get(e.source)?.statusCategory !== "done" ? 1 : 0;
    const prev = combined.get(id);
    combined.set(id, {
      id,
      source: s,
      target: t,
      kind: e.kind,
      linkType: e.linkType,
      linkId: id,
      crossSite: (prev?.crossSite ?? false) || e.crossSite,
      aggregate: { links: (prev?.aggregate?.links ?? 0) + 1, open: (prev?.aggregate?.open ?? 0) + open },
    });
  }

  const nodes = [...graph.nodes.filter((n) => shownAs.get(n.uid) === n.uid), ...summaries];
  const edges = [...kept, ...combined.values()];
  return { graph: { nodes, edges, ...findCycles(nodes, edges) }, shownAs };
}

/** The id an original edge is drawn under after collapsing (itself, or the combined edge). */
export function shownEdgeId(e: GraphEdge, shownAs: ReadonlyMap<string, string>): string | undefined {
  const [s, t] = [shownAs.get(e.source) ?? e.source, shownAs.get(e.target) ?? e.target];
  if (s === t) return undefined;
  return s === e.source && t === e.target ? e.id : `agg:${e.kind}:${s}->${t}`;
}
