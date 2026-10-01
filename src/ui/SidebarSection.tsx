import { useId, type ReactNode } from "react";
import { usePersistentState } from "../state/storage";

const asBool = (raw: unknown) => (typeof raw === "boolean" ? raw : undefined);

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
  tone,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  /** Count shown next to the title (hidden when undefined). */
  badge?: number;
  /** Colors the title and badge for sections that need attention. */
  tone?: "warn";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentState(`domino.sidebar.${id}`, asBool, defaultOpen);
  const bodyId = useId();
  return (
    <section className={`sb-section${tone ? ` tone-${tone}` : ""}`} data-open={open}>
      <h2 className="sb-heading">
        <button
          type="button"
          className="sb-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          // Starts with the visible title, so voice control ("click Warnings") still matches.
          aria-label={badge !== undefined ? `${title}, ${badge}` : undefined}
          onClick={() => setOpen(!open)}
        >
          <span className="sb-chevron" aria-hidden="true" />
          <span className="sb-title">{title}</span>
          {badge !== undefined && (
            <span className="sb-badge" aria-hidden="true">
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
