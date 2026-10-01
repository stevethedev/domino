import pLimit from "p-limit";
import { toStatusHistory } from "../graph/history";
import type { StatusChange } from "../graph/schedule";
import type { Graph } from "../graph/types";
import { errorMessage } from "./errors";
import type { JiraSource } from "./JiraSource";
import type { SiteError } from "./MultiSiteLoader";

export type HistoryResult = { history: Map<string, StatusChange[]>; errors: SiteError[] };

const BATCH = 1000;

/** Fetches status changelogs for every loaded (non-ghost) issue, per site in parallel; errors stay per site. */
export async function loadStatusHistory(source: JiraSource, graph: Graph): Promise<HistoryResult> {
  const bySite = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.ghost || !n.jiraId) continue;
    bySite.set(n.siteId, [...(bySite.get(n.siteId) ?? []), n.jiraId]);
  }
  const history = new Map<string, StatusChange[]>();
  const errors: SiteError[] = [];
  await Promise.all(
    [...bySite].map(async ([siteId, ids]) => {
      const limit = pLimit(2);
      try {
        const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
        const [statuses, ...pages] = await Promise.all([
          limit(() => source.fetchStatuses(siteId)),
          ...batches.map((b) => limit(() => source.fetchStatusHistory(siteId, b))),
        ]);
        for (const [uid, changes] of toStatusHistory(pages.flat(), statuses, graph.nodes, siteId)) history.set(uid, changes);
      } catch (e) {
        errors.push({ siteId, message: `Status history unavailable: ${errorMessage(e)}` });
      }
    }),
  );
  return { history, errors };
}
