import { useCallback, useEffect, useState, type ReactElement, type RefCallback } from "react";
import type { SiteConfig } from "../config/types";
import { prefersReducedMotion } from "../lib/motion";
import { progressParts, type LoadView, type SiteProgress } from "../state/loadView";

/**
 * The circular-arrow icon, spinning while `active`. It stops only at the end of a turn, so a quick
 * load still reads as one full rotation and the icon never snaps back from a tilted angle. With
 * reduced motion it doesn't spin; it dims instead (see `.refresh-icon.spinning`).
 */
export function SpinnerIcon({ active }: { active: boolean }): ReactElement {
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (active) setSpinning(true);
    else if (prefersReducedMotion()) setSpinning(false); // no animation, so no turn ends to wait for
  }, [active]);
  return (
    <svg
      className={spinning ? "refresh-icon spinning" : "refresh-icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      onAnimationIteration={() => {
        if (!active) setSpinning(false);
      }}
    >
      {/* Drawn around (12, 12), the rotation centre. */}
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

/** True once `on` has stayed true for `ms`; false as soon as it's false. Keeps quick loads from flashing a message. */
export function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => {
      setShown(true);
    }, ms);
    return (): void => {
      clearTimeout(id);
    };
  }, [on, ms]);
  return on && shown;
}

/**
 * Sets the `inert` attribute while `on` (no focus, clicks or screen-reader access inside). React
 * 18 doesn't know the attribute, so it's set on the element directly.
 */
export function useInert(on: boolean): RefCallback<HTMLElement> {
  return useCallback(
    (el: HTMLElement | null) => {
      if (on) el?.setAttribute("inert", "");
      else el?.removeAttribute("inert");
    },
    [on],
  );
}

const MARK = { pending: "…", loaded: "✓", failed: "✕" } as const;
const SAID = { pending: "loading", loaded: "loaded", failed: "failed" } as const;

/** "Acme ✓ · Partner …", read out as "Acme loaded, Partner loading". */
export function SiteProgressList({ sites, progress }: { sites: readonly SiteConfig[]; progress: SiteProgress }): ReactElement | null {
  const parts = progressParts(sites, progress);
  if (parts.length < 2) return null; // one site: the message already says what's loading
  return (
    <span className="site-progress">
      <span aria-hidden="true">
        {parts.map((p, i) => (
          <span key={p.siteId} className={`site-progress-item ${p.state}`}>
            {i > 0 && " · "}
            {p.label} {MARK[p.state]}
          </span>
        ))}
      </span>
      <span className="sr-only">{parts.map((p) => `${p.label} ${SAID[p.state]}`).join(", ")}</span>
    </span>
  );
}

/**
 * Floats over the canvas while tickets are on screen and a load runs ("Updating…", or "Loading
 * <scope>…" over the previous scope's tickets), and when a load failed but tickets stayed. A polite
 * live region, always rendered so screen readers pick up its changes; it fills in after 200 ms so
 * quick loads don't flash it.
 */
export function LoadPill({
  view,
  sites,
  scopeLabel,
  failureText,
}: {
  view: LoadView;
  sites: readonly SiteConfig[];
  scopeLabel: string;
  failureText: string | null;
}): ReactElement {
  const updating = useDelayed(view.busy && view.mode !== "empty", 200);
  const failed = !view.busy && failureText !== null;
  const visible = updating || failed;
  return (
    <div className={`load-pill${failed ? " warn" : ""}${visible ? "" : " hidden"}`} role="status" aria-live="polite" aria-atomic="true">
      {updating && (
        <>
          <SpinnerIcon active />
          <span className="load-pill-text">{view.mode === "other" ? `Loading ${scopeLabel}…` : "Updating…"}</span>
          {view.progress && <SiteProgressList sites={sites} progress={view.progress} />}
        </>
      )}
      {failed && <span className="load-pill-text">{failureText}</span>}
    </div>
  );
}

/** Centred over an empty canvas while the first tickets load. */
export function LoadingMessage({ sites, progress }: { sites: readonly SiteConfig[]; progress: SiteProgress | null }): ReactElement {
  const names = sites.map((s) => s.label).join(", ");
  return (
    <div className="canvas-loading">
      <SpinnerIcon active />
      <span>Loading tickets from {names}…</span>
      {progress && <SiteProgressList sites={sites} progress={progress} />}
    </div>
  );
}
