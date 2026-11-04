import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { orderText, SORT_INFO } from "../../graph/sort";
import { SortChip } from "../SortChip";

describe("SortChip", () => {
  // The chip's text is cut off with "…" when the sidebar is narrow: its title keeps the whole of it.
  it("keeps the full sort in its title, since its text can be cut off", () => {
    const sort = { key: "priority", reversed: false } as const;
    const out = renderToStaticMarkup(createElement(SortChip, { sort, onClear: () => undefined }));
    expect(out).toContain(`<span class="sort-chip" title="Sorted by ${SORT_INFO.priority.label} · ${orderText(sort)}">`);
  });
});
