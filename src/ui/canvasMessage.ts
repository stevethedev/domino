import type { SiteConfig } from "../config/types";

/** Why no site is loading: there are none, they're all turned off, or none is selected in Sites. */
export function noSitesShown(sites: readonly SiteConfig[]): "none" | "all off" | "none selected" {
  if (sites.length === 0) return "none";
  return sites.some((s) => s.enabled) ? "none selected" : "all off";
}
