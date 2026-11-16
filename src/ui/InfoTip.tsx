import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { ISSUE_DETAIL_ID } from "./IssueCard";
import { focusLeaves, useDetailsMenu } from "./useDetailsMenu";

/**
 * How to fit an open tip within `minLeft`..`maxRight`: narrower (so its text wraps) when it's wider
 * than the space, then moved left when it runs past the right edge, never past the left one.
 */
export function tipFit(t: Readonly<{ left: number; right: number; minLeft: number; maxRight: number }>): {
  maxWidth?: number;
  shift: number;
} {
  const space = t.maxRight - t.minLeft;
  if (space <= 0) return { shift: 0 }; // nowhere to put it: leave it be rather than squash it
  const tooWide = t.right - t.left > space;
  const right = tooWide ? t.left + space : t.right;
  const shift = Math.max(Math.min(0, t.maxRight - right), t.minLeft - t.left);
  return tooWide ? { maxWidth: space, shift } : { shift };
}

const rectOf = (el: HTMLElement): { left: number; right: number } => {
  const { left, right } = el.getBoundingClientRect();
  return { left, right };
};

/**
 * Keeps an open floating tip inside its nearest `[data-tip-bounds]` (else the window), and left of
 * the details drawer, which covers the canvas's right side while open.
 */
function keepInside(details: HTMLDetailsElement): void {
  const panel = details.querySelector<HTMLElement>(".info-tip-text.popover");
  if (!panel) return;
  panel.style.translate = "";
  panel.style.maxWidth = "";
  const box = details.closest("[data-tip-bounds]")?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth };
  const drawerLeft = document.getElementById(ISSUE_DETAIL_ID)?.getBoundingClientRect().left ?? Infinity;
  const bounds = { minLeft: box.left, maxRight: Math.min(box.right, drawerLeft) };
  const { maxWidth } = tipFit({ ...rectOf(panel), ...bounds });
  // Narrowed, it's measured again: the shift then doesn't depend on which side it grew from.
  if (maxWidth !== undefined) panel.style.maxWidth = `${maxWidth}px`;
  const { shift } = tipFit({ ...rectOf(panel), ...bounds });
  if (shift !== 0) panel.style.translate = `${shift}px`;
}

/** Runs `refit` on every resize of `win` until the returned function is called. */
export function followResize(win: EventTarget, refit: () => void): () => void {
  win.addEventListener("resize", refit);
  return (): void => {
    win.removeEventListener("resize", refit);
  };
}

/**
 * An ⓘ that shows a field's explanation on click, Enter or Space, so it never needs a hover. Esc,
 * a click outside or moving focus away closes it. A hidden copy of the text has `id`: the field it
 * explains points `aria-describedby` at it, so a screen reader hears it with the field, open or not.
 *
 * It floats beside the ⓘ, kept inside its nearest `[data-tip-bounds]`; `inline` (for the sidebar)
 * spans the row it's in instead, which must be a `.has-tip`, so it never runs past the sidebar.
 * Never put it inside a `<label>`.
 */
export function InfoTip({
  id,
  label,
  inline = false,
  children,
}: {
  id: string;
  /** What it explains, for the ⓘ's name: "About <label>". */
  label: string;
  inline?: boolean;
  children: ReactNode;
}): ReactElement {
  const menu = useDetailsMenu();
  // While a floating tip is open, a resize (or zoom) fits it again.
  const stopFollowing = useRef<() => void>();
  useEffect(
    () => (): void => {
      stopFollowing.current?.();
    },
    [],
  );
  return (
    <>
      <details
        className={inline ? "info-tip inline" : "info-tip"}
        ref={menu.ref}
        onKeyDown={menu.onKeyDown}
        onToggle={(e) => {
          stopFollowing.current?.();
          stopFollowing.current = undefined;
          const details = e.currentTarget;
          if (!details.open || inline) return;
          keepInside(details);
          stopFollowing.current = followResize(window, () => {
            keepInside(details);
          });
        }}
        onBlur={(e) => {
          const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
          if (e.currentTarget.open && focusLeaves(e.currentTarget, next)) e.currentTarget.open = false;
        }}
      >
        <summary aria-label={`About ${label}`}>
          <span aria-hidden="true">ⓘ</span>
        </summary>
        {/* Focusable, so clicking its text keeps focus inside the tip and doesn't close it (see onBlur). */}
        <div className={inline ? "info-tip-text" : "info-tip-text popover"} tabIndex={-1}>
          {children}
        </div>
      </details>
      {/* Chrome leaves text inside a closed <details> out of a description: this copy is the one read. */}
      <div id={id} hidden>
        {children}
      </div>
    </>
  );
}
