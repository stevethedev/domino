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
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onDismiss, SHOW_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [toast, paused, onDismiss]);
  if (!toast) return null;
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
      {toast.action && (
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <Icon name="close" />
      </button>
    </div>
  );
}
