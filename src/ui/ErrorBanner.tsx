import type { ReactElement } from "react";
import type { SiteConfig } from "../config/types";
import type { SiteError } from "../data/MultiSiteLoader";

export function ErrorBanner({ errors, sites, attempted }: { errors: SiteError[]; sites: SiteConfig[]; attempted: number }): ReactElement | null {
  if (errors.length === 0) return null;
  const label = (id: string): string => sites.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="banner error" role="alert">
      <strong>
        {errors.length >= attempted
          ? `${attempted === 1 ? "The site" : "All sites"} failed to load.`
          : `${errors.length === 1 ? "1 site" : `${errors.length} sites`} failed to load; showing the rest.`}
      </strong>
      <ul>
        {errors.map((e) => (
          <li key={e.siteId}>
            <span className="mono">{label(e.siteId)}</span>: {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
