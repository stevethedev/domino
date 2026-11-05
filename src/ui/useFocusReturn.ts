import { useCallback, useEffect, useRef, useState } from "react";

type Focusable = Pick<HTMLElement, "isConnected" | "getClientRects" | "focus" | "ownerDocument">;

/**
 * Focuses the first of `candidates` that's still on the page and takes focus: one removed, not
 * rendered (display:none, a collapsed section, a closed menu) or that ignores focus() is skipped.
 * True when one took focus.
 */
export function focusFirstOf(candidates: readonly (Focusable | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!el?.isConnected || el.getClientRects().length === 0) continue;
    el.focus();
    if (Object.is(el.ownerDocument.activeElement, el)) return true;
  }
  return false;
}

/** Where focus goes back to, in order, given the element that had focus when `remember` was called. */
type ReturnOrder = (opener: HTMLElement | null) => readonly (HTMLElement | null | undefined)[];

/**
 * Remembers the element that opened a drawer, prompt or menu (`remember`, called as it opens) and
 * puts focus back when it closes (`restore`). The return happens once the closing render is on
 * screen, so `order` can name elements that render only then; by default it's just the opener.
 */
export function useFocusReturn(): Readonly<{ remember: (opener?: Element | null) => void; restore: (order?: ReturnOrder) => void }> {
  const opener = useRef<HTMLElement | null>(null);
  // Boxed: a function handed to a state setter would be called as an updater.
  const [returning, setReturning] = useState<{ order: ReturnOrder } | null>(null);
  useEffect(() => {
    if (!returning) return;
    setReturning(null);
    focusFirstOf(returning.order(opener.current));
    opener.current = null;
  }, [returning]);
  /** `opener` defaults to what has focus now. */
  const remember = useCallback((el: Element | null = document.activeElement): void => {
    opener.current = el instanceof HTMLElement ? el : null;
  }, []);
  const restore = useCallback((order: ReturnOrder = (el) => [el]): void => {
    setReturning({ order });
  }, []);
  return { remember, restore };
}
