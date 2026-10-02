import { useMemo } from "react";
import { NO_HISTORY, timelineFor, type ScheduleOptions, type StatusHistory, type TimelineEntry } from "../graph/schedule";
import type { Graph } from "../graph/types";
import { localToday } from "../ui/timeline/timelineLayout";
import type { EstimateSettings } from "./estimateSettings";
import type { HistoryState } from "./useStatusHistory";

export type Forecast = Readonly<{
  today: string;
  opts: ScheduleOptions;
  history: StatusHistory;
  /** Projected and actual/forecast spans for every issue (see computeTimeline). */
  timeline: ReadonlyMap<string, TimelineEntry>;
}>;

/** The schedule forecast for the loaded graph, shared (cached) between the timeline and the sidebar. */
export function useForecast(graph: Graph, history: HistoryState, settings: EstimateSettings): Forecast {
  const today = localToday();
  const statusHistory = history.status === "done" ? history.history : NO_HISTORY;
  const opts = useMemo<ScheduleOptions>(
    () => ({ planStart: settings.planStart ?? today, today, daysPerPoint: settings.daysPerPoint, defaultDays: settings.defaultDays }),
    [settings, today],
  );
  const timeline = timelineFor(graph, statusHistory, opts);
  return { today, opts, history: statusHistory, timeline };
}
