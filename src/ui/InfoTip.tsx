import type { ReactElement, ReactNode } from "react";
import { ISSUE_DETAIL_ID } from "./IssueCard";
import { useDetailsMenu } from "./useDetailsMenu";

/** Whether focus moving to `next` leaves `tip` (`next` is null when focus leaves the page). */
export const focusLeaves = <T,>(tip: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next === null || !tip.contains(next);

/**
 * How to fit an open tip within `minLeft`..`maxRight`: narrower (so its text wraps) when it's wider
 * than the space, then moved left when it runs past the right edge, never past the left one.
 */
export function tipFit(t: Readonly<{ left: number; right: number; minLeft: number; maxRight: number }>): {
  maxWidth?: number;
  shift: number;
} {
  const space = t.maxRight - t.minLeft;
  const tooWide = t.right - t.left > space;
  const right = tooWide ? t.left + space : t.right;
  const shift = Math.max(Math.min(0, t.maxRight - right), t.minLeft - t.left);
  return tooWide ? { maxWidth: space, shift } : { shift };
}

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
  const { left, right } = panel.getBoundingClientRect();
  const fit = tipFit({ left, right, minLeft: box.left, maxRight: Math.min(box.right, drawerLeft) });
  if (fit.maxWidth !== undefined) panel.style.maxWidth = `${fit.maxWidth}px`;
  if (fit.shift !== 0) panel.style.translate = `${fit.shift}px`;
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
  return (
    <>
      <details
        className={inline ? "info-tip inline" : "info-tip"}
        ref={menu.ref}
        onKeyDown={menu.onKeyDown}
        onToggle={(e) => {
          if (e.currentTarget.open && !inline) keepInside(e.currentTarget);
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
