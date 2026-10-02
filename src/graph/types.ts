// The only data shapes UI components consume.

export type StatusCategory = "todo" | "inprogress" | "done" | "unknown";

/** Visual/semantic family of a link. "duplicates" covers both duplicates and clones. */
export type LinkKind = "blocks" | "relates" | "duplicates";

export type GraphNode = {
  uid: string; // `${siteId}:${key}`
  siteId: string; // configured site id, or the host for unconfigured Jira sites
  siteLabel: string;
  siteColor?: string;
  key: string;
  summary: string;
  issueType: string;
  statusName: string;
  statusCategory: StatusCategory;
  assigneeName?: string;
  assigneeAvatarUrl?: string;
  storyPoints?: number;
  url: string;
  ghost: boolean;
  /** The epic this issue rolls up to (an epic points at itself). Unknown for ghosts. */
  epic?: EpicRef;
  /** Jira's numeric issue id, needed to match changelog entries. Unknown for ghosts. */
  jiraId?: string;
  /** Set on collapsed-epic summary nodes: what the epic's loaded issues look like together. */
  rollup?: EpicRollup;
  /** Calendar days ("YYYY-MM-DD") from Jira fields. */
  dates?: { resolved?: string; due?: string; created?: string };
};

export type EpicRef = { uid: string; key: string; summary?: string; url: string };

export type EpicRollup = {
  epicUid: string;
  /** In-scope member issues (not the epic itself). */
  members: readonly string[];
  done: number;
  blocked: number;
  aging: number;
};

export type GraphEdge = {
  id: string;
  source: string; // uid of the blocker / outward side
  target: string; // uid of the blocked / inward side
  kind: LinkKind;
  linkType: string; // outward verb, e.g. "blocks", "clones"
  linkId: string;
  crossSite: boolean;
  /** Set on edges that combine several links between collapsed epics. */
  aggregate?: { links: number; open: number };
};

export type Cycle = string[]; // uids, in cycle order

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: Cycle[];
  /** Blocks edges whose endpoints lie in the same cycle; drawn red. */
  cycleEdgeIds: ReadonlySet<string>;
  /** Back edges removed so the blocks graph is acyclic (layout + critical path only). */
  brokenEdgeIds: ReadonlySet<string>;
};

export const uidOf = (siteId: string, key: string): string => `${siteId}:${key}`;
