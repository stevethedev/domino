import { siteKindOf, type SiteConfig, type SiteKind } from "./types";

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
  const slug =
    first
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site";
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

export const GITHUB_URL = "https://github.com";

/** Where to create a GitHub token: a fine-grained one on github.com, the token settings on Enterprise Server. */
export const gitHubTokenUrl = (origin: string): string =>
  origin === GITHUB_URL ? `${GITHUB_URL}/settings/personal-access-tokens/new` : `${origin.replace(/\/+$/, "")}/settings/tokens`;

/** The draft as a site of `kind`: sign-in (and a github.com address, for a new GitHub site) set to suit it. */
export function withKind(draft: SiteConfig, kind: SiteKind): SiteConfig {
  if (siteKindOf(draft) === kind) return draft;
  const secretRef = suggestedSecretRef(draft.id);
  if (kind === "github") {
    const { cloudId: _cloudId, ...rest } = draft;
    return { ...rest, kind, baseUrl: draft.baseUrl.trim() || GITHUB_URL, auth: { type: "githubToken", secretRef }, baseJql: "" };
  }
  const { kind: _kind, ...rest } = draft;
  return {
    ...rest,
    baseUrl: draft.baseUrl === GITHUB_URL ? "" : draft.baseUrl,
    auth: { type: "apiToken", email: "", secretRef },
    baseJql: "",
  };
}

/** The id and label last derived from the URL, so later edits can tell whether the user customized them. */
export type AutoFields = { id: string; label: string };

/** Fills id / label / secretRef from the URL unless the user already customized them. */
export function applyUrl(
  draft: SiteConfig,
  input: string,
  taken: readonly string[],
  prevAuto: AutoFields,
): { draft: SiteConfig; auto: AutoFields } {
  const parsed = parseJiraUrl(input);
  let next: SiteConfig = { ...draft, baseUrl: input };
  if (!parsed) return { draft: next, auto: prevAuto };
  const github = parsed.host === "github.com";
  const auto = { id: uniqueId(parsed.suggestedId, taken), label: github ? "GitHub" : parsed.suggestedLabel };
  if (draft.id === "" || draft.id === prevAuto.id) next.id = auto.id;
  if (draft.label === "" || draft.label === prevAuto.label) next.label = auto.label;
  // A github.com link can only be a GitHub site (Enterprise Server hosts are picked by hand).
  if (github) next = { ...withKind(next, "github"), baseUrl: input };
  if (next.auth.type !== "oauth3lo" && (next.auth.secretRef === "" || next.auth.secretRef === suggestedSecretRef(draft.id))) {
    next.auth = { ...next.auth, secretRef: suggestedSecretRef(next.id) };
  }
  return { draft: next, auto };
}

/** Keys sorted, so two configs with the same fields in another order compare equal. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );

/** Whether the site form holds anything that closing it would lose. */
export function draftChanged(f: {
  initial: SiteConfig;
  draft: SiteConfig;
  initialDefault: boolean;
  isDefault: boolean;
  token: string;
}): boolean {
  // The backend fills in cloudId (OAuth discovery) while a form may be open; the form never edits it.
  const editable = ({ cloudId: _cloudId, ...rest }: SiteConfig): Omit<SiteConfig, "cloudId"> => rest;
  return f.token !== "" || f.isDefault !== f.initialDefault || canonical(editable(f.draft)) !== canonical(editable(f.initial));
}
