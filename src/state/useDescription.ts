import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import type { GraphNode } from "../graph/types";

export type DescriptionState =
  | Readonly<{ status: "loading" }>
  /** `doc` is Jira's Atlassian Document Format, unvalidated (null when there's no description). */
  | Readonly<{ status: "loaded"; doc: unknown }>
  | Readonly<{ status: "error"; message: string }>;

/** Descriptions kept for the session; past this, the least recently fetched are dropped. */
const MAX_KEPT = 100;

/** `epoch` is the load the answer was fetched after; answers from an older load are fetched again. */
type Answer = Readonly<{ state: Exclude<DescriptionState, { status: "loading" }>; epoch: number | null }>;

/** `answers` with `key` set as the newest entry, dropping the oldest past `MAX_KEPT` (a Map keeps insertion order). */
export function remember<V>(answers: ReadonlyMap<string, V>, key: string, value: V, max = MAX_KEPT): ReadonlyMap<string, V> {
  const next = new Map(answers);
  next.delete(key);
  next.set(key, value);
  for (const oldest of next.keys()) {
    if (next.size <= max) break;
    next.delete(oldest);
  }
  return next;
}

/**
 * The open issue's description, fetched when the details panel opens (searches don't include it,
 * which keeps loads and the ticket cache small) and kept for the session. It's fetched again after
 * each finished load or refresh (`epoch`), showing the earlier answer meanwhile. Answers are keyed
 * per data source (`backendKey`) as well as issue. `retry` drops a failed answer, so it's fetched again.
 */
export function useDescription(
  source: JiraSource,
  node: GraphNode | null,
  backendKey: string,
  epoch: number | null,
): { state: DescriptionState | null; retry: () => void } {
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const key = node ? `${backendKey}:${node.uid}` : null;
  const siteId = node?.siteId;
  const issueKey = node?.key;
  const answer = key ? answers.get(key) : undefined;
  const due = node !== null && (answer === undefined || answer.epoch !== epoch);

  useEffect(() => {
    if (!due || !key || siteId === undefined || issueKey === undefined) return;
    let cancelled = false;
    void source
      .fetchDescription(siteId, issueKey)
      .then(
        (doc): Answer["state"] => ({ status: "loaded", doc }),
        (e: unknown): Answer["state"] => ({ status: "error", message: errorMessage(e) }),
      )
      .then((state) => {
        if (cancelled) return;
        setAnswers((cur) => remember(cur, key, { state, epoch }));
      });
    return (): void => {
      cancelled = true;
    };
  }, [source, key, siteId, issueKey, due, epoch]);

  const retry = useCallback((): void => {
    if (!key) return;
    setAnswers((cur) => {
      const next = new Map(cur);
      next.delete(key); // which makes it due again
      return next;
    });
  }, [key]);

  if (!node) return { state: null, retry };
  return { state: answer?.state ?? { status: "loading" }, retry };
}
