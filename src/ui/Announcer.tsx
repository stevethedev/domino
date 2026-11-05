import { useEffect, useRef, type ReactElement, type RefObject } from "react";

/** A pair of live regions: one waits for a pause in speech, the other interrupts. */
export type Regions<T> = Readonly<{ polite: T; assertive: T }>;

/**
 * Where an announcement goes: the regions mounted last that are still listening. The page's are
 * at the bottom; a modal dialog's go on top while it's open, since `showModal()` makes the rest of
 * the page inert and its regions silent.
 */
export const regionFor = <T,>(listening: readonly Regions<T>[], assertive: boolean): T | undefined => {
  const top = listening.at(-1);
  return top && (assertive ? top.assertive : top.polite);
};

const listening: Regions<HTMLElement>[] = [];
const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** How long a region stays empty before new text, so the same text twice is still read. */
const CLEAR_MS = 50;

/**
 * Says `text` to screen readers, politely unless `assertive` (errors that need attention now). A
 * newer announcement in the same region replaces one not yet made.
 */
export function announce(text: string, { assertive = false }: Readonly<{ assertive?: boolean }> = {}): void {
  const region = regionFor(listening, assertive);
  if (!region || !text.trim()) return;
  clearTimeout(pending.get(region));
  region.textContent = "";
  pending.set(
    region,
    setTimeout(() => {
      region.textContent = text;
    }, CLEAR_MS),
  );
}

/**
 * The live regions `announce` writes to. The page renders one pair (always mounted, so each region
 * exists before its first text); a modal dialog renders its own, listening only while `listening`.
 */
export function LiveRegions({ listening: on = true }: Readonly<{ listening?: boolean }>): ReactElement {
  const polite = useRef<HTMLSpanElement>(null);
  const assertive = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!on || !polite.current || !assertive.current) return;
    const regions = { polite: polite.current, assertive: assertive.current };
    listening.push(regions);
    return (): void => {
      listening.splice(listening.indexOf(regions), 1);
    };
  }, [on]);
  return (
    <>
      <span ref={polite} className="sr-only" role="status" />
      <span ref={assertive} className="sr-only" role="alert" />
    </>
  );
}

/**
 * Announces an element's text whenever it changes (and isn't empty): for a message that appears with
 * its text, which a live region of its own would miss. Put the returned ref on the element.
 */
export function useAnnounced<T extends HTMLElement>({ assertive = false }: Readonly<{ assertive?: boolean }> = {}): RefObject<T> {
  const ref = useRef<T>(null);
  const said = useRef("");
  useEffect(() => {
    const text = ref.current?.textContent.trim() ?? "";
    if (text !== said.current && text) announce(text, { assertive });
    said.current = text;
  });
  return ref;
}
