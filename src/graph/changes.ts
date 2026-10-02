import type { Insights } from "./insights";
import type { Graph, StatusCategory } from "./types";
import { isOneOf } from "../lib/guards";

/** What Domino remembers about a scope between visits: small enough to keep per scope locally. */
export type Snapshot = {
  takenAt: string; // ISO datetime
  /** Whether aging was known when the snapshot was taken (status history loaded). */
  hasAging: boolean;
  issues: Record<string, { c: StatusCategory; b: boolean; a?: "stuck" | "waiting" }>;
  /** Blocking links as "source>target" uid pairs. */
  blocks: string[];
};

export type ChangeKind = "new" | "blocked" | "unblocked" | "done" | "aging" | "moved";
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  new: "New",
  blocked: "Newly blocked",
  unblocked: "Unblocked",
  done: "Done",
  aging: "Newly aging",
  moved: "Status moved",
};

export type Changes = {
  /** Per in-scope issue, what changed since the snapshot (only issues with changes). */
  byIssue: ReadonlyMap<string, readonly ChangeKind[]>;
  /** Count of issues per change kind. */
  counts: Readonly<Record<ChangeKind, number>>;
  /** Issues in the snapshot that are no longer loaded. */
  leftScope: number;
  /** Blocking links that didn't exist before (between issues that both existed). */
  newLinks: number;
  since: string;
};

const pairOf = (source: string, target: string): string => `${source}>${target}`;

export function takeSnapshot(graph: Graph, insights: Insights, hasAging: boolean, now: Date = new Date()): Snapshot {
  const issues: Snapshot["issues"] = {};
  for (const n of graph.nodes) {
    if (n.ghost) continue;
    const a = insights.aging.get(n.uid)?.kind;
    issues[n.uid] = { c: n.statusCategory, b: insights.blocked.has(n.uid), ...(a ? { a } : {}) };
  }
  const blocks = graph.edges.filter((e) => e.kind === "blocks").map((e) => pairOf(e.source, e.target));
  return { takenAt: now.toISOString(), hasAging, issues, blocks: [...new Set(blocks)].sort() };
}

/** Compares the loaded graph with a snapshot. Aging is compared only when both sides know it. */
export function diffSnapshot(prev: Snapshot, graph: Graph, insights: Insights, hasAging: boolean): Changes {
  const now = takeSnapshot(graph, insights, hasAging);
  const byIssue = new Map<string, ChangeKind[]>();
  const counts: Record<ChangeKind, number> = { new: 0, blocked: 0, unblocked: 0, done: 0, aging: 0, moved: 0 };
  for (const [uid, cur] of Object.entries(now.issues)) {
    const before = Object.hasOwn(prev.issues, uid) ? prev.issues[uid] : undefined;
    const kinds: ChangeKind[] = [];
    if (!before) kinds.push("new");
    else {
      if (cur.c === "done" && before.c !== "done") kinds.push("done");
      else if (cur.c !== before.c) kinds.push("moved");
      if (cur.b && !before.b) kinds.push("blocked");
      if (!cur.b && before.b && cur.c !== "done") kinds.push("unblocked");
      if (prev.hasAging && hasAging && cur.a && !before.a) kinds.push("aging");
    }
    if (kinds.length) {
      byIssue.set(uid, kinds);
      for (const k of kinds) counts[k]++;
    }
  }
  const before = new Set(prev.blocks);
  const newLinks = now.blocks.filter((p) => {
    const [s, t] = p.split(">");
    return !before.has(p) && Object.hasOwn(prev.issues, s) && Object.hasOwn(prev.issues, t);
  }).length;
  const leftScope = Object.keys(prev.issues).filter((uid) => !Object.hasOwn(now.issues, uid)).length;
  return { byIssue, counts, leftScope, newLinks, since: prev.takenAt };
}

const CATEGORIES: readonly StatusCategory[] = ["todo", "inprogress", "done", "unknown"];
const isCategory = isOneOf(CATEGORIES);

/** Validates a stored snapshot entry by entry; malformed entries are dropped. */
export function parseSnapshot(raw: unknown): Snapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r: Record<string, unknown> = { ...raw };
  if (typeof r.takenAt !== "string" || typeof r.hasAging !== "boolean" || !Array.isArray(r.blocks)) return undefined;
  if (!r.issues || typeof r.issues !== "object") return undefined;
  const rawIssues: Record<string, unknown> = { ...r.issues };
  const issues: Snapshot["issues"] = {};
  for (const [uid, v] of Object.entries(rawIssues)) {
    if (!v || typeof v !== "object") continue;
    const e: Record<string, unknown> = { ...v };
    if (!isCategory(e.c) || typeof e.b !== "boolean") continue;
    issues[uid] = { c: e.c, b: e.b, ...(e.a === "stuck" || e.a === "waiting" ? { a: e.a } : {}) };
  }
  return { takenAt: r.takenAt, hasAging: r.hasAging, issues, blocks: r.blocks.filter((b): b is string => typeof b === "string") };
}
