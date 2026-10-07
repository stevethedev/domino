import type { ReactElement } from "react";
import { orderText, SORT_INFO, type SortBy } from "../graph/sort";
import { Icon } from "./Icon";

/** The Sort by select (in FilterPanel), where focus goes when the chip's ✕ removes the chip. */
export const SORT_SELECT_ID = "sort-by";

/**
 * Says the view is sorted ("Sorted by Priority · Most severe first"), so a remembered sort is
 * never invisible; ✕ returns to the natural order. Nothing while in the natural order.
 */
export function SortChip({ sort, onClear }: { sort: SortBy; onClear: () => void }): ReactElement | null {
  if (sort.key === "natural") return null;
  return (
    <span className="sort-chip" title={`Sorted by ${SORT_INFO[sort.key].label} · ${orderText(sort)}`}>
      <span>
        Sorted by <strong>{SORT_INFO[sort.key].label}</strong> · {orderText(sort)}
      </span>
      <button
        type="button"
        className="sort-chip-clear"
        aria-label="Clear sort"
        title="Back to natural order"
        onClick={() => {
          onClear();
          // The chip goes away with the sort: focus the Sort by select (or nothing, if Display is folded away).
          requestAnimationFrame(() => {
            document.getElementById(SORT_SELECT_ID)?.focus();
          });
        }}
      >
        <Icon name="close" />
      </button>
    </span>
  );
}
