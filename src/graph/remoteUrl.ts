import { normalizeBaseUrl } from "../config/schema";
import { siteKindOf, type SiteConfig } from "../config/types";
import { siteForKey } from "../data/siteScope";
import { gitHubKeyFromPath, JIRA_KEY_RE } from "../data/ticketKey";

export type RemoteTarget = { kind: "site"; siteId: string; key: string } | { kind: "foreign"; host: string; key: string; url: string };

/**
 * Classifies a remote link URL. `{baseUrl}/browse/{KEY}` on a configured Jira site (enabled or not)
 * resolves to that site; the same pattern elsewhere is an unconfigured Jira. An issue or pull
 * request page on a configured GitHub site resolves to it as `owner/repo#12`. Anything else is null.
 * When several sites share the address, the URL resolves to the one whose filter covers the ticket:
 * `from` (the site whose ticket holds the link) when it is on the address and covers it, like a link.
 */
export function matchRemoteUrl(
  url: string,
  sites: readonly Pick<SiteConfig, "id" | "baseUrl" | "kind" | "baseJql">[],
  from?: Pick<SiteConfig, "id">,
): RemoteTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const origin = parsed.origin.toLowerCase();
  const onHost = sites.filter((s) => normalizeBaseUrl(s.baseUrl) === origin);
  // Several sites can share the address, one per org, repo or project: the ticket goes to the one covering it.
  const here = onHost.find((s) => s.id === from?.id);
  const siteFor = (key: string): string | undefined => siteForKey(onHost, key, here)?.id;
  if (onHost.length && siteKindOf(onHost[0]) === "github") {
    const key = gitHubKeyFromPath(parsed.pathname);
    const siteId = key && siteFor(key);
    return key && siteId ? { kind: "site", siteId, key } : null;
  }
  const m = /^\/browse\/([^/?#]+)\/?$/.exec(parsed.pathname);
  if (!m) return null;
  const key = decodeURIComponent(m[1]).toUpperCase();
  if (!JIRA_KEY_RE.test(key)) return null;
  const siteId = siteFor(key);
  if (siteId) return { kind: "site", siteId, key };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { kind: "foreign", host: parsed.host.toLowerCase(), key, url: `${parsed.origin}/browse/${key}` };
}
