import { prefersReducedMotion } from "../../lib/motion";
import { laneStop } from "./timelineLayout";

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");

type Span = Readonly<{ start: number; end: number }>;

/**
 * How far to scroll (negative: back) to show `start`..`end` within `viewStart`..`viewEnd`, clear of
 * the `padStart` covered by something sticky at the start (the axis, the label column): only as
 * far as needed.
 */
export const scrollIntoRange = (r: Span & Readonly<{ viewStart: number; viewEnd: number; padStart: number }>): number =>
  r.start < r.viewStart + r.padStart ? r.start - (r.viewStart + r.padStart) : r.end > r.viewEnd ? r.end - r.viewEnd : 0;

/** The timeline's visible area on screen, and what its sticky axis and label column cover. */
type ViewBox = Readonly<{ top: number; bottom: number; padTop: number; left: number; right: number; padLeft: number }>;

/**
 * How far to scroll the timeline to show an item: the whole of it up and down (a row's key and
 * title sit above its bar), and its work bar across (a lane header has none, so it never pans).
 */
export const scrollToShow = (
  item: Readonly<{ top: number; bottom: number }>,
  bar: Readonly<{ left: number; right: number }> | undefined,
  v: ViewBox,
): { top: number; left: number } => ({
  top: scrollIntoRange({ start: item.top, end: item.bottom, viewStart: v.top, viewEnd: v.bottom, padStart: v.padTop }),
  left: bar ? scrollIntoRange({ start: bar.left, end: bar.right, viewStart: v.left, viewEnd: v.right, padStart: v.padLeft }) : 0,
});

/** The view's client area (inside its border, short of its scrollbars) and its scroll padding. */
function viewBox(view: HTMLElement): ViewBox {
  const r = view.getBoundingClientRect();
  const style = getComputedStyle(view);
  const top = r.top + view.clientTop;
  const left = r.left + view.clientLeft;
  return {
    top,
    bottom: top + view.clientHeight,
    padTop: parseFloat(style.scrollPaddingTop) || 0,
    left,
    right: left + view.clientWidth,
    padLeft: parseFloat(style.scrollPaddingLeft) || 0,
  };
}

/** A row's work bar, which says where it is in time; a ghost has none. */
const workBar = (row: HTMLElement): HTMLElement | undefined =>
  [".tl-actual", ".tl-forecast", ".tl-epic-work", ".tl-projected"].map((s) => row.querySelector<HTMLElement>(s) ?? undefined).find(Boolean);

/**
 * Scrolls the timeline just enough to show `el` (a row, or a lane header's `.tl-lane`). With `y`,
 * its layout position in the timeline body, up and down is measured from where it will end up,
 * not where it is: rows and headers slide to new places while a lane folds or unfolds.
 */
function scrollNearest(el: HTMLElement, y?: number): void {
  const view = el.closest<HTMLElement>(".tl-scroll");
  if (!view) return;
  const box = el.getBoundingClientRect();
  const body = view.querySelector<HTMLElement>(".tl-body");
  const top = y !== undefined && body ? body.getBoundingClientRect().top + y : box.top;
  const bar = el.matches("[data-tl-uid]") ? workBar(el)?.getBoundingClientRect() : undefined;
  const by = scrollToShow({ top, bottom: top + box.height }, bar, viewBox(view));
  if (by.top !== 0 || by.left !== 0) view.scrollBy({ ...by, behavior: scrollBehavior() });
}

/**
 * Focus a timeline row by uid (the graph view uses React Flow's viewport instead), its work bar
 * centred, or with `nearest` (following links) scrolling only as far as needed. Returns whether it
 * was found.
 */
export function focusTimelineRow(uid: string, moveFocus = true, nearest = false): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tl-uid="${CSS.escape(uid)}"]`);
  if (!el) return false;
  if (nearest) scrollNearest(el);
  // Across as well as down (the row spans the whole chart, so scrolling to the row alone never
  // moved sideways); the chart's scroll padding keeps it clear of the sticky axis and labels.
  else (workBar(el) ?? el).scrollIntoView({ block: "center", inline: "nearest", behavior: scrollBehavior() });
  if (moveFocus) el.focus({ preventScroll: true });
  return true;
}

/**
 * Focus an item of the timeline's Tab stop (see `navOrder`), a row or a lane header, scrolling
 * only as far as needed. `y` is its layout position (see `scrollNearest`). Returns whether it was
 * found.
 */
export function focusTimelineItem(id: string, y?: number): boolean {
  const prefix = laneStop("");
  const isLane = id.startsWith(prefix);
  const el = document.querySelector<HTMLElement>(
    isLane ? `[data-tl-lane="${CSS.escape(id.slice(prefix.length))}"]` : `[data-tl-uid="${CSS.escape(id)}"]`,
  );
  if (!el) return false;
  // A header's whole line, not just its toggle (which sits in the sticky label column).
  const line = isLane ? (el.closest<HTMLElement>(".tl-lane") ?? el) : el;
  scrollNearest(line, y);
  el.focus({ preventScroll: true });
  return true;
}
