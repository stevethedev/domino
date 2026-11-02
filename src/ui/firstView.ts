import { getViewportForBounds, type Rect, type Viewport } from "@xyflow/react";
import type { GraphEdge } from "../graph/types";

/** Below this zoom, card summaries (13px) render under the app's smallest text size (11px): first load never goes lower. */
export const MIN_READABLE_ZOOM = 0.85;
/** Margin around fitted cards, as React Flow's `fitView` padding (a fraction of the pane). */
export const FIT_PADDING = 0.2;

type Size = Readonly<{ width: number; height: number }>;

/**
 * How a scope first appears: all of it when it fits at a readable zoom; otherwise a part worth
 * reading first, with a notice saying it's a part.
 */
export type FirstView =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "subset"; uids: readonly string[]; notice: string }>
  | Readonly<{ kind: "corner"; viewport: Viewport; notice: string }>;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Picks what to fit when the graph is first shown. Too big to read whole, it shows, in order:
 * your drawn tickets and what directly blocks them; else the drawn ticket that unblocks the most
 * and what it directly unblocks; else the graph's top-left corner.
 */
export function firstView({
  bounds,
  pane,
  drawn,
  edges,
  mine,
  unblockers,
  keyOf,
}: {
  /** Every drawn card, in flow coordinates. */
  bounds: Rect;
  pane: Size;
  /** Uids of the cards on the canvas. */
  drawn: ReadonlySet<string>;
  edges: readonly GraphEdge[];
  /** Tickets assigned to the signed-in user. */
  mine: ReadonlySet<string>;
  /** Tickets ranked by how much open work they unblock, most first. */
  unblockers: readonly Readonly<{ uid: string }>[];
  keyOf: (uid: string) => string;
}): FirstView {
  if (pane.width <= 0 || pane.height <= 0) return { kind: "all" };
  const natural = getViewportForBounds(bounds, pane.width, pane.height, 0, 1, FIT_PADDING).zoom;
  if (natural >= MIN_READABLE_ZOOM) return { kind: "all" };

  const blocking = edges.filter((e) => e.kind === "blocks" && e.source !== e.target && drawn.has(e.source) && drawn.has(e.target));
  const yours = [...mine].filter((uid) => drawn.has(uid));
  if (yours.length > 0) {
    const blockers = new Set(blocking.filter((e) => mine.has(e.target)).map((e) => e.source));
    const uids = [...new Set([...yours, ...blockers])];
    const tickets = yours.length === 1 ? "your ticket" : `your ${yours.length} tickets`;
    return { kind: "subset", uids, notice: `Showing ${tickets}${uids.length > yours.length ? " and their blockers" : ""}` };
  }

  const top = unblockers.find((u) => drawn.has(u.uid));
  if (top) {
    const unblocked = [...new Set(blocking.filter((e) => e.source === top.uid).map((e) => e.target))];
    return {
      kind: "subset",
      uids: [top.uid, ...unblocked],
      notice: `Showing ${keyOf(top.uid)}, which unblocks the most, and the ${plural(unblocked.length, "ticket")} it unblocks`,
    };
  }

  // The margin `fitView` leaves (see its numeric padding), from the graph's top-left corner.
  const inset = (side: number): number => (side - side / (1 + FIT_PADDING)) / 2;
  return {
    kind: "corner",
    viewport: {
      x: inset(pane.width) - bounds.x * MIN_READABLE_ZOOM,
      y: inset(pane.height) - bounds.y * MIN_READABLE_ZOOM,
      zoom: MIN_READABLE_ZOOM,
    },
    notice: "Showing the start of the graph",
  };
}
