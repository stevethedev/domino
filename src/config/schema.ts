import { z } from "zod";
import { siteKindOf, type DominoConfig, type SiteConfig } from "./types";

const slug = z
  .string()
  .min(1, "Required")
  .max(40, "At most 40 characters")
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and dashes only");

const httpsUrl = z
  .string()
  .min(1, "Required")
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.hostname.includes(".") && (u.pathname === "/" || u.pathname === "");
    } catch {
      return false;
    }
  }, "Must be an https URL with no path, e.g. https://example.atlassian.net");

const secretRef = z
  .string()
  .min(1, "Required")
  .regex(/^[A-Z][A-Z0-9_]*$/, "Uppercase letters, digits and underscores, e.g. DOMINO_ACME_TOKEN")
  // Where the ticket cache keeps its key (src-tauri/src/cache.rs): a token there would clobber it.
  .refine((ref) => ref !== "DOMINO_CACHE_KEY", "DOMINO_CACHE_KEY is reserved by Domino; pick another name");

const authSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("apiToken"),
    email: z.string().min(1, "Required").pipe(z.email("Must be an email address")),
    secretRef,
  }),
  z.object({ type: z.literal("oauth3lo") }),
  z.object({ type: z.literal("githubToken"), secretRef }),
]);

/** Older configs called the site filter `defaultJql`. */
const migrateSite = (raw: unknown): unknown => {
  if (raw && typeof raw === "object" && "defaultJql" in raw && !("baseJql" in raw)) {
    const { defaultJql, ...rest } = raw;
    return { ...rest, baseJql: defaultJql };
  }
  return raw;
};

const siteShape = z.object({
  id: slug,
  kind: z.enum(["jira", "github"]).optional(),
  label: z.string().trim().min(1, "Required").max(40, "At most 40 characters"),
  baseUrl: httpsUrl,
  cloudId: z.string().optional(),
  auth: authSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex color like #7c3aed"),
  enabled: z.boolean(),
  baseJql: z.string().optional(),
});

export const siteSchema = z.preprocess(
  migrateSite,
  siteShape.superRefine((site, ctx) => {
    // The Rust core rejects a mismatch too (config.rs `validated`); catching it here puts it on the field.
    const github = siteKindOf(site) === "github";
    if (github !== (site.auth.type === "githubToken")) {
      ctx.addIssue({
        code: "custom",
        path: ["auth", "type"],
        message: github ? "A GitHub site needs a GitHub token" : "GitHub tokens are for GitHub sites",
      });
    }
  }),
);

export const configSchema = z
  .object({
    sites: z.array(siteSchema),
    defaultSiteIds: z.array(z.string()),
    backend: z.enum(["mock", "jira"]).default("mock"),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.sites.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", path: ["sites", i, "id"], message: "Id must be unique" });
      seen.add(s.id);
    });
  });

export type FieldErrors = Partial<Record<string, string>>;

/** Validates one site in the context of the others (for uniqueness). Keys are dotted paths, e.g. "auth.email". */
export function validateSite(site: SiteConfig, others: readonly SiteConfig[]): FieldErrors {
  const errors: FieldErrors = {};
  const res = siteSchema.safeParse(site);
  if (!res.success) {
    for (const issue of res.error.issues) {
      const path = issue.path.join(".");
      errors[path] ??= issue.message;
    }
  }
  if (!errors.id && others.some((o) => o.id === site.id)) errors.id = "Id must be unique";
  // Several sites can share an address (one per org, repo or project), but not a kind: github.com isn't a Jira.
  const clash = others.find((o) => sameAddress(o, site) && siteKindOf(o) !== siteKindOf(site));
  if (!errors.baseUrl && clash) errors.baseUrl = `A ${siteKindOf(clash) === "github" ? "GitHub" : "Jira"} site already uses this URL`;
  return errors;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export const sameAddress = (a: Pick<SiteConfig, "baseUrl">, b: Pick<SiteConfig, "baseUrl">): boolean =>
  normalizeBaseUrl(a.baseUrl) === normalizeBaseUrl(b.baseUrl);

export function parseConfig(raw: unknown): DominoConfig {
  return configSchema.parse(raw);
}
