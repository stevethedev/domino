import type { RawLinkType } from "../data/jiraTypes";
import type { LinkKind } from "./types";

/** Jira's built-in link types, used when a site's list is unavailable. */
export const DEFAULT_LINK_TYPES: RawLinkType[] = [
  { id: "blocks", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "relates", name: "Relates", inward: "relates to", outward: "relates to" },
  { id: "duplicate", name: "Duplicate", inward: "is duplicated by", outward: "duplicates" },
  { id: "cloners", name: "Cloners", inward: "is cloned by", outward: "clones" },
];

export function kindOf(type: Pick<RawLinkType, "name" | "outward">): LinkKind {
  const n = `${type.name} ${type.outward}`.toLowerCase();
  if (/\bblock/.test(n)) return "blocks";
  if (/duplicat|clone/.test(n)) return "duplicates";
  return "relates";
}

/** Symmetric kinds have no meaningful direction, so dedup ignores it. */
const isSymmetric = (t: Pick<RawLinkType, "inward" | "outward">): boolean =>
  t.inward.trim().toLowerCase() === t.outward.trim().toLowerCase();

export type ResolvedRelationship = {
  kind: LinkKind;
  linkType: string; // outward verb
  /** True when the relationship was phrased from the inward side ("is blocked by"): source/target swap. */
  inward: boolean;
  symmetric: boolean;
};

const RELATES: ResolvedRelationship = { kind: "relates", linkType: "relates to", inward: false, symmetric: true };

/** Maps a remote link's free-text `relationship` onto a known link type, or falls back to "relates to". */
export function resolveRelationship(
  relationship: string | undefined,
  linkTypes: readonly RawLinkType[],
): ResolvedRelationship {
  const rel = relationship?.trim().toLowerCase();
  if (!rel) return RELATES;
  for (const t of [...linkTypes, ...DEFAULT_LINK_TYPES]) {
    const base = { kind: kindOf(t), linkType: t.outward.toLowerCase(), symmetric: isSymmetric(t) };
    if (t.outward.toLowerCase() === rel) return { ...base, inward: false };
    if (t.inward.toLowerCase() === rel) return { ...base, inward: !base.symmetric };
  }
  return RELATES;
}
