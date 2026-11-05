import { focusFirstOf } from "./useFocusReturn";

/**
 * Focuses the first element matching one of `selectors`, in order, that can take focus (see
 * `focusFirstOf`). True when something took focus.
 */
export const focusFirst = (...selectors: readonly string[]): boolean =>
  focusFirstOf(selectors.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]));
