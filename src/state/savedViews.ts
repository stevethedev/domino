import { isHighlight, isHighlightScope } from "../graph/insights";
import type { Scope } from "../data/MultiSiteLoader";
import type { StatusCategory } from "../graph/types";
import { NO_ISSUE_FILTERS, type IssueFilters } from "../graph/visible";
import { isOneOf } from "../lib/guards";
import { isGroupBy, type Filters, type ViewOptions } from "../ui/Canvas";
import { isViewMode, type ViewMode } from "../ui/ViewToggle";

/**
 * Which epics a view folds, saved while it groups by epic: every epic in the scope ("all", so
 * epics added later fold too), or exactly these epic uids (an empty list unfolds them all).
 */
export type EpicFolds = "all" | readonly string[];

/** A named combination of scope and view settings, remembered per viewer. */
export type SavedView = {
  name: string;
  siteIds: string[];
  scope: Scope;
  filters: Filters;
  view: ViewOptions;
  mode: ViewMode;
  /** Absent for views saved while not grouped by epic (or before folds were saved): applying leaves folds alone. */
  epicFolds?: EpicFolds;
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
    hiddenPriorities: strings(r.hiddenPriorities),
  };
}

function parseEpicFolds(raw: unknown, legacyEpicMap: boolean): EpicFolds | undefined {
  if (raw === "all") return "all";
  if (Array.isArray(raw)) return raw.filter(str);
  // The old epic map folded every epic.
  return legacyEpicMap ? "all" : undefined;
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
  const epicFolds = parseEpicFolds(r.epicFolds, v.collapseEpics === true);
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
      // Views saved with the old epic map open now group by epic, where lanes fold into epics.
      groupBy: v.collapseEpics === true ? "epic" : v.groupBy,
      highlight: v.highlight,
      // Views saved before scoped highlights existed highlight everyone's issues.
      highlightScope: str(v.highlightScope) && isHighlightScope(v.highlightScope) ? v.highlightScope : "all",
    },
    mode: r.mode,
    // Absent stays absent, so views without folds round-trip unchanged.
    ...(epicFolds === undefined ? {} : { epicFolds }),
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

/** The shareable file: a small envelope so other JSON isn't mistaken for views. */
const FILE_FORMAT = "domino.savedViews";

export const viewsFile = (views: readonly SavedView[]): string => JSON.stringify({ format: FILE_FORMAT, version: 1, views }, null, 2);

/**
 * Views from a shared file (the envelope above, or a bare list), each validated like stored views;
 * invalid entries are dropped. Throws a readable error when the file holds no usable views.
 */
export function readViewsFile(text: string): SavedView[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON.");
  }
  const r = record(raw);
  const list = Array.isArray(raw) ? raw : r?.format === FILE_FORMAT ? r.views : undefined;
  const views = parseSavedViews(list);
  if (!views || views.length === 0) throw new Error("That file doesn't contain Domino saved views.");
  return views;
}

/** Adds imported views to the current ones; an imported view replaces one with the same name. */
export const mergeViews = (current: readonly SavedView[], imported: readonly SavedView[]): SavedView[] =>
  [...imported].reverse().reduce<SavedView[]>((acc, v) => upsertView(acc, v), [...current]);
