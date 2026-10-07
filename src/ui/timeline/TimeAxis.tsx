import { memo } from "react";
import type { Day } from "../../graph/schedule";
import { fmtDay } from "../format";
import { PX_PER_DAY, ticks, xOf, type Scale } from "./timelineLayout";

/**
 * A release drawn on the timeline: a line at the end of its release day and a flag in the header,
 * on header line `line` (0 = first) so nearby flags don't overlap.
 */
export type ReleaseMarker = Readonly<{
  uid: string;
  label: string;
  date: Day;
  released: boolean;
  atRisk: number;
  title: string;
  line: number;
}>;

/** Where a release's line sits: the end of its release day (work finishing that day makes it). */
export const releaseX = (start: Day, date: Day, scale: Scale): number => xOf(start, date, scale) + PX_PER_DAY[scale];

/** Flag width estimate for stacking: bold 10px text plus padding, capped like `.tl-release-flag`. */
const FLAG_CHAR_PX = 6.2;
const FLAG_PADDING_PX = 14;
const FLAG_MAX_PX = 220;
export const flagWidth = (label: string): number => Math.min(FLAG_MAX_PX, label.length * FLAG_CHAR_PX + FLAG_PADDING_PX);

const releaseClass = (r: ReleaseMarker): string => `${r.released ? " released" : ""}${r.atRisk > 0 ? " at-risk" : ""}`;

/** Date header: ticks for the scale, a "Today" flag, and a flag per release. */
export const TimeAxis = memo(function TimeAxis({
  range,
  scale,
  today,
  releases,
}: {
  range: { start: Day; end: Day };
  scale: Scale;
  today: Day;
  releases: readonly ReleaseMarker[];
}) {
  return (
    <div className="tl-axis-ticks" aria-hidden="true">
      {releases.map((r) => (
        <span
          key={r.uid}
          className={`tl-release-flag${releaseClass(r)}`}
          style={{ left: releaseX(range.start, r.date, scale), "--line": r.line }}
          title={r.title}
        >
          {r.label}
        </span>
      ))}
      {ticks(range, scale).map((t) => (
        <span key={t.day} className={`tl-tick${t.major ? " major" : ""}`} style={{ left: xOf(range.start, t.day, scale) }}>
          {t.label}
        </span>
      ))}
      <span
        className="tl-today-flag"
        style={{ left: xOf(range.start, today, scale) + PX_PER_DAY[scale] / 2 }}
        title={`Today, ${fmtDay(today, true)}`}
      >
        Today
      </span>
    </div>
  );
});

/** Weekend shading, release lines and the today line, behind the rows. */
export const TimeGrid = memo(function TimeGrid({
  range,
  scale,
  today,
  height,
  releases,
}: {
  range: { start: Day; end: Day };
  scale: Scale;
  today: Day;
  height: number;
  releases: readonly ReleaseMarker[];
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
      {releases.map((r) => (
        <div key={r.uid} className={`tl-release${releaseClass(r)}`} style={{ left: releaseX(range.start, r.date, scale) }} />
      ))}
      <div className="tl-today" style={{ left: xOf(range.start, today, scale) + px / 2 }} />
    </div>
  );
});
