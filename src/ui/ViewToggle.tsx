import type { ReactElement } from "react";
import { isOneOf } from "../lib/guards";

export type ViewMode = "graph" | "timeline";
const MODES: readonly ViewMode[] = ["graph", "timeline"];
export const isViewMode = isOneOf(MODES);

const LABELS: Record<ViewMode, string> = { graph: "Graph", timeline: "Timeline" };

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }): ReactElement {
  return (
    <fieldset className="segmented">
      <legend className="sr-only">View</legend>
      {MODES.map((m) => (
        <label key={m} className={value === m ? "active" : ""} title={`${LABELS[m]} (${m[0]})`}>
          <input
            type="radio"
            name="view-mode"
            value={m}
            checked={value === m}
            onChange={() => {
              onChange(m);
            }}
          />
          {LABELS[m]}
        </label>
      ))}
    </fieldset>
  );
}
