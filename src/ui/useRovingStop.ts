import { useCallback, useState } from "react";

/**
 * A view's one Tab stop (roving tabindex): the item last focused, while it's still there, else the
 * open issue, else the first item. Arrow keys move on from it.
 */
export const tabStopOf = (s: {
  lastFocused: string | null;
  selected: string | null;
  has: (id: string) => boolean;
  first: string | undefined;
}): string | undefined => [s.lastFocused, s.selected].find((id): id is string => id !== null && s.has(id)) ?? s.first;

/**
 * Remembers the item last focused in a view, per scope, so an id that comes back in another scope
 * doesn't inherit the stop. Call `onFocusItem` from each item's focus handler.
 */
export function useRovingStop(scopeKey: string | null): { lastFocused: string | null; onFocusItem: (id: string) => void } {
  const [focusedIn, setFocusedIn] = useState<{ scopeKey: string | null; id: string } | null>(null);
  const onFocusItem = useCallback(
    (id: string): void => {
      setFocusedIn({ scopeKey, id });
    },
    [scopeKey],
  );
  return { lastFocused: focusedIn?.scopeKey === scopeKey ? focusedIn.id : null, onFocusItem };
}
