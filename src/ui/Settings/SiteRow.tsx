import { useEffect, useRef, useState, type ReactElement } from "react";
import type { HealthStatus, SiteAuth, SiteConfig } from "../../config/types";
import { prefersReducedMotion } from "../../lib/motion";
import { Confirm } from "../Confirm";
import { useFocusReturn } from "../useFocusReturn";

const AUTH_LABELS: Readonly<Record<SiteAuth["type"], string>> = {
  apiToken: "API token",
  oauth3lo: "OAuth 3LO",
  githubToken: "GitHub token",
};

export function SiteRow({
  site,
  highlight,
  health,
  onToggle,
  onTest,
  onEdit,
  onRemove,
}: {
  site: SiteConfig;
  highlight: boolean;
  health: HealthStatus;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const { restore } = useFocusReturn();
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [highlight]);

  return (
    <tr ref={rowRef} className={highlight ? "row-new" : undefined} data-site-id={site.id}>
      <th scope="row">
        <span className="chip" style={{ "--site": site.color }}>
          <span className="dot" aria-hidden="true" />
          {site.label}
        </span>
        <span className="muted mono small"> {site.id}</span>
      </th>
      <td className="mono small">{site.baseUrl}</td>
      <td>{AUTH_LABELS[site.auth.type]}</td>
      <td>
        <label className="check">
          <input
            type="checkbox"
            role="switch"
            checked={site.enabled}
            onChange={(e) => {
              onToggle(e.target.checked);
            }}
            aria-label={`Enable ${site.label}`}
          />
          <span className="small">{site.enabled ? "On" : "Off"}</span>
        </label>
      </td>
      <td>
        <HealthBadge health={health} />
      </td>
      <td className="row-actions">
        <button type="button" onClick={onTest} disabled={health.state === "checking"} aria-label={`Test connection to ${site.label}`}>
          Test
        </button>
        <button type="button" onClick={onEdit} aria-label={`Edit ${site.label}`}>
          Edit
        </button>
        {confirming ? (
          <Confirm
            inline
            label={`Remove ${site.label}`}
            confirm={{ label: "Remove", run: onRemove }}
            cancel={{
              label: "Keep",
              run: () => {
                setConfirming(false);
                // Back to Remove, drawn again in place of the question.
                restore(() => [removeRef.current]);
              },
            }}
          >
            Remove {site.label}?
          </Confirm>
        ) : (
          <button
            ref={removeRef}
            type="button"
            onClick={() => {
              setConfirming(true);
            }}
            aria-label={`Remove ${site.label}`}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

function HealthBadge({ health }: { health: HealthStatus }): ReactElement {
  switch (health.state) {
    case "unknown":
      return <span className="health health-unknown">Unknown</span>;
    case "checking":
      return (
        <span className="health health-unknown" aria-live="polite">
          Checking…
        </span>
      );
    case "ok":
      return (
        <span className="health health-ok" aria-live="polite">
          ✓ OK
        </span>
      );
    case "error":
      return (
        <span className="health health-error" aria-live="polite">
          ✗ Error: <span className="small">{health.message}</span>
        </span>
      );
  }
}
