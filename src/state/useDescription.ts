import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../data/errors";
import type { JiraSource } from "../data/JiraSource";
import type { GraphNode } from "../graph/types";

export type DescriptionState =
  | Readonly<{ status: "loading" }>
  /** `doc` is Jira's Atlassian Document Format, unvalidated (null when there's no description). */
  | Readonly<{ status: "loaded"; doc: unknown }>
  | Readonly<{ status: "error"; message: string }>;

/** `epoch` is the load the answer was fetched after; answers from an older load are fetched again. */
type Answer = Readonly<{ state: Exclude<DescriptionState, { status: "loading" }>; epoch: number | null }>;

/**
 * The open issue's description, fetched when the details panel opens (searches don't include it,
 * which keeps loads and the ticket cache small) and kept for the session. It's fetched again after
 * each finished load or refresh (`epoch`), showing the earlier answer meanwhile. Answers are keyed
 * per data source (`backendKey`) as well as issue. `retry` fetches a failed one again.
 */
export function useDescription(
  source: JiraSource,
  node: GraphNode | null,
  backendKey: string,
  epoch: number | null,
): { state: DescriptionState | null; retry: () => void } {
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [attempt, setAttempt] = useState(0);
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
        setAnswers((cur) => new Map(cur).set(key, { state, epoch }));
      });
    return (): void => {
      cancelled = true;
    };
  }, [source, key, siteId, issueKey, due, epoch, attempt]); // `attempt`: retry re-runs it

  const retry = useCallback((): void => {
    if (!key) return;
    setAnswers((cur) => {
      const next = new Map(cur);
      next.delete(key);
      return next;
    });
    setAttempt((n) => n + 1);
  }, [key]);

  if (!node) return { state: null, retry };
  return { state: answer?.state ?? { status: "loading" }, retry };
}
