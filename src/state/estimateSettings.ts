import { isScale, type Scale } from "../ui/timeline/timelineLayout";

/** Estimate and timeline preferences, shared by the Timeline and aging (remembered per viewer). */
export type EstimateSettings = { scale: Scale; daysPerPoint: number; defaultDays: number; planStart: string | null };

export const ESTIMATE_SETTINGS_KEY = "domino.timeline";
export const DEFAULT_ESTIMATE_SETTINGS: EstimateSettings = { scale: "week", daysPerPoint: 1, defaultDays: 2, planStart: null };

/** Validates stored settings field by field, keeping defaults for anything invalid. */
export function parseEstimateSettings(raw: unknown): EstimateSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r: Record<string, unknown> = { ...raw };
  const positive = (v: unknown, d: number): number => (typeof v === "number" && v > 0 ? v : d);
  const d = DEFAULT_ESTIMATE_SETTINGS;
  return {
    scale: typeof r.scale === "string" && isScale(r.scale) ? r.scale : d.scale,
    daysPerPoint: positive(r.daysPerPoint, d.daysPerPoint),
    defaultDays: positive(r.defaultDays, d.defaultDays),
    planStart: typeof r.planStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.planStart) ? r.planStart : null,
  };
}
