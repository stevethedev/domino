import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

export type DetailsMenu = Readonly<{
  ref: RefObject<HTMLDetailsElement>;
  /** Closes the menu; if focus was inside it, focus goes back to its summary rather than being lost. */
  close: () => void;
  /** Esc closes the menu and returns focus to its summary. */
  onKeyDown: (e: KeyboardEvent<HTMLDetailsElement>) => void;
  /** Focus moving out of the menu closes it, leaving focus where it went. */
  onBlur: (e: FocusEvent<HTMLDetailsElement>) => void;
}>;

/** Whether focus moving to `next` leaves `box` (`next` is null when focus leaves the page). */
export const focusLeaves = <T>(box: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next === null || !box.contains(next);

/**
 * Whether focus moving to `next` leaves `menu`. With no `next` (the window lost focus, or a click
 * landed on padding, which takes none) it stays: a click outside is caught on mousedown instead.
 */
export const leavesMenu = <T>(menu: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next !== null && focusLeaves(menu, next);

/** A `<details>` popover menu that closes on Esc, a click outside it, or focus leaving it. */
export function useDetailsMenu(): DetailsMenu {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current?.open && e.target instanceof Node && !ref.current.contains(e.target)) ref.current.open = false;
    };
    // Capture phase: the graph's pan/zoom stops mousedown from bubbling to the document.
    document.addEventListener("mousedown", onDown, true);
    return (): void => {
      document.removeEventListener("mousedown", onDown, true);
    };
  }, []);
  return {
    ref,
    close: () => {
      const menu = ref.current;
      if (!menu) return;
      const hadFocus = menu.contains(document.activeElement);
      menu.open = false;
      if (hadFocus) menu.querySelector("summary")?.focus();
    },
    onKeyDown: (e) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    },
    onBlur: (e) => {
      const menu = ref.current;
      if (menu?.open && leavesMenu(menu, e.relatedTarget instanceof Node ? e.relatedTarget : null)) menu.open = false;
    },
  };
}
