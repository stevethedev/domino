import { isHighlight, isHighlightScope } from "../graph/insights";
import type { Scope } from "../data/MultiSiteLoader";
import type { StatusCategory } from "../graph/types";
import { NO_ISSUE_FILTERS, type IssueFilters } from "../graph/visible";
import { isOneOf } from "../lib/guards";
import { isGroupBy, type Filters, type ViewOptions } from "../ui/Canvas";
import { isViewMode, type ViewMode } from "../ui/ViewToggle";

/** A named combination of scope and view settings, remembered per viewer. */
export type SavedView = {
  name: string;
  siteIds: string[];
  scope: Scope;
  filters: Filters;
  view: ViewOptions;
  mode: ViewMode;
};

export const SAVED_VIEWS_KEY = "domino.savedViews";
const MAX_SAVED_VIEWS = 30;

const str = (v: unknown): v is string => typeof v === "string";
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const record = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" ? { ...v } : undefined);

function parseScope(raw: unknown): Scope | undefined {
  const r = record(raw);
  if (!r) return undefined;
  if (r.mode === "jql" && str(r.jql)) return { mode: "jql", jql: r.jql };
  if (r.mode === "epic" && str(r.siteId) && str(r.key)) return { mode: "epic", siteId: r.siteId, key: r.key };
  if (r.mode === "seed" && str(r.siteId) && str(r.key) && typeof r.depth === "number")
    return { mode: "seed", siteId: r.siteId, key: r.key, depth: r.depth };
  return undefined;
}

const CATEGORIES: readonly StatusCategory[] = ["todo", "inprogress", "done", "unknown"];
const isCategory = isOneOf(CATEGORIES);
const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter(str) : []);

/** Views saved before issue filters existed (or with malformed ones) show every issue. */
function parseIssueFilters(raw: unknown): IssueFilters {
  const r = record(raw);
  if (!r) return NO_ISSUE_FILTERS;
  return {
    hiddenCategories: strings(r.hiddenCategories).filter(isCategory),
    hiddenTypes: strings(r.hiddenTypes),
    hiddenAssignees: strings(r.hiddenAssignees),
  };
}

function parseView(raw: unknown): SavedView | undefined {
  const r = record(raw);
  const scope = parseScope(r?.scope);
  const f = record(r?.filters);
  const v = record(r?.view);
  if (!r || !scope || !f || !v || !str(r.name) || !r.name.trim() || !Array.isArray(r.siteIds)) return undefined;
  if (!bool(f.blocks) || !bool(f.relates) || !bool(f.duplicates) || !bool(f.crossSite)) return undefined;
  if (!str(v.groupBy) || !isGroupBy(v.groupBy) || !str(v.highlight) || !isHighlight(v.highlight)) return undefined;
  if (!str(r.mode) || !isViewMode(r.mode)) return undefined;
  return {
    name: r.name.trim(),
    siteIds: r.siteIds.filter(str),
    scope,
    filters: {
      blocks: f.blocks,
      relates: f.relates,
      duplicates: f.duplicates,
      crossSite: f.crossSite,
      issues: parseIssueFilters(f.issues),
      // Views saved before implied links were simplified get the new default.
      hideImplied: bool(f.hideImplied) ? f.hideImplied : true,
    },
    view: {
      groupBy: v.groupBy,
      highlight: v.highlight,
      // Views saved before scoped highlights existed highlight everyone's issues.
      highlightScope: str(v.highlightScope) && isHighlightScope(v.highlightScope) ? v.highlightScope : "all",
      collapseEpics: bool(v.collapseEpics) ? v.collapseEpics : false,
    },
    mode: r.mode,
  };
}

/** Stored views, validated one by one; invalid entries are dropped rather than failing the list. */
export function parseSavedViews(raw: unknown): SavedView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((v) => parseView(v) ?? []).slice(0, MAX_SAVED_VIEWS);
}

/** Adds a view, replacing one with the same name (case-insensitive), newest first. */
export function upsertView(views: readonly SavedView[], view: SavedView): SavedView[] {
  const key = view.name.trim().toLowerCase();
  return [view, ...views.filter((v) => v.name.toLowerCase() !== key)].slice(0, MAX_SAVED_VIEWS);
}
