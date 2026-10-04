import pLimit, { type LimitFunction } from "p-limit";
import type { SiteConfig } from "../config/types";
import { DEFAULT_LINK_TYPES } from "../graph/linkTypes";
import { matchRemoteUrl } from "../graph/remoteUrl";
import { uidOf } from "../graph/types";
import { getOrThrow } from "../lib/guards";
import { errorMessage } from "./errors";
import { combineJql } from "./jqlPresets";
import type { JiraSource } from "./JiraSource";
import type { RawIssue, RawLinkType, RawPriority, RawRemoteLink, RawSiteData } from "./jiraTypes";

export type Scope =
  | { mode: "jql"; jql: string } // per-site: (site.baseJql) AND (jql)
  | { mode: "epic"; siteId: string; key: string }
  | { mode: "seed"; siteId: string; key: string; depth: number };

export type SiteError = { siteId: string; message: string };

export type LoadResult = { kind: "ok"; data: RawSiteData[]; errors: SiteError[] } | { kind: "overCap"; count: number; errors: SiteError[] };

export type LoaderOptions = { maxNodes?: number; perSiteConcurrency?: number; keyBatchSize?: number };

export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

class OverCap extends Error {
  constructor(readonly count: number) {
    super(`More than ${count} issues`);
  }
}

type SiteState = {
  site: SiteConfig;
  issues: Map<string, RawIssue>;
  remoteLinks: Record<string, RawRemoteLink[]>;
  linkTypes: RawLinkType[];
  priorities: RawPriority[];
};
type Ref = { siteId: string; key: string };

/**
 * Fans out to the selected sites in parallel (at most N concurrent requests per site),
 * collects per-site errors without failing the whole load, and enforces the node cap
 * (in-scope issues plus ghosts) as soon as it is exceeded.
 */
export class MultiSiteLoader {
  private readonly maxNodes: number;
  private readonly perSite: number;
  private readonly batch: number;

  constructor(
    private readonly source: JiraSource,
    opts: LoaderOptions = {},
  ) {
    this.maxNodes = opts.maxNodes ?? 300;
    this.perSite = opts.perSiteConcurrency ?? 4;
    this.batch = opts.keyBatchSize ?? 50;
  }

  async load(scope: Scope, selected: readonly SiteConfig[], allSites: readonly SiteConfig[]): Promise<LoadResult> {
    const run = new LoadRun(this.source, selected, allSites, this.maxNodes, this.perSite, this.batch);
    try {
      await run.execute(scope);
    } catch (e) {
      if (e instanceof OverCap) return { kind: "overCap", count: e.count, errors: run.errorList() };
      throw e;
    }
    return { kind: "ok", data: run.data(), errors: run.errorList() };
  }
}

class LoadRun {
  private readonly states = new Map<string, SiteState>();
  private readonly limits = new Map<string, LimitFunction>();
  private readonly errors = new Map<string, string>();
  private readonly linkTypesLoaded = new Map<string, Promise<void>>();
  private readonly prioritiesLoaded = new Map<string, Promise<void>>();

  constructor(
    private readonly source: JiraSource,
    selected: readonly SiteConfig[],
    private readonly allSites: readonly SiteConfig[],
    private readonly maxNodes: number,
    perSite: number,
    private readonly batch: number,
  ) {
    for (const site of selected) {
      this.states.set(site.id, { site, issues: new Map(), remoteLinks: {}, linkTypes: DEFAULT_LINK_TYPES, priorities: [] });
      this.limits.set(site.id, pLimit(perSite));
    }
  }

  async execute(scope: Scope): Promise<void> {
    if (scope.mode === "jql") return this.jql(scope.jql);
    if (!this.states.has(scope.siteId)) {
      this.fail(scope.siteId, "Site is not selected");
      return;
    }
    if (!ISSUE_KEY_RE.test(scope.key)) {
      this.fail(scope.siteId, `"${scope.key}" is not a valid issue key`);
      return;
    }
    if (scope.mode === "epic") return this.epic(scope.siteId, scope.key);
    return this.seed(scope.siteId, scope.key, Math.min(5, Math.max(1, Math.round(scope.depth))));
  }

