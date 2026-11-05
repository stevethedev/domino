import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export type DetailsMenu = Readonly<{
  ref: RefObject<HTMLDetailsElement>;
  /** Closes the menu; if focus was inside it, focus goes back to its summary rather than being lost. */
  close: () => void;
  /** Esc closes the menu and returns focus to its summary. */
  onKeyDown: (e: KeyboardEvent<HTMLDetailsElement>) => void;
}>;

/** Whether focus moving to `next` leaves `box` (`next` is null when focus leaves the page). */
export const focusLeaves = <T>(box: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next === null || !box.contains(next);

/** Whether a click or focus landing on `next` (if anything) is outside `menu`. */
export const leavesMenu = <T>(menu: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next !== null && focusLeaves(menu, next);

/** A `<details>` popover menu that closes on Esc, or when a click or focus lands outside it. */
export function useDetailsMenu(): DetailsMenu {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onOutside = (e: Event): void => {
      const menu = ref.current;
      if (menu?.open && leavesMenu(menu, e.target instanceof Node ? e.target : null)) menu.open = false;
    };
    // Capture phase: the graph's pan/zoom stops mousedown from bubbling to the document. Focus
    // landing outside covers Tab and hotkeys (`/` to Find) alike; focus leaving for nowhere (the
    // window losing it, a click on the menu's padding) lands nowhere, so the menu stays open.
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("focusin", onOutside, true);
    return (): void => {
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("focusin", onOutside, true);
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
  };
}
