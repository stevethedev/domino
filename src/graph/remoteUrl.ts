import { normalizeBaseUrl } from "../config/schema";
import type { SiteConfig } from "../config/types";

export type RemoteTarget = { kind: "site"; siteId: string; key: string } | { kind: "foreign"; host: string; key: string; url: string };

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/**
 * Classifies a remote link URL. `{baseUrl}/browse/{KEY}` on a configured site (enabled or not)
 * resolves to that site; the same pattern elsewhere is an unconfigured Jira; anything else is null.
 */
export function matchRemoteUrl(url: string, sites: readonly Pick<SiteConfig, "id" | "baseUrl">[]): RemoteTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const m = /^\/browse\/([^/?#]+)\/?$/.exec(parsed.pathname);
  if (!m) return null;
  const key = decodeURIComponent(m[1]).toUpperCase();
  if (!ISSUE_KEY.test(key)) return null;
  const origin = parsed.origin.toLowerCase();
  const site = sites.find((s) => normalizeBaseUrl(s.baseUrl) === origin);
  if (site) return { kind: "site", siteId: site.id, key };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { kind: "foreign", host: parsed.host.toLowerCase(), key, url: `${parsed.origin}/browse/${key}` };
}
