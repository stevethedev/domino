import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "./Icon";
import { useAnnounced } from "./Announcer";

/** A passing notice about something the app just did, with an optional way to undo or follow up. */
export type ToastMessage = Readonly<{
  text: string;
  action?: Readonly<{ label: string; run: () => void }>;
}>;

/** How long a plain notice stays (at least 6s); hovering or focusing it pauses the countdown. */
const SHOW_MS = 10_000;

/**
 * Shows `toast` at the bottom of the canvas until it's dismissed or replaced. A plain notice also
 * goes when its time is up, pausing while the pointer or focus is on it; one with an action (Undo)
 * stays, so keyboard and screen-reader users can always reach it (WCAG 2.2.1).
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }): ReactElement | null {
  // Each notice gets a fresh card, so one dismissed while hovered can't leave the next paused.
  return toast && <ToastCard key={idOf(toast)} toast={toast} onDismiss={onDismiss} />;
}

const ids = new WeakMap<ToastMessage, number>();
let lastId = 0;
const idOf = (t: ToastMessage): number => {
  const known = ids.get(t);
  if (known !== undefined) return known;
  lastId += 1;
  ids.set(t, lastId);
  return lastId;
};

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }): ReactElement {
  const [paused, setPaused] = useState(false);
  const { action } = toast;
  const said = useAnnounced<HTMLSpanElement>();
  useEffect(() => {
    if (paused || action) return;
    const timer = setTimeout(onDismiss, SHOW_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [toast, paused, action, onDismiss]);
  return (
    <div
      className="toast"
      onPointerEnter={() => {
        setPaused(true);
      }}
      onPointerLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <span ref={said}>{toast.text}</span>
      {action && (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            action.run();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <Icon name="close" />
      </button>
    </div>
  );
}
