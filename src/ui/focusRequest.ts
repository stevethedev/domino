import { createContext, useContext, useEffect } from "react";

/**
 * Focus waiting for an issue to be drawn: after clearing the filters that hid it, or unfolding the
 * epic it's in, while the layout catches up. The first card or row drawn for one of `ids` calls
 * `drawn`, once it's on the page.
 */
export type FocusRequest = Readonly<{ ids: ReadonlySet<string>; drawn: () => void }>;

/** A request whose `then` runs once, however many of its items answer (`done` runs first). */
export function focusRequest(ids: Iterable<string>, then: () => void, done: () => void): FocusRequest {
  let answered = false;
  return {
    ids: new Set(ids),
    drawn: (): void => {
      if (answered) return;
      answered = true;
      done();
      then();
    },
  };
}

export const FocusRequestContext = createContext<FocusRequest | null>(null);

/** Called by each card and row with its id: answers a request waiting for it to be drawn. */
export function useAnswerFocusRequest(id: string): void {
  const request = useContext(FocusRequestContext);
  useEffect(() => {
    if (request?.ids.has(id)) request.drawn();
  }, [request, id]);
}
