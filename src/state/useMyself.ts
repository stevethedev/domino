import { useEffect, useMemo, useState } from "react";
import type { SiteConfig } from "../config/types";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import type { Me } from "../graph/mine";

export type MyselfState = {
  /** Account id per site id, for sites that answered. */
  me: Me;
  /** Sites that couldn't say who the user is (failed, or returned no account id). */
  errors: readonly { siteId: string; message: string }[];
  /** Some selected site hasn't answered yet (not even with an error). */
  loading: boolean;
};

/** `epoch` is the load the answer was asked for; answers from an older load are asked again. */
type Answer = ({ accountId: string } | { error: string }) & { epoch: number };

/**
 * Who the signed-in user is on each selected site (`GET /myself`), asked again after every
 * finished load or refresh (`epoch`, null until the first): fixing a token, connecting OAuth or
 * switching a site to another account then shows up without a restart. The previous answer stays
 * on screen while re-asking. Answers are keyed per data source (`backendKey`) as well as site.
 */
export function useMyself(source: JiraSource, sites: readonly SiteConfig[], backendKey: string, epoch: number | null): MyselfState {
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const keyOf = (siteId: string): string => `${backendKey}:${siteId}`;
  const dueKey = epoch === null ? "" : sites.filter((s) => answers.get(keyOf(s.id))?.epoch !== epoch).map((s) => s.id).join("|");
  const unanswered = sites.some((s) => !answers.has(keyOf(s.id)));

  useEffect(() => {
    if (!dueKey || epoch === null) return;
    let cancelled = false;
    void Promise.all(
      dueKey.split("|").map(async (siteId): Promise<[string, Answer]> => {
        try {
          const user = await source.fetchMyself(siteId);
          return [siteId, user.accountId ? { accountId: user.accountId, epoch } : { error: "Jira didn't return an account id", epoch }];
        } catch (e) {
          return [siteId, { error: errorMessage(e), epoch }];
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setAnswers((cur) => new Map([...cur, ...results.map(([siteId, a]): [string, Answer] => [`${backendKey}:${siteId}`, a])]));
    });
    return (): void => {
      cancelled = true;
    };
  }, [source, backendKey, dueKey, epoch]);

  return useMemo(() => {
    const me = new Map<string, string>();
    const errors: { siteId: string; message: string }[] = [];
    for (const s of sites) {
      const a = answers.get(`${backendKey}:${s.id}`);
      if (!a) continue;
      if ("accountId" in a) me.set(s.id, a.accountId);
      else errors.push({ siteId: s.id, message: a.error });
    }
    return { me, errors, loading: unanswered };
  }, [answers, sites, backendKey, unanswered]);
}
