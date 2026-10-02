// Minimal subset of Jira REST v3 shapes that Domino reads. Only src/data and
// src/graph may import these; UI components consume graph/types.ts instead.

export type RawStatusCategoryKey = "new" | "indeterminate" | "done" | "undefined";

export type RawStatus = {
  name: string;
  id?: string;
  /** Optional for the same reason as status itself (see RawLinkedIssue): Jira JSON arrives unvalidated. */
  statusCategory?: { key: RawStatusCategoryKey; name: string; id?: number };
};

/** A Jira user as embedded in issues (assignee, reporter) and returned by `GET /myself`. */
export type RawUser = { accountId?: string; displayName: string; avatarUrls?: Record<string, string> };

export type RawIssueType = { id?: string; name: string; iconUrl?: string; hierarchyLevel?: number };

export type RawLinkType = { id: string; name: string; inward: string; outward: string; self?: string };

/** The linked issue embedded in an issuelink: summary, status and type only. */
export type RawLinkedIssue = {
  id: string;
  key: string;
  self?: string;
  // Optional: these arrive unvalidated from Jira (the Rust side passes JSON through), and
  // restricted or partially returned issues can omit them.
  fields: { summary: string; status?: RawStatus; issuetype?: RawIssueType };
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
    /** Optional for the same reason as on RawLinkedIssue. */
    issuetype?: RawIssueType;
    status?: RawStatus;
    assignee: RawUser | null;
    /** Optional: older fixtures and restricted issues can omit it. */
    reporter?: RawUser | null;
    /** "Story point estimate" on Jira Cloud. */
    customfield_10016?: number | null;
    /** Legacy "Epic Link" (older company-managed projects): the epic's key. */
    customfield_10014?: string | null;
    /** ISO datetime the issue was resolved, or null. */
    resolutiondate?: string | null;
    /** "YYYY-MM-DD", or null. */
    duedate?: string | null;
    /** ISO datetime the issue was created. */
    created?: string;
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

/** One field change inside a changelog entry. Status changes carry status ids in from/to. */
export type RawChangeItem = {
  field?: string;
  fieldId?: string;
  from?: string | null;
  fromString?: string | null;
  to?: string | null;
  toString?: string | null;
};

/** `created` is an ISO datetime (or epoch ms from some endpoints). */
export type RawChangeHistory = { id?: string; created: string | number; items: RawChangeItem[] };

/** One issue's entry in `POST /rest/api/3/changelog/bulkfetch` → `issueChangeLogs`. */
export type RawIssueChangeLog = { issueId: string; changeHistories: RawChangeHistory[] };

/** `GET /rest/api/3/status` item. */
/** `statusCategory` is optional: like issues, this arrives as unvalidated Jira JSON. */
export type RawStatusDef = { id: string; name: string; statusCategory?: { key: RawStatusCategoryKey; name?: string } };
