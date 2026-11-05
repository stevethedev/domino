import type { ReactElement } from "react";
import type { SiteConfig } from "../config/types";
import { Icon } from "./Icon";
import { useDetailsMenu } from "./useDetailsMenu";

export function SiteSelector({
  sites,
  selected,
  onChange,
}: {
  sites: SiteConfig[];
  selected: string[];
  onChange: (ids: string[]) => void;
}): ReactElement {
  const menu = useDetailsMenu();
  const enabled = sites.filter((s) => s.enabled);
  const chosen = enabled.filter((s) => selected.includes(s.id));

  return (
    <details className="site-selector" ref={menu.ref} onKeyDown={menu.onKeyDown}>
      <summary aria-label={`Sites: ${chosen.map((s) => s.label).join(", ") || "none selected"}`}>
        <span className="field-label">Sites</span>
        {chosen.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          chosen.map((s) => (
            <span key={s.id} className="chip" style={{ "--site": s.color }}>
              <span className="dot" aria-hidden="true" />
              {s.label}
            </span>
          ))
        )}
        <Icon name="chevron-down" className="disclosure-caret" />
      </summary>
      <fieldset className="popover">
        <legend className="sr-only">Sites to load</legend>
        {enabled.length === 0 && <p className="muted">No enabled sites. Add one in Settings.</p>}
        {enabled.map((s) => (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) => {
                onChange(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id));
              }}
            />
            <span className="dot" style={{ "--site": s.color }} aria-hidden="true" />
            {s.label} <span className="muted">{new URL(s.baseUrl).host}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
