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
export type Answer = Readonly<{ state: Exclude<DescriptionState, { status: "loading" }>; epoch: number | null }>;

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

/** What to show for `key`, and whether to fetch it (no answer yet, or one from an earlier load). */
export function descriptionView(
  answers: ReadonlyMap<string, Answer>,
  key: string,
  epoch: number | null,
): { state: DescriptionState; due: boolean } {
  const answer = answers.get(key);
  return { state: answer?.state ?? { status: "loading" }, due: answer === undefined || answer.epoch !== epoch };
}

/** `answers` without `key`: a retry, which makes it due again. */
export function forget<V>(answers: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  const next = new Map(answers);
  next.delete(key);
  return next;
}

/**
 * Fetches one description and hands the outcome to `onAnswer`, unless the returned cancel was
 * called first (another issue opened, or a newer load): a stale result never lands.
 */
export function startFetch(
  source: Pick<JiraSource, "fetchDescription">,
  siteId: string,
  issueKey: string,
  onAnswer: (state: Answer["state"]) => void,
): () => void {
  let cancelled = false;
  void source
    .fetchDescription(siteId, issueKey)
    .then(
      (doc): Answer["state"] => ({ status: "loaded", doc }),
      (e: unknown): Answer["state"] => ({ status: "error", message: errorMessage(e) }),
    )
    .then((state) => {
      if (!cancelled) onAnswer(state);
    });
  return (): void => {
    cancelled = true;
  };
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
  const view = key ? descriptionView(answers, key, epoch) : null;
  const due = view?.due ?? false;

  useEffect(() => {
    if (!due || !key || siteId === undefined || issueKey === undefined) return;
    return startFetch(source, siteId, issueKey, (state) => {
      setAnswers((cur) => remember(cur, key, { state, epoch }));
    });
  }, [source, key, siteId, issueKey, due, epoch]);

  const retry = useCallback((): void => {
    if (key) setAnswers((cur) => forget(cur, key));
  }, [key]);

  return { state: view?.state ?? null, retry };
}
