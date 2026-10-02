import type { Day } from "../graph/schedule";

/** "Oct 3" (or "Oct 3, 2026" with `withYear`) for a calendar day, read as the day it names, not shifted by time zone. */
export const fmtDay = (d: Day, withYear = false): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
