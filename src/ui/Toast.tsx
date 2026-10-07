import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "./Icon";

/** A passing notice about something the app just did, with an optional way to undo or follow up. */
export type ToastMessage = Readonly<{
  text: string;
  action?: Readonly<{ label: string; run: () => void }>;
}>;

/** How long a notice stays; hovering or focusing it pauses the countdown. */
const SHOW_MS = 10_000;

/**
 * Shows `toast` at the bottom of the canvas until it's dismissed, replaced, or its time is up. The
 * countdown pauses while the pointer or keyboard focus is on it, so an Undo can't vanish in hand.
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
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, SHOW_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [toast, paused, onDismiss]);
  return (
    <div
      className="toast"
      role="status"
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
      <span>{toast.text}</span>
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
