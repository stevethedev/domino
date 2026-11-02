import { useId, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { usePersistentState } from "../state/storage";

const asBool = (raw: unknown): boolean | undefined => (typeof raw === "boolean" ? raw : undefined);

/**
 * A section that just emptied catches focus only when its own removed body dropped it: it had
 * focus before, and focus has fallen to the page. Never on a first empty render nobody was in.
 */
export const catchesLostFocus = (s: Readonly<{ becameEmpty: boolean; hadFocus: boolean; focusOnPage: boolean }>): boolean =>
  s.becameEmpty && s.hadFocus && s.focusOnPage;

/**
 * One collapsible sidebar section, using the disclosure pattern: a real <h2> wrapping a toggle
 * button (aria-expanded / aria-controls), so the heading stays in screen readers' heading
 * navigation. Open/closed is remembered per section; the body stays mounted while collapsed.
 * Sub-headings inside a body use `.subhead`.
 */
export function SidebarSection({
  id,
  title,
  badge,
  badgeLabel,
  tone,
  defaultOpen = true,
  empty = false,
  children,
}: {
  id: string;
  title: string;
  /** Count shown next to the title (hidden when undefined). */
  badge?: number;
  /** What the count means, for the accessible name and tooltip (e.g. "issues hidden by filters"). */
  badgeLabel?: string;
  /** Colors the title and badge for sections that need attention. */
  tone?: "warn";
  defaultOpen?: boolean;
  /**
   * Nothing to show: the section is one muted line ("Warnings · none") with no toggle or body.
   * The remembered open/closed state is left alone, so the section comes back as it was.
   */
  empty?: boolean;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = usePersistentState(`domino.sidebar.${id}`, asBool, defaultOpen);
  const bodyId = useId();
  const sectionEl = useRef<HTMLElement>(null);
  const emptyHeading = useRef<HTMLSpanElement>(null);
  const wasEmpty = useRef(empty);
  // Read while rendering, before this render's commit removes the body: did the section hold focus?
  const hadFocus = sectionEl.current?.contains(document.activeElement) ?? false;
  // Emptied under focus (e.g. "Mark as seen" removes its own button): the heading catches it.
  useLayoutEffect(() => {
    const becameEmpty = empty && !wasEmpty.current;
    wasEmpty.current = empty;
    if (catchesLostFocus({ becameEmpty, hadFocus, focusOnPage: document.activeElement === document.body })) {
      emptyHeading.current?.focus();
    }
  }, [empty]);
  if (empty) {
    return (
      <section className="sb-section empty" data-section={id} ref={sectionEl}>
        <h2 className="sb-heading">
          <span className="sb-toggle" tabIndex={-1} ref={emptyHeading}>
            <span className="sb-title">
              {title}
              <span className="sb-none"> · none</span>
            </span>
          </span>
        </h2>
      </section>
    );
  }
  return (
    <section className={`sb-section${tone ? ` tone-${tone}` : ""}`} data-section={id} ref={sectionEl}>
      <h2 className="sb-heading">
        <button
          type="button"
          className="sb-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          // Starts with the visible title, so voice control ("click Warnings") still matches.
          aria-label={badge !== undefined ? `${title}, ${badge}${badgeLabel ? ` ${badgeLabel}` : ""}` : undefined}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <span className="sb-chevron" aria-hidden="true" />
          <span className="sb-title">{title}</span>
          {badge !== undefined && (
            <span className="sb-badge" aria-hidden="true" title={badgeLabel ? `${badge} ${badgeLabel}` : undefined}>
              {badge}
            </span>
          )}
        </button>
      </h2>
      <div id={bodyId} className="sb-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
