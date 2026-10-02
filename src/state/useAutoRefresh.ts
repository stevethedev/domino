import { useEffect } from "react";
import { nextRefreshDelay } from "./refresh";

/** The parts of `document` the scheduler needs (injectable for tests). */
export type VisibilitySource = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * Calls `refresh` once `intervalMs` has passed since the later of the last update and the last
 * attempt, while the page is visible. A hidden page doesn't poll; coming back after the interval
 * refreshes right away. A failed or skipped refresh still schedules the next one. Returns a stop function.
 */
export function startAutoRefresh(refresh: () => Promise<void>, intervalMs: number, lastUpdated: number, doc: VisibilitySource): () => void {
  let since = lastUpdated;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || doc.hidden) return;
    timer = setTimeout(
      () => {
        void run();
      },
      nextRefreshDelay(since, Date.now(), intervalMs),
    );
  };
  const run = async (): Promise<void> => {
    since = Date.now();
    await refresh().catch(() => undefined); // refresh reports its own errors; polling carries on regardless
    schedule();
  };
  schedule();
  doc.addEventListener("visibilitychange", schedule);
  return (): void => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", schedule);
  };
}

/** Polls with `startAutoRefresh` while `intervalMs` > 0 and something has loaded. */
export function useAutoRefresh(refresh: () => Promise<void>, intervalMs: number, lastUpdated: number | null): void {
  useEffect(() => {
    if (intervalMs <= 0 || lastUpdated === null) return;
    return startAutoRefresh(refresh, intervalMs, lastUpdated, document);
  }, [refresh, intervalMs, lastUpdated]);
}
