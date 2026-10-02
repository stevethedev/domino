import type { Direction, TraverseLayout, Vertical } from "../graph/traverse";
import { linkedIssues } from "../graph/traverse";
import type { GraphEdge } from "../graph/types";

/** A graph card or a timeline row that's shown (folded rows only stay for the fold animation). */
const ISSUE_ELEMENTS = ".card[data-uid], .tl-row[data-tl-uid]:not(.folded)";

const uidOf = (el: Element): string | null => el.getAttribute("data-uid") ?? el.getAttribute("data-tl-uid");

function rectOf(uid: string): DOMRect | undefined {
  const id = CSS.escape(uid);
  return document.querySelector(`.card[data-uid="${id}"], .tl-row[data-tl-uid="${id}"]:not(.folded)`)?.getBoundingClientRect();
}

const middleY = (r: DOMRect): number => r.top + r.height / 2;

/**
 * Where issues are on screen right now, for arrow-key traversal over the drawn `edges`: in the
 * graph, cards in the same layout column; in the timeline, rows (which all share one column).
 */
export function screenLayout(edges: readonly GraphEdge[]): TraverseLayout {
  const rects = new Map<string, DOMRect | undefined>();
  const rect = (uid: string): DOMRect | undefined => {
    if (!rects.has(uid)) rects.set(uid, rectOf(uid));
    return rects.get(uid);
  };
  const top = (uid: string): number => rect(uid)?.top ?? Infinity;

  return {
    linked: (uid: string, direction: Direction) => linkedIssues(uid, edges, direction).sort((a, b) => top(a) - top(b)),
    closest: (from, options) => {
      const origin = rect(from);
      if (!origin) return options.at(0);
      const gap = (uid: string): number => {
        const r = rect(uid);
        return r ? Math.abs(middleY(r) - middleY(origin)) : Infinity;
      };
      return [...options].sort((a, b) => gap(a) - gap(b)).at(0);
    },
    beside: (uid: string, direction: Vertical) => {
      const origin = rect(uid);
      if (!origin) return undefined;
      const sameColumn = (r: DOMRect): boolean => r.left < origin.right && r.right > origin.left;
      const ahead = (r: DOMRect): boolean => (direction === "next" ? r.top >= origin.bottom - 1 : r.bottom <= origin.top + 1);
      const candidates = [...document.querySelectorAll(ISSUE_ELEMENTS)].flatMap((el) => {
        const id = uidOf(el);
        const r = el.getBoundingClientRect();
        return id && id !== uid && sameColumn(r) && ahead(r) ? [{ id, distance: Math.abs(middleY(r) - middleY(origin)) }] : [];
      });
      return candidates.sort((a, b) => a.distance - b.distance).at(0)?.id;
    },
  };
}
