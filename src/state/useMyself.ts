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
  loading: boolean;
};

type Answer = { accountId: string } | { error: string };

/**
 * Who the signed-in user is on each selected site (`GET /myself`). Asked once per site and
 * data source (`backendKey`): identities don't change while the app runs, but a different
 * backend (mock vs live Jira) or account means a different answer.
 */
export function useMyself(source: JiraSource, sites: readonly SiteConfig[], backendKey: string): MyselfState {
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const keyOf = (siteId: string): string => `${backendKey}:${siteId}`;
  const missing = sites.filter((s) => !answers.has(keyOf(s.id))).map((s) => s.id);
  const missingKey = missing.join("|");

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const ids = missingKey.split("|");
    void Promise.all(
      ids.map(async (siteId): Promise<[string, Answer]> => {
        try {
          const user = await source.fetchMyself(siteId);
          return [siteId, user.accountId ? { accountId: user.accountId } : { error: "Jira didn't return an account id" }];
        } catch (e) {
          return [siteId, { error: errorMessage(e) }];
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setAnswers((cur) => new Map([...cur, ...results.map(([siteId, a]): [string, Answer] => [`${backendKey}:${siteId}`, a])]));
    });
    return (): void => {
      cancelled = true;
    };
  }, [source, backendKey, missingKey]);

  return useMemo(() => {
    const me = new Map<string, string>();
    const errors: { siteId: string; message: string }[] = [];
    for (const s of sites) {
      const a = answers.get(`${backendKey}:${s.id}`);
      if (!a) continue;
      if ("accountId" in a) me.set(s.id, a.accountId);
      else errors.push({ siteId: s.id, message: a.error });
    }
    return { me, errors, loading: missingKey !== "" };
  }, [answers, sites, backendKey, missingKey]);
}
