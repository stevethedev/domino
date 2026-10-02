import type { GraphEdge } from "./types";

/** Upstream: the issues blocking this one. Downstream: the issues it blocks. */
export type Direction = "upstream" | "downstream";

/** A key press on a card or row: follow a link, or switch to another issue at the same step. */
export type Move = Direction | "previous" | "next";

/** Arrow keys on a card or row: ←/→ follow blocking links (the graph reads left to right), ↑/↓ move up and down. */
export const MOVE_KEYS: Readonly<Partial<Record<string, Move>>> = {
  ArrowLeft: "upstream",
  ArrowRight: "downstream",
  ArrowUp: "previous",
  ArrowDown: "next",
};

/**
 * The last step taken: from `from`, in `direction`, to `at`. `options` are every issue that step
 * could have reached (top to bottom), so ↑/↓ can move between them and the opposite arrow can
 * return to `from`. It only applies while focus is still on `at`.
 */
export type Trail = Readonly<{ at: string; from: string; direction: Direction; options: readonly string[] }>;

/** The issues `uid` is linked to by blocking links in `direction`, each once, in link order. */
export function linkedIssues(uid: string, edges: readonly GraphEdge[], direction: Direction): string[] {
  const linked = edges.flatMap((e) => {
    if (e.kind !== "blocks" || e.source === e.target) return [];
    if (direction === "upstream") return e.target === uid ? [e.source] : [];
    return e.source === uid ? [e.target] : [];
  });
  return [...new Set(linked)];
}

const opposite = (d: Direction): Direction => (d === "upstream" ? "downstream" : "upstream");

/** Up or down the screen. */
export type Vertical = "previous" | "next";

/** What `step` needs to know about the picture on screen. */
export type TraverseLayout = Readonly<{
  /** The issues `uid` links to in `direction`, top to bottom on screen. */
  linked: (uid: string, direction: Direction) => readonly string[];
  /** Of `options`, the one closest to `from` vertically (the link straight ahead). */
  closest: (from: string, options: readonly string[]) => string | undefined;
  /** The nearest issue above (`previous`) or below (`next`) `uid` in the same column, if any. */
  beside: (uid: string, direction: Vertical) => string | undefined;
}>;

export type Step = Readonly<{ target: string; trail: Trail | null }>;

/**
 * Where a key press on `current` goes, and the trail it leaves, or null when there's nowhere to go.
 * ←/→ go to the linked issue straight ahead, or back to where you came from when that's one of
 * them (so ← then → returns you). ↑/↓ move to the issue above or below: among the issues the last
 * step could have reached while there's one that way, otherwise to the next card in the column.
 */
export function step(current: string, move: Move, trail: Trail | null, layout: TraverseLayout): Step | null {
  const live = trail?.at === current ? trail : null;
  if (move === "previous" || move === "next") {
    const i = live ? live.options.indexOf(current) : -1;
    const option = live && i >= 0 ? live.options.at(move === "next" ? i + 1 : i - 1) : undefined;
    if (live && option !== undefined && (move === "next" || i > 0)) return { target: option, trail: { ...live, at: option } };
    const target = layout.beside(current, move);
    return target === undefined ? null : { target, trail: null };
  }
  const options = layout.linked(current, move);
  const back = live && live.direction === opposite(move) && options.includes(live.from) ? live.from : undefined;
  const target = back ?? layout.closest(current, options);
  return target === undefined ? null : { target, trail: { at: target, from: current, direction: move, options } };
}

/** Where ← and → would go from the focused issue, shown on those cards before the key is pressed. */
export type LinkPreview = Readonly<{ upstream?: string; downstream?: string }> | null;

export function linkPreview(current: string, trail: Trail | null, layout: TraverseLayout): LinkPreview {
  const upstream = step(current, "upstream", trail, layout)?.target;
  const downstream = step(current, "downstream", trail, layout)?.target;
  return upstream === undefined && downstream === undefined ? null : { upstream, downstream };
}

/** Which arrow would reach an issue: "both" when ← and → lead to the same one (a two-issue cycle). */
export type PreviewKey = Direction | "both";

/** Which arrow would reach `uid`, if either. */
export function previewOf(preview: LinkPreview, uid: string): PreviewKey | undefined {
  const up = preview?.upstream === uid;
  const down = preview?.downstream === uid;
  return up && down ? "both" : down ? "downstream" : up ? "upstream" : undefined;
}
