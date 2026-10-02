import type { SiteConfig } from "../config/types";
import type { RawIssue, RawLinkedIssue, RawSiteData, RawStatus } from "../data/jiraTypes";
import { getOrThrow } from "../lib/guards";
import { findCycles } from "./cycles";
import { DEFAULT_LINK_TYPES, kindOf, resolveRelationship } from "./linkTypes";
import { matchRemoteUrl } from "./remoteUrl";
import type { EpicRef, Graph, GraphEdge, GraphNode, StatusCategory } from "./types";
import { toDay } from "./schedule";
import { uidOf } from "./types";

export type BuildInput = {
  /** Every configured site, including disabled ones (used to label ghosts and match remote URLs). */
  sites: readonly SiteConfig[];
  /** Raw data for the sites that loaded successfully. */
  data: readonly RawSiteData[];
};

function statusCategoryOf(status: RawStatus | undefined): StatusCategory {
  switch (status?.statusCategory?.key) {
    case "new":
      return "todo";
    case "indeterminate":
      return "inprogress";
    case "done":
      return "done";
    default:
      return "unknown";
  }
}

const browseUrl = (baseUrl: string, key: string): string => `${baseUrl.replace(/\/+$/, "")}/browse/${key}`;

const isEpicType = (t: { name?: string; hierarchyLevel?: number } | undefined): boolean =>
  !!t && (t.hierarchyLevel !== undefined ? t.hierarchyLevel === 1 : t.name?.toLowerCase() === "epic");

/**
 * Direct epic of an issue, when knowable from the issue alone: itself if it's an epic, its parent if the
 * parent is an epic, else the legacy Epic Link. A sub-task (parent is a story) returns `{ viaParent }`
 * so the caller can inherit the story's epic once every issue is known.
 */
function directEpic(issue: RawIssue, site: SiteConfig): EpicRef | { viaParent: string } | undefined {
  const f = issue.fields;
  const ref = (key: string, summary?: string): EpicRef => ({ uid: uidOf(site.id, key), key, summary, url: browseUrl(site.baseUrl, key) });
  if (isEpicType(f.issuetype)) return ref(issue.key, f.summary);
  if (f.parent) {
    if (isEpicType(f.parent.fields.issuetype)) return ref(f.parent.key, f.parent.fields.summary);
    return { viaParent: uidOf(site.id, f.parent.key) };
  }
  if (typeof f.customfield_10014 === "string" && f.customfield_10014) return ref(f.customfield_10014);
  return undefined;
}

function nodeFromIssue(issue: RawIssue, site: SiteConfig): GraphNode {
  const f = issue.fields;
  const avatars = f.assignee?.avatarUrls;
  return {
    uid: uidOf(site.id, issue.key),
    siteId: site.id,
    siteLabel: site.label,
    siteColor: site.color,
    key: issue.key,
    summary: f.summary,
    issueType: f.issuetype?.name ?? "Issue",
    statusName: f.status?.name ?? "Unknown",
    statusCategory: statusCategoryOf(f.status),
    assigneeName: f.assignee?.displayName,
    assigneeAvatarUrl: avatars?.["48x48"] ?? avatars?.["24x24"],
    assigneeAccountId: f.assignee?.accountId,
    reporterAccountId: f.reporter?.accountId,
    storyPoints: typeof f.customfield_10016 === "number" ? f.customfield_10016 : undefined,
    url: browseUrl(site.baseUrl, issue.key),
    ghost: false,
    jiraId: issue.id,
    dates: {
      resolved: f.resolutiondate ? toDay(f.resolutiondate) : undefined,
      due: f.duedate ? f.duedate.slice(0, 10) : undefined,
      created: f.created ? toDay(f.created) : undefined,
    },
  };
}

function ghostFromLinked(ref: RawLinkedIssue, site: SiteConfig): GraphNode {
  return {
    uid: uidOf(site.id, ref.key),
    siteId: site.id,
    siteLabel: site.label,
    siteColor: site.color,
    key: ref.key,
    summary: ref.fields.summary,
    issueType: ref.fields.issuetype?.name ?? "Issue",
    statusName: ref.fields.status?.name ?? "Unknown",
    statusCategory: statusCategoryOf(ref.fields.status),
    url: browseUrl(site.baseUrl, ref.key),
    ghost: true,
  };
}

function ghostUnknown(uid: string, siteId: string, siteLabel: string, key: string, url: string, title?: string, siteColor?: string): GraphNode {
  return {
    uid,
    siteId,
    siteLabel,
    siteColor,
    key,
    summary: title && title !== key ? title : "Linked issue (details not loaded)",
    issueType: "Issue",
    statusName: "Unknown",
    statusCategory: "unknown",
    url,
    ghost: true,
  };
}

