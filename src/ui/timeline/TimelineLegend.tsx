import type { ReactElement } from "react";

/**
 * Everything the timeline draws, for the sidebar's Legend while the timeline is shown: the bars in
 * each of their colours, markers, releases, epics, and every kind of arrow (each with a cue
 * besides colour).
 */
export function TimelineLegend(): ReactElement {
  return (
    <ul className="legend-list tl-legend-full">
      <li>
        <span className="tl-key tl-projected" aria-hidden="true" /> Estimate: story points × Days / point
      </li>
      <li>
        <span className="tl-key key-done" aria-hidden="true" /> Done
      </li>
      <li>
        <span className="tl-key key-inprogress" aria-hidden="true" /> Worked on so far
      </li>
      <li>
        <span className="tl-key tl-forecast" aria-hidden="true" /> Forecast, once started
      </li>
      <li>
        <span className="tl-key tl-forecast key-todo" aria-hidden="true" /> Forecast, not started
      </li>
      <li>
        <span className="tl-key key-epic" aria-hidden="true" /> Epic: when its tickets happen
      </li>
      <li>
        <span className="key-glyph" aria-hidden="true">
          ◆
        </span>{" "}
        Due date
      </li>
      <li>
        <span className="key-glyph past" aria-hidden="true">
          ◆
        </span>{" "}
        Due date the forecast misses
      </li>
      <li>
        <span className="key-release" aria-hidden="true" /> Release (flag red: forecast to miss it; gray: released)
      </li>
      <li>
        <span className="key-weekend" aria-hidden="true" /> Weekend
      </li>
      <li>
        <span className="legend" aria-hidden="true" /> Blocks
      </li>
      <li>
        <span className="legend legend-dashed" aria-hidden="true" /> Blocks, across sites ⇄
      </li>
      <li>
        <span className="legend legend-critical" aria-hidden="true" /> Critical path
      </li>
      <li>
        <span className="legend legend-cycle" aria-hidden="true" /> Blocking cycle
      </li>
      <li>
        <span className="legend legend-early-start" aria-hidden="true" /> Started before its blocker finished
      </li>
      <li>
        <span className="legend legend-stub" aria-hidden="true" /> To or from a ticket outside the scope
      </li>
    </ul>
  );
}
