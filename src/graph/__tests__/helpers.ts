import type { SiteConfig } from "../../config/types";
import type { RawIssue, RawLinkedIssue, RawLinkType, RawRemoteLink, RawSiteData, RawStatusCategoryKey } from "../../data/jiraTypes";

export const BLOCKS: RawLinkType = { id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" };
export const RELATES: RawLinkType = { id: "2", name: "Relates", inward: "relates to", outward: "relates to" };
export const DUPLICATE: RawLinkType = { id: "3", name: "Duplicate", inward: "is duplicated by", outward: "duplicates" };

export const site = (id: string, enabled = true): SiteConfig => ({
  id,
  label: id.toUpperCase(),
  baseUrl: `https://${id}.atlassian.net`,
  auth: { type: "oauth3lo" },
  color: "#123456",
  enabled,
});

const CAT_NAME: Record<RawStatusCategoryKey, string> = {
  new: "To Do",
  indeterminate: "In Progress",
  done: "Done",
  undefined: "No Category",
};

export function issue(key: string, cat: RawStatusCategoryKey = "new", summary = `Summary of ${key}`): RawIssue {
  return {
    id: key,
    key,
    fields: {
      summary,
      issuetype: { name: "Story" },
      status: { name: CAT_NAME[cat], statusCategory: { key: cat, name: CAT_NAME[cat] } },
      assignee: null,
      issuelinks: [],
    },
  };
}

/** Adds a native link on both issues exactly as Jira returns it. Pass `null` for an issue that isn't loaded. */
export function link(
  id: string,
  type: RawLinkType,
  outward: RawIssue,
  inward: RawIssue,
  loaded: { out: boolean; in: boolean } = { out: true, in: true },
): void {
  const ref = (i: RawIssue): RawLinkedIssue => ({
    id: i.id,
    key: i.key,
    fields: { summary: i.fields.summary, status: i.fields.status, priority: i.fields.priority, issuetype: i.fields.issuetype },
  });
  if (loaded.out) (outward.fields.issuelinks ??= []).push({ id, type, outwardIssue: ref(inward) });
  if (loaded.in) (inward.fields.issuelinks ??= []).push({ id, type, inwardIssue: ref(outward) });
}

export function remote(id: number, relationship: string, url: string, title?: string): RawRemoteLink {
  return { id, relationship, object: { url, title } };
}

export function data(siteId: string, issues: RawIssue[], remoteLinks: Record<string, RawRemoteLink[]> = {}): RawSiteData {
  return { siteId, issues, remoteLinks, linkTypes: [BLOCKS, RELATES, DUPLICATE] };
}
