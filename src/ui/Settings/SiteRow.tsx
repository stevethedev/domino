import { useEffect, useRef, useState, type ReactElement } from "react";
import type { HealthStatus, SiteConfig } from "../../config/types";

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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <tr ref={rowRef} className={highlight ? "row-new" : undefined}>
      <th scope="row">
        <span className="chip" style={{ "--site": site.color }}>
          <span className="dot" aria-hidden="true" />
          {site.label}
        </span>
        <span className="muted mono small"> {site.id}</span>
      </th>
      <td className="mono small">{site.baseUrl}</td>
      <td>{site.auth.type === "apiToken" ? "API token" : "OAuth 3LO"}</td>
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
          <>
            <button ref={confirmRef} type="button" className="danger" onClick={onRemove} aria-label={`Confirm removing ${site.label}`}>
              Confirm remove
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </button>
          </>
        ) : (
          <button
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