  data(): RawSiteData[] {
    return [...this.states.values()]
      .filter((s) => s.issues.size > 0 || !this.errors.has(s.site.id))
      .map((s) => ({
        siteId: s.site.id,
        issues: [...s.issues.values()],
        remoteLinks: s.remoteLinks,
        linkTypes: s.linkTypes,
        priorities: s.priorities,
      }));
  }

  errorList(): SiteError[] {
    return [...this.errors].map(([siteId, message]) => ({ siteId, message }));
  }

  // ---- modes ---------------------------------------------------------------

  private async jql(jql: string): Promise<void> {
    await Promise.all(
      [...this.states.values()].map(async ({ site }) => {
        const q = combineJql(site.baseJql ?? "", jql);
        if (!q) {
          this.fail(site.id, 'Nothing to load: type a query above, or set this site\'s "Always filter by" JQL in Settings');
          return;
        }
        await this.guard(site.id, async () => {
          const issues = await this.call(site.id, () => this.source.fetchByJql(site.id, q, this.maxNodes + 1));
          this.checkCap(issues.length);
          await this.addFull(site.id, issues);
        });
      }),
    );
  }

  private async epic(siteId: string, key: string): Promise<void> {
    const ok = await this.guard(siteId, async () => {
      const filter = getOrThrow(this.states, siteId).site.baseJql?.trim() || undefined;
      const { children } = await this.call(siteId, () => this.source.fetchEpic(siteId, key, filter));
      await this.addFull(siteId, children);
    });
    if (!ok) return;
    // One hop: whatever the children link to (in selected sites) also becomes a full node.
    const children = [...getOrThrow(this.states, siteId).issues.values()].map((i) => ({ siteId, key: i.key }));
    await this.expand(children);
  }

  private async seed(siteId: string, key: string, depth: number): Promise<void> {
    const ok = await this.guard(siteId, async () => {
      const issue = await this.call(siteId, () => this.source.fetchIssue(siteId, key));
      await this.addFull(siteId, [issue]);
    });
    if (!ok) return;
    let frontier: Ref[] = [{ siteId, key }];
    for (let d = 1; d <= depth && frontier.length; d++) frontier = await this.expand(frontier);
  }

  /** Loads the not-yet-loaded neighbours of `refs` (restricted to selected sites) as full nodes. Returns them. */
  private async expand(refs: readonly Ref[]): Promise<Ref[]> {
    const wanted = new Map<string, Set<string>>();
    for (const ref of refs) {
      for (const n of this.neighbours(ref)) {
        const st = this.states.get(n.siteId);
        if (!st || st.issues.has(n.key) || this.errors.has(n.siteId)) continue;
        const keys = wanted.get(n.siteId) ?? new Set<string>();
        wanted.set(n.siteId, keys.add(n.key));
      }
    }
    const added: Ref[] = [];
    await Promise.all(
      [...wanted].map(([siteId, keys]) =>
        this.guard(siteId, async () => {
          const issues = await this.fetchKeys(siteId, [...keys]);
          await this.addFull(siteId, issues);
          added.push(...issues.map((i) => ({ siteId, key: i.key })));
        }),
      ),
    );
    return added;
  }

  // ---- helpers -------------------------------------------------------------

  private neighbours({ siteId, key }: Ref): Ref[] {
    const st = this.states.get(siteId);
    const issue = st?.issues.get(key);
    if (!st || !issue) return [];
    const out: Ref[] = [];
    for (const l of issue.fields.issuelinks ?? []) {
      const other = l.outwardIssue ?? l.inwardIssue;
      if (other) out.push({ siteId, key: other.key });
    }
    for (const rl of st.remoteLinks[key] ?? []) {
      const m = matchRemoteUrl(rl.object.url, this.allSites);
      if (m?.kind === "site") out.push({ siteId: m.siteId, key: m.key });
    }
    return out;
  }