/**
 * Turns raw per-site Jira data into one graph keyed by uid.
 * - Native links: normalized to outward direction, deduped by siteId + linkId.
 * - Remote links: matched to configured sites (edge) or unconfigured Jira hosts (ghost),
 *   normalized, then deduped by (source, target, linkType) so reciprocal remote links collapse.
 * - Issues referenced but not loaded become ghosts; loaded issues always win over ghosts.
 */
export function buildGraph({ sites, data }: BuildInput): Graph {
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const nodes = new Map<string, GraphNode>();
  const ghosts = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const remoteSeen = new Map<string, string>(); // triple -> edge id

  const pendingEpic = new Map<string, string>(); // sub-task uid -> parent uid
  for (const d of data) {
    const site = siteById.get(d.siteId);
    if (!site) continue;
    for (const issue of d.issues) {
      const node = nodeFromIssue(issue, site);
      const epic = directEpic(issue, site);
      if (epic && "viaParent" in epic) pendingEpic.set(node.uid, epic.viaParent);
      else node.epic = epic;
      nodes.set(node.uid, node);
    }
  }
  // Sub-tasks inherit the epic of their (loaded) parent story; a missing story leaves them epic-less.
  for (const [uid, parentUid] of pendingEpic) {
    const epic = nodes.get(parentUid)?.epic;
    if (epic) getOrThrow(nodes, uid).epic = epic;
  }
  // Fill in summaries for Epic Link references when the epic itself is loaded.
  for (const n of nodes.values()) {
    if (n.epic && !n.epic.summary) n.epic = { ...n.epic, summary: nodes.get(n.epic.uid)?.summary };
  }

  const addGhost = (g: GraphNode): void => {
    if (!nodes.has(g.uid) && !ghosts.has(g.uid)) ghosts.set(g.uid, g);
  };
  const siteOf = (uid: string): string | undefined => (nodes.get(uid) ?? ghosts.get(uid))?.siteId;

  for (const d of data) {
    const site = siteById.get(d.siteId);
    if (!site) continue;
    const linkTypes = d.linkTypes.length ? d.linkTypes : DEFAULT_LINK_TYPES;

    for (const issue of d.issues) {
      const self = uidOf(site.id, issue.key);

      for (const link of issue.fields.issuelinks ?? []) {
        const other = link.outwardIssue ?? link.inwardIssue;
        if (!other) continue;
        const otherUid = uidOf(site.id, other.key);
        addGhost(ghostFromLinked(other, site));
        const id = `${site.id}:link:${link.id}`;
        if (edges.has(id)) continue;
        // outwardIssue on this issue means "this <outward> other".
        const [source, target] = link.outwardIssue ? [self, otherUid] : [otherUid, self];
        edges.set(id, {
          id,
          source,
          target,
          kind: kindOf(link.type),
          linkType: link.type.outward.toLowerCase(),
          linkId: link.id,
          crossSite: false,
        });
      }

      for (const rl of d.remoteLinks[issue.key] ?? []) {
        const match = matchRemoteUrl(rl.object.url, sites);
        if (!match) continue;
        let otherUid: string;
        if (match.kind === "site") {
          otherUid = uidOf(match.siteId, match.key);
          const s = getOrThrow(siteById, match.siteId);
          addGhost(ghostUnknown(otherUid, s.id, s.label, match.key, browseUrl(s.baseUrl, match.key), rl.object.title, s.color));
        } else {
          otherUid = uidOf(match.host, match.key);
          addGhost(ghostUnknown(otherUid, match.host, match.host, match.key, match.url, rl.object.title));
        }
        if (otherUid === self) continue;
        const rel = resolveRelationship(rl.relationship, linkTypes);
        const [source, target] = rel.inward ? [otherUid, self] : [self, otherUid];
        const pair = rel.symmetric ? [source, target].sort() : [source, target];
        const triple = `${pair[0]}|${pair[1]}|${rel.linkType}`;
        if (remoteSeen.has(triple)) continue;
        const id = `${site.id}:remote:${rl.id}`;
        remoteSeen.set(triple, id);
        edges.set(id, {
          id,
          source,
          target,
          kind: rel.kind,
          linkType: rel.linkType,
          linkId: `remote:${rl.id}`,
          crossSite: false, // set below once both endpoints are known
        });
      }
    }
  }

  const allNodes = [...nodes.values(), ...ghosts.values()];
  const allEdges = [...edges.values()].map((e) => ({ ...e, crossSite: siteOf(e.source) !== siteOf(e.target) }));
  const { cycles, cycleEdgeIds, brokenEdgeIds } = findCycles(allNodes, allEdges);
  return { nodes: allNodes, edges: allEdges, cycles, cycleEdgeIds, brokenEdgeIds };
}
