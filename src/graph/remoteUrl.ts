import { normalizeBaseUrl } from "../config/schema";
import { siteKindOf, type SiteConfig } from "../config/types";
import { gitHubKeyFromPath, JIRA_KEY_RE } from "../data/ticketKey";

export type RemoteTarget = { kind: "site"; siteId: string; key: string } | { kind: "foreign"; host: string; key: string; url: string };

/**
 * Classifies a remote link URL. `{baseUrl}/browse/{KEY}` on a configured Jira site (enabled or not)
 * resolves to that site; the same pattern elsewhere is an unconfigured Jira. An issue or pull
 * request page on a configured GitHub site resolves to it as `owner/repo#12`. Anything else is null.
 */
export function matchRemoteUrl(url: string, sites: readonly Pick<SiteConfig, "id" | "baseUrl" | "kind">[]): RemoteTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const origin = parsed.origin.toLowerCase();
  const site = sites.find((s) => normalizeBaseUrl(s.baseUrl) === origin);
  if (site && siteKindOf(site) === "github") {
    const key = gitHubKeyFromPath(parsed.pathname);
    return key ? { kind: "site", siteId: site.id, key } : null;
  }
  const m = /^\/browse\/([^/?#]+)\/?$/.exec(parsed.pathname);
  if (!m) return null;
  const key = decodeURIComponent(m[1]).toUpperCase();
  if (!JIRA_KEY_RE.test(key)) return null;
  if (site) return { kind: "site", siteId: site.id, key };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { kind: "foreign", host: parsed.host.toLowerCase(), key, url: `${parsed.origin}/browse/${key}` };
}
