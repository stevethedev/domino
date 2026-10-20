import type { ConfigStore } from "../config/ConfigStore";
import { siteKindOf, type ConfigFileStatus, type DominoConfig, type HealthStatus, type OAuthStatus, type SiteKind } from "../config/types";
import type { JiraSource } from "./JiraSource";
import type { RawIssue, RawIssueChangeLog, RawLinkType, RawPriority, RawRemoteLink, RawStatusDef, RawUser } from "./jiraTypes";

/**
 * Each configured site's kind, kept current by watching the configs a ConfigStore hands out.
 * `onChange` hears of every config it sees and every secret set through the store.
 */
export class SiteKinds {
  private kinds = new Map<string, SiteKind>();

  constructor(private readonly onChange: () => void = (): void => undefined) {}

  readonly kindOf = (siteId: string): SiteKind => this.kinds.get(siteId) ?? "jira";

  update(config: DominoConfig): DominoConfig {
    this.kinds = new Map(config.sites.map((s) => [s.id, siteKindOf(s)]));
    this.onChange();
    return config;
  }

  /** `store`, noting the kinds of every config it loads or saves. */
  track(store: ConfigStore): ConfigStore {
    return new TrackedConfigStore(store, (c) => this.update(c), this.onChange);
  }
}

class TrackedConfigStore implements ConfigStore {
  constructor(
    private readonly store: ConfigStore,
    private readonly seen: (config: DominoConfig) => DominoConfig,
    private readonly secretSet: () => void,
  ) {}

  async load(): Promise<DominoConfig> {
    return this.seen(await this.store.load());
  }
  async save(config: DominoConfig): Promise<DominoConfig> {
    return this.seen(await this.store.save(config));
  }
  async reloadFile(): Promise<DominoConfig> {
    return this.seen(await this.store.reloadFile());
  }
  async startFresh(): Promise<{ config: DominoConfig; setAside: string | null }> {
    const res = await this.store.startFresh();
    this.seen(res.config);
    return res;
  }
  fileStatus(): Promise<ConfigFileStatus> {
    return this.store.fileStatus();
  }
  revealFile(): Promise<void> {
    return this.store.revealFile();
  }
  health(siteId: string): Promise<HealthStatus> {
    return this.store.health(siteId);
  }
  async setSecret(secretRef: string, value: string): Promise<void> {
    await this.store.setSecret(secretRef, value);
    this.secretSet();
  }
  secretStatus(secretRef: string): Promise<boolean> {
    return this.store.secretStatus(secretRef);
  }
  oauthStatus(): Promise<OAuthStatus> {
    return this.store.oauthStatus();
  }
  oauthConnect(): Promise<string[]> {
    return this.store.oauthConnect();
  }
  oauthCancel(): Promise<void> {
    return this.store.oauthCancel();
  }
  oauthDisconnect(): Promise<void> {
    return this.store.oauthDisconnect();
  }
}

/** Sends each call to the Jira or GitHub source, by the kind of site it's for. */
export class RoutingSource implements JiraSource {
  constructor(
    private readonly jira: JiraSource,
    private readonly github: JiraSource,
    private readonly kindOf: (siteId: string) => SiteKind,
  ) {}

  private for(siteId: string): JiraSource {
    return this.kindOf(siteId) === "github" ? this.github : this.jira;
  }

  fetchByJql(siteId: string, jql: string, maxResults?: number): Promise<RawIssue[]> {
    return this.for(siteId).fetchByJql(siteId, jql, maxResults);
  }
  fetchByKeys(siteId: string, keys: readonly string[], filter?: string): Promise<RawIssue[]> {
    return this.for(siteId).fetchByKeys(siteId, keys, filter);
  }
  fetchEpic(siteId: string, key: string, filter?: string): Promise<{ epic: RawIssue; children: RawIssue[] }> {
    return this.for(siteId).fetchEpic(siteId, key, filter);
  }
  fetchIssue(siteId: string, key: string): Promise<RawIssue> {
    return this.for(siteId).fetchIssue(siteId, key);
  }
  fetchDescription(siteId: string, key: string): Promise<unknown> {
    return this.for(siteId).fetchDescription(siteId, key);
  }
  fetchRemoteLinks(siteId: string, key: string): Promise<RawRemoteLink[]> {
    return this.for(siteId).fetchRemoteLinks(siteId, key);
  }
  fetchLinkTypes(siteId: string): Promise<RawLinkType[]> {
    return this.for(siteId).fetchLinkTypes(siteId);
  }
  fetchPriorities(siteId: string): Promise<RawPriority[]> {
    return this.for(siteId).fetchPriorities(siteId);
  }
  fetchStatusHistory(siteId: string, issueIds: readonly string[]): Promise<RawIssueChangeLog[]> {
    return this.for(siteId).fetchStatusHistory(siteId, issueIds);
  }
  fetchStatuses(siteId: string): Promise<RawStatusDef[]> {
    return this.for(siteId).fetchStatuses(siteId);
  }
  fetchMyself(siteId: string): Promise<RawUser> {
    return this.for(siteId).fetchMyself(siteId);
  }
}
