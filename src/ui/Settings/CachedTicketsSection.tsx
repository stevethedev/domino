import { useId, useState, type ReactElement } from "react";
import { errorMessage } from "../../data/errors";

/** Settings → Cached tickets: what Domino keeps between launches, and a way to forget it. */
export function CachedTicketsSection({ onClear }: { onClear: () => Promise<void> }): ReactElement {
  const id = useId();
  const [state, setState] = useState<{ status: "idle" | "clearing" | "cleared" } | { status: "failed"; message: string }>({
    status: "idle",
  });
  return (
    <section className="backend-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Cached tickets</h3>
      <p className="hint" id={`${id}-hint`}>
        So tickets appear right away, Domino keeps the last ones loaded for your 12 most recent scopes, for up to 30 days, encrypted on this
        computer. Changing or removing a site, its sign-in or its token discards that site&apos;s cached tickets.
      </p>
      <button
        type="button"
        aria-describedby={`${id}-hint`}
        disabled={state.status === "clearing"}
        onClick={() => {
          setState({ status: "clearing" });
          onClear().then(
            () => {
              setState({ status: "cleared" });
            },
            (e: unknown) => {
              setState({ status: "failed", message: errorMessage(e) });
            },
          );
        }}
      >
        Clear cached tickets
      </button>
      <p className={state.status === "failed" ? "field-error" : "hint"} role="status">
        {state.status === "cleared" && "Cached tickets cleared. The tickets on screen stay until you load again."}
        {state.status === "failed" && `Couldn't clear cached tickets: ${state.message}`}
      </p>
    </section>
  );
}
