import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export type DetailsMenu = Readonly<{
  ref: RefObject<HTMLDetailsElement>;
  close: () => void;
  /** Esc closes the menu and returns focus to its summary. */
  onKeyDown: (e: KeyboardEvent<HTMLDetailsElement>) => void;
}>;

/** A `<details>` popover menu that closes on Esc or a click outside it. */
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
      if (ref.current) ref.current.open = false;
    },
    onKeyDown: (e) => {
      if (e.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    },
  };
}
