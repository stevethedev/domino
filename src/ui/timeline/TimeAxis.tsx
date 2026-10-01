import { memo } from "react";
import type { Day } from "../../graph/schedule";
import { PX_PER_DAY, ticks, xOf, type Scale } from "./timelineLayout";

/** Date header: ticks for the scale plus a "Today" flag. */
export const TimeAxis = memo(function TimeAxis({ range, scale, today }: { range: { start: Day; end: Day }; scale: Scale; today: Day }) {
  return (
    <div className="tl-axis-ticks" aria-hidden="true">
      {ticks(range, scale).map((t) => (
        <span key={t.day} className={`tl-tick${t.major ? " major" : ""}`} style={{ left: xOf(range.start, t.day, scale) }}>
          {t.label}
        </span>
      ))}
      <span className="tl-today-flag" style={{ left: xOf(range.start, today, scale) + PX_PER_DAY[scale] / 2 }}>
        Today
      </span>
    </div>
  );
});

/** Weekend shading and the today line, behind the rows. */
export const TimeGrid = memo(function TimeGrid({
  range,
  scale,
  today,
  height,
}: {
  range: { start: Day; end: Day };
  scale: Scale;
  today: Day;
  height: number;
}) {
  const px = PX_PER_DAY[scale];
  const weekends: Day[] = [];
  if (scale !== "month") {
    for (let d = range.start; d <= range.end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) weekends.push(d);
    }
  }
  return (
    <div className="tl-grid" style={{ height }} aria-hidden="true">
      {weekends.map((d) => (
        <div key={d} className="tl-weekend" style={{ left: xOf(range.start, d, scale), width: px }} />
      ))}
      <div className="tl-today" style={{ left: xOf(range.start, today, scale) + px / 2 }} />
    </div>
  );
});
