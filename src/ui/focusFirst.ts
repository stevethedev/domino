/**
 * Focuses the first element matching one of `selectors`, in order, that can take focus: one
 * inside a collapsed section or a closed menu is skipped (focus() on it does nothing). True when
 * something took focus.
 */
export function focusFirst(...selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.getClientRects().length === 0) continue; // not rendered: display:none, or a hidden ancestor
      el.focus();
      if (document.activeElement === el) return true;
    }
  }
  return false;
}
