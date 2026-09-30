// Minimal subset of Jira REST v3 shapes that Domino reads. Only src/data and
// src/graph may import these; UI components consume graph/types.ts instead.

export type RawStatusCategoryKey = "new" | "indeterminate" | "done" | "undefined";

export type RawStatus = {
  name: string;
  id?: string;
  statusCategory: { key: RawStatusCategoryKey; name: string; id?: number };
};

export type RawIssueType = { id?: string; name: string; iconUrl?: string; hierarchyLevel?: number };

export type RawLinkType = { id: string; name: string; inward: string; outward: string; self?: string };

/** The linked issue embedded in an issuelink: summary, status and type only. */
export type RawLinkedIssue = {
  id: string;
  key: string;
  self?: string;
  fields: { summary: string; status: RawStatus; issuetype: RawIssueType };
};

export type RawIssueLink = {
  id: string;
  self?: string;
  type: RawLinkType;
  inwardIssue?: RawLinkedIssue;
  outwardIssue?: RawLinkedIssue;
};

export type RawIssue = {
  id: string;
  key: string;
  self?: string;
  fields: {
    summary: string;
    issuetype: RawIssueType;
    status: RawStatus;
    assignee: { accountId?: string; displayName: string; avatarUrls?: Record<string, string> } | null;
    /** "Story point estimate" on Jira Cloud. */
    customfield_10016?: number | null;
    /** Legacy "Epic Link" (older company-managed projects): the epic's key. */
    customfield_10014?: string | null;
    parent?: RawLinkedIssue;
    issuelinks?: RawIssueLink[];
  };
};

export type RawRemoteLink = {
  id: number;
  self?: string;
  globalId?: string;
  application?: { type?: string; name?: string };
  relationship?: string;
  object: { url: string; title?: string; status?: { resolved?: boolean } };
};

/** Everything loaded for one site. `issues` are in scope; anything they reference that isn't here is a ghost. */
export type RawSiteData = {
  siteId: string;
  issues: RawIssue[];
  remoteLinks: Record<string, RawRemoteLink[]>;
  linkTypes: RawLinkType[];
};
