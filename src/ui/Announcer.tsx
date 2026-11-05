import { useEffect, useId, useRef, type ReactElement, type RefObject } from "react";

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

type Region = { textContent: string | null };
const listening: Regions<Region>[] = [];

/** Starts sending announcements to `regions`; returns how to stop. */
export function listen(regions: Regions<Region>): () => void {
  listening.push(regions);
  return (): void => {
    listening.splice(listening.indexOf(regions), 1);
  };
}

/** How long a region stays empty before new text, so the same text twice is still read. */
const CLEAR_MS = 50;

/**
 * Text waiting to be read, per politeness and then per source, in the order first asked: a source's
 * newer text replaces its own, not anyone else's.
 */
const waiting = { polite: new Map<string | symbol, string>(), assertive: new Map<string | symbol, string>() };
const timers: { polite?: ReturnType<typeof setTimeout>; assertive?: ReturnType<typeof setTimeout> } = {};

/**
 * Says `text` to screen readers, politely unless `assertive` (errors that need attention now). Text
 * from the same `source` (each message's own) replaces its earlier text not yet read; other sources'
 * is read too, in order. It goes to whichever regions are listening when it's read.
 */
export function announce(text: string, { assertive = false, source }: Readonly<{ assertive?: boolean; source?: string }> = {}): void {
  if (!text.trim()) return;
  const kind = assertive ? "assertive" : "polite";
  // Without a source, it's its own: nothing else replaces it.
  waiting[kind].set(source ?? Symbol("announcement"), text);
  if (timers[kind] === undefined) deliver(assertive);
}

/**
 * Empties the destination, then fills it after a moment, so the same text twice still counts as a
 * change. If the destination changed meanwhile (Settings opened or closed), it empties that one
 * and waits again.
 */
function deliver(assertive: boolean): void {
  const kind = assertive ? "assertive" : "polite";
  const emptied = regionFor(listening, assertive);
  if (emptied) emptied.textContent = "";
  timers[kind] = setTimeout(() => {
    timers[kind] = undefined;
    const queue = waiting[kind];
    if (queue.size === 0) return;
    const region = regionFor(listening, assertive);
    if (region !== emptied) {
      deliver(assertive);
      return;
    }
    if (region) region.textContent = [...queue.values()].join(" ");
    queue.clear();
  }, CLEAR_MS);
}

/** Drops `source`'s text not yet read: its message is gone, or says nothing now. */
export function cancelAnnouncement(source: string): void {
  waiting.polite.delete(source);
  waiting.assertive.delete(source);
}

// Node.TEXT_NODE and Node.ELEMENT_NODE, without needing a DOM to compare against.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const isElement = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;

/** What a screen reader says for `node`: its text, leaving out `aria-hidden` parts. */
export function spokenText(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? "";
  if (isElement(node) && node.getAttribute("aria-hidden") === "true") return "";
  return [...node.childNodes].map(spokenText).join("");
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
    return listen({ polite: polite.current, assertive: assertive.current });
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
  const source = useId();
  useEffect(() => {
    const text = ref.current ? spokenText(ref.current).trim() : "";
    if (text !== said.current) {
      // A message that's gone, or says nothing now, isn't read late.
      if (text) announce(text, { assertive, source });
      else cancelAnnouncement(source);
    }
    said.current = text;
  });
  useEffect(
    () => (): void => {
      cancelAnnouncement(source);
    },
    [source],
  );
  return ref;
}
