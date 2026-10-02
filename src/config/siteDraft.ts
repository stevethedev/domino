import type { SiteConfig } from "./types";

export type ParsedJiraUrl = { origin: string; host: string; suggestedId: string; suggestedLabel: string };

/**
 * Accepts whatever a user is likely to paste: a bare host ("acme.atlassian.net"), a site URL, or any
 * page inside it (".../browse/ABC-1", ".../jira/software/projects/..."). Returns the https origin and
 * friendly defaults derived from the host, or null when it can't be a Jira site URL.
 */
export function parseJiraUrl(input: string): ParsedJiraUrl | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
  const host = u.host.toLowerCase();
  const first = u.hostname.toLowerCase().split(".")[0];
  const slug = first.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "site";
  const label = first
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return { origin: `https://${host}`, host, suggestedId: slug, suggestedLabel: label || host };
}

/** A unique id based on `base`, adding -2, -3, ... when taken. */
export function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 37)}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export const suggestedSecretRef = (id: string): string => `DOMINO_${(id || "SITE").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TOKEN`;

export const API_TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** The id and label last derived from the URL, so later edits can tell whether the user customized them. */
export type AutoFields = { id: string; label: string };

/** Fills id / label / secretRef from the URL unless the user already customized them. */
export function applyUrl(draft: SiteConfig, input: string, taken: readonly string[], prevAuto: AutoFields): { draft: SiteConfig; auto: AutoFields } {
  const parsed = parseJiraUrl(input);
  const next: SiteConfig = { ...draft, baseUrl: input };
  if (!parsed) return { draft: next, auto: prevAuto };
  const auto = { id: uniqueId(parsed.suggestedId, taken), label: parsed.suggestedLabel };
  if (draft.id === "" || draft.id === prevAuto.id) next.id = auto.id;
  if (draft.label === "" || draft.label === prevAuto.label) next.label = auto.label;
  if (next.auth.type === "apiToken" && (next.auth.secretRef === "" || next.auth.secretRef === suggestedSecretRef(draft.id))) {
    next.auth = { ...next.auth, secretRef: suggestedSecretRef(next.id) };
  }
  return { draft: next, auto };
}
