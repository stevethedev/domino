import { z } from "zod";
import type { DominoConfig, SiteConfig } from "./types";

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

const authSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("apiToken"),
    email: z.string().min(1, "Required").pipe(z.email("Must be an email address")),
    secretRef: z
      .string()
      .min(1, "Required")
      .regex(/^[A-Z][A-Z0-9_]*$/, "Uppercase letters, digits and underscores, e.g. DOMINO_ACME_TOKEN")
      // Where the ticket cache keeps its key (src-tauri/src/cache.rs): a token there would clobber it.
      .refine((ref) => ref !== "DOMINO_CACHE_KEY", "DOMINO_CACHE_KEY is reserved by Domino; pick another name"),
  }),
  z.object({ type: z.literal("oauth3lo") }),
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
  label: z.string().trim().min(1, "Required").max(40, "At most 40 characters"),
  baseUrl: httpsUrl,
  cloudId: z.string().optional(),
  auth: authSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex color like #7c3aed"),
  enabled: z.boolean(),
  baseJql: z.string().optional(),
});

export const siteSchema = z.preprocess(migrateSite, siteShape);

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
  if (!errors.baseUrl && others.some((o) => normalizeBaseUrl(o.baseUrl) === normalizeBaseUrl(site.baseUrl))) {
    errors.baseUrl = "Another site already uses this URL";
  }
  return errors;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function parseConfig(raw: unknown): DominoConfig {
  return configSchema.parse(raw);
}
