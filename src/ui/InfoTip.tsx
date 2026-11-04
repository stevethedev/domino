import type { ReactElement, ReactNode } from "react";
import { useDetailsMenu } from "./useDetailsMenu";

/** Whether focus moving to `next` leaves `tip` (`next` is null when focus leaves the page). */
export const focusLeaves = <T,>(tip: Readonly<{ contains: (n: T) => boolean }>, next: T | null): boolean =>
  next === null || !tip.contains(next);

/**
 * An ⓘ that shows a field's explanation on click, Enter or Space, so it never needs a hover. Esc,
 * a click outside or moving focus away closes it. A hidden copy of the text has `id`: the field it
 * explains points `aria-describedby` at it, so a screen reader hears it with the field, open or not.
 *
 * It floats beside the ⓘ; `inline` (for the sidebar) spans the row it's in instead, which must be
 * a `.has-tip`, so it never runs past the sidebar. Never put it inside a `<label>`.
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
        onBlur={(e) => {
          const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
          if (e.currentTarget.open && focusLeaves(e.currentTarget, next)) e.currentTarget.open = false;
        }}
      >
        <summary aria-label={`About ${label}`}>
          <span aria-hidden="true">ⓘ</span>
        </summary>
        <div className={inline ? "info-tip-text" : "info-tip-text popover"}>{children}</div>
      </details>
      {/* Chrome leaves text inside a closed <details> out of a description: this copy is the one read. */}
      <div id={id} hidden>
        {children}
      </div>
    </>
  );
}
