// GitHub GraphQL shapes, as the queries in src-tauri/src/github/queries/ return them. Only src/data
// may import these: toRaw.ts maps them onto the Jira-shaped model everything else reads. Fields are
// optional because the JSON arrives unvalidated (the Rust side passes it through).

export type GhRepository = { nameWithOwner?: string };

export type GhUser = { login?: string; name?: string | null; avatarUrl?: string };

/** An issue or pull request as embedded in another one's links (the LinkedIssue / LinkedPull fragments). */
export type GhLinked = {
  __typename?: "Issue" | "PullRequest";
  number?: number;
  title?: string;
  /** Issues only (pull requests send `pullState`). */
  state?: "OPEN" | "CLOSED";
  /** Pull requests only: their `state`, aliased because GraphQL can't give IssueState and PullRequestState one name. */
  pullState?: "OPEN" | "CLOSED" | "MERGED";
  /** Issues only: why it was closed. */
  stateReason?: "COMPLETED" | "NOT_PLANNED" | "DUPLICATE" | "REOPENED" | null;
  /** Pull requests only. */
  isDraft?: boolean;
  merged?: boolean;
  repository?: GhRepository;
};

export type GhConnection<T> = { nodes?: (T | null)[]; pageInfo?: { hasNextPage?: boolean } };

export type GhTimelineItem =
  | { __typename: "CrossReferencedEvent"; willCloseTarget?: boolean; source?: GhLinked | null }
  | { __typename: "ConnectedEvent" | "DisconnectedEvent"; subject?: GhLinked | null };

export type GhMilestone = { id?: string; title?: string; dueOn?: string | null; state?: "OPEN" | "CLOSED" };

/** A full issue or pull request (the IssueTicket / PullTicket fragments). */
export type GhNode = GhLinked & {
  /** GraphQL node id. */
  id?: string;
  url?: string;
  createdAt?: string;
  closedAt?: string | null;
  /** The raw Markdown (where link URLs survive) and the rendered plain text (for display). */
  body?: string;
  bodyText?: string;
  author?: GhUser | null;
  assignees?: GhConnection<GhUser>;
  milestone?: GhMilestone | null;
  /** Issues only. */
  issueType?: { name?: string } | null;
  /** `parent.parent` is set only to say whether the parent is itself a sub-issue. */
  parent?: (GhLinked & { parent?: { id?: string } | null }) | null;
  subIssuesSummary?: { total?: number };
  blockedBy?: GhConnection<GhLinked>;
  blocking?: GhConnection<GhLinked>;
  /** Pull requests only: the issues merging it will close. */
  closingIssuesReferences?: GhConnection<GhLinked>;
  timelineItems?: GhConnection<GhTimelineItem>;
  /** Not GitHub's: on `issues` answers, the key it was asked for (a renamed or moved ticket answers under another). */
  requestedKey?: string;
};

export type GhViewer = { login?: string; name?: string | null; avatarUrl?: string };
