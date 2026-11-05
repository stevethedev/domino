import { prefersReducedMotion } from "../../lib/motion";
import { laneStop } from "./timelineLayout";

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");

/**
 * Focus a timeline row by uid (the graph view uses React Flow's viewport instead), centring it, or
 * with `nearest` (following links) scrolling only as far as needed. Returns whether it was found.
 */
export function focusTimelineRow(uid: string, moveFocus = true, nearest = false): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tl-uid="${CSS.escape(uid)}"]`);
  // Scroll its work bar into view, across as well as down (the row spans the whole chart, so
  // scrolling to the row alone never moved sideways); the chart's scroll-padding keeps it clear of
  // the sticky labels. A ghost has no bar: scroll to the row.
  const bar =
    [".tl-actual", ".tl-forecast", ".tl-epic-work", ".tl-projected"].map((s) => el?.querySelector<HTMLElement>(s)).find(Boolean) ?? el;
  bar?.scrollIntoView({ block: nearest ? "nearest" : "center", inline: "nearest", behavior: scrollBehavior() });
  if (moveFocus) el?.focus({ preventScroll: true });
  return el !== null;
}

/**
 * How far to scroll the timeline down (negative: up) to show an item between the sticky axis
 * (`padTop` below the view's top) and the view's bottom: only as far as needed.
 */
export const verticalScroll = (
  r: Readonly<{ top: number; bottom: number; viewTop: number; viewBottom: number; padTop: number }>,
): number => (r.top < r.viewTop + r.padTop ? r.top - (r.viewTop + r.padTop) : r.bottom > r.viewBottom ? r.bottom - r.viewBottom : 0);

/**
 * Focus an item of the timeline's Tab stop (see `navOrder`): a row, its bar scrolled into view
 * only as far as needed, or a lane header. Returns whether it was found.
 */
export function focusTimelineItem(id: string): boolean {
  const prefix = laneStop("");
  if (!id.startsWith(prefix)) return focusTimelineRow(id, true, true);
  const lane = document.querySelector<HTMLElement>(`[data-tl-lane="${CSS.escape(id.slice(prefix.length))}"]`);
  if (!lane) return false;
  // Up or down only: the header sits in the sticky label column, so scrolling it into view
  // would also pan the dates sideways.
  const view = lane.closest<HTMLElement>(".tl-scroll");
  const row = lane.closest<HTMLElement>(".tl-lane") ?? lane;
  if (view) {
    const [r, v] = [row.getBoundingClientRect(), view.getBoundingClientRect()];
    const padTop = parseFloat(getComputedStyle(view).scrollPaddingTop) || 0;
    const top = verticalScroll({ top: r.top, bottom: r.bottom, viewTop: v.top, viewBottom: v.bottom, padTop });
    if (top !== 0) view.scrollBy({ top, behavior: scrollBehavior() });
  }
  lane.focus({ preventScroll: true });
  return true;
}
