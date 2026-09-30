import { useEffect, useRef } from "react";
import type { SiteConfig } from "../config/types";

export function SiteSelector({
  sites,
  selected,
  onChange,
}: {
  sites: SiteConfig[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const enabled = sites.filter((s) => s.enabled);
  const chosen = enabled.filter((s) => selected.includes(s.id));

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <details
      className="site-selector"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={`Sites: ${chosen.map((s) => s.label).join(", ") || "none selected"}`}>
        <span className="field-label">Sites</span>
        {chosen.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          chosen.map((s) => (
            <span key={s.id} className="chip" style={{ ["--site" as string]: s.color }}>
              <span className="dot" aria-hidden="true" />
              {s.label}
            </span>
          ))
        )}
        <span aria-hidden="true">▾</span>
      </summary>
      <fieldset className="popover">
        <legend className="sr-only">Sites to load</legend>
        {enabled.length === 0 && <p className="muted">No enabled sites. Add one in Settings.</p>}
        {enabled.map((s) => (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))}
            />
            <span className="dot" style={{ ["--site" as string]: s.color }} aria-hidden="true" />
            {s.label} <span className="muted">{new URL(s.baseUrl).host}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
