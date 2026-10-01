import type { ReactNode } from "react";
import { usePersistentState } from "../state/storage";

const asBool = (raw: unknown) => (typeof raw === "boolean" ? raw : undefined);

/**
 * One collapsible sidebar section: a full-strength title with an optional count badge, and a body.
 * Open/closed is remembered per section. Sub-headings inside a body use `.subhead`.
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
  return (
    <details
      className={`sb-section${tone ? ` tone-${tone}` : ""}`}
      open={open}
      onToggle={(e) => {
        if (e.currentTarget.open !== open) setOpen(e.currentTarget.open);
      }}
    >
      <summary>
        <span className="sb-chevron" aria-hidden="true" />
        <h2 className="sb-title">{title}</h2>
        {badge !== undefined && <span className="sb-badge">{badge}</span>}
      </summary>
      <div className="sb-body">{children}</div>
    </details>
  );
}