  private async fetchKeys(siteId: string, keys: string[]): Promise<RawIssue[]> {
    const base = getOrThrow(this.states, siteId).site.baseJql ?? "";
    const safe = keys.filter((k) => ISSUE_KEY_RE.test(k));
    const chunks: string[][] = [];
    for (let i = 0; i < safe.length; i += this.batch) chunks.push(safe.slice(i, i + this.batch));
    const results = await Promise.all(
      // Linked issues the site filter excludes aren't fetched; they stay ghosts.
      chunks.map((c) => this.call(siteId, () => this.source.fetchByJql(siteId, combineJql(base, `key in (${c.join(",")})`), c.length))),
    );
    return results.flat();
  }

  private async addFull(siteId: string, issues: readonly RawIssue[]): Promise<void> {
    const st = getOrThrow(this.states, siteId);
    await Promise.all([this.ensureLinkTypes(siteId), this.ensurePriorities(siteId)]);
    const fresh = issues.filter((i) => !st.issues.has(i.key));
    for (const i of fresh) st.issues.set(i.key, i);
    this.checkCap();
    await Promise.all(
      fresh.map(async (i) => {
        st.remoteLinks[i.key] = await this.call(siteId, () => this.source.fetchRemoteLinks(siteId, i.key));
      }),
    );
    this.checkCap();
  }

  private ensureLinkTypes(siteId: string): Promise<void> {
    let p = this.linkTypesLoaded.get(siteId);
    if (!p) {
      p = this.call(siteId, () => this.source.fetchLinkTypes(siteId)).then(
        (types) => {
          if (types.length) getOrThrow(this.states, siteId).linkTypes = types;
        },
        () => undefined, // fall back to Jira's defaults
      );
      this.linkTypesLoaded.set(siteId, p);
    }
    return p;
  }

  private ensurePriorities(siteId: string): Promise<void> {
    let p = this.prioritiesLoaded.get(siteId);
    if (!p) {
      p = this.call(siteId, () => this.source.fetchPriorities(siteId)).then(
        (priorities) => {
          getOrThrow(this.states, siteId).priorities = priorities;
        },
        () => undefined, // without the site's order, priorities still show; the filter lists them by count
      );
      this.prioritiesLoaded.set(siteId, p);
    }
    return p;
  }

  /** Distinct in-scope issues plus every issue they reference (future ghosts). */
  private nodeCount(): number {
    const uids = new Set<string>();
    for (const st of this.states.values()) {
      for (const i of st.issues.values()) {
        uids.add(uidOf(st.site.id, i.key));
        for (const l of i.fields.issuelinks ?? []) {
          const other = l.outwardIssue ?? l.inwardIssue;
          if (other) uids.add(uidOf(st.site.id, other.key));
        }
        for (const rl of st.remoteLinks[i.key] ?? []) {
          const m = matchRemoteUrl(rl.object.url, this.allSites);
          if (m) uids.add(uidOf(m.kind === "site" ? m.siteId : m.host, m.key));
        }
      }
    }
    return uids.size;
  }

  private checkCap(extra = 0): void {
    const count = extra > this.maxNodes ? extra : this.nodeCount();
    if (count > this.maxNodes) throw new OverCap(count);
  }

  private call<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
    return getOrThrow(this.limits, siteId)(fn);
  }

  /** Runs `fn`; records a site error on failure. OverCap always propagates. Returns success. */
  private async guard(siteId: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof OverCap) throw e;
      this.fail(siteId, errorMessage(e));
      return false;
    }
  }

  private fail(siteId: string, message: string): void {
    if (!this.errors.has(siteId)) this.errors.set(siteId, message);
  }
}
