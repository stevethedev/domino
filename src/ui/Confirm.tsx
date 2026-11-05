import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";

/** The two ways out of a confirm: the risky one, and the safe one that keeps things as they are. */
export type ConfirmChoices = Readonly<{
  /** The risky choice ("Discard", "Delete"), shown as a danger button. */
  confirm: Readonly<{ label: string; run: () => void }>;
  /** The safe choice ("Keep editing"), which gets focus so Enter can't do harm by accident. Esc picks it too. */
  cancel: Readonly<{ label: string; run: () => void }>;
}>;

/**
 * Asks before something that can't be undone, in place: a labelled group (not a dialog: nothing
 * else is blocked) whose question describes it, with focus on the safe choice. `inline` fits it in
 * a row or list item instead of a banner.
 */
export function Confirm({
  label,
  children,
  confirm,
  cancel,
  inline = false,
}: ConfirmChoices &
  Readonly<{
    /** What the group is for, as a screen reader names it ("Unsaved site changes"). */
    label: string;
    /** The question, said when focus arrives. */
    children: ReactNode;
    inline?: boolean;
  }>): ReactElement {
  const safe = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => {
    safe.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={questionId}
      className={inline ? "confirm-inline" : "banner warn actionable"}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Only the question is dismissed: not the menu or dialog around it.
        e.preventDefault();
        e.stopPropagation();
        cancel.run();
      }}
    >
      <div id={questionId} className={inline ? "confirm-question" : "banner-text"}>
        {children}
      </div>
      <div className={inline ? "confirm-actions" : "banner-actions"}>
        <button type="button" className="danger" onClick={confirm.run}>
          {confirm.label}
        </button>
        <button ref={safe} type="button" onClick={cancel.run}>
          {cancel.label}
        </button>
      </div>
    </div>
  );
}
