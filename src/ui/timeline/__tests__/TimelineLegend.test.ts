import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimelineLegend } from "../TimelineLegend";
import { markupText } from "../../__tests__/markupText";

const text = markupText(renderToStaticMarkup(createElement(TimelineLegend)));

describe("TimelineLegend", () => {
  it("explains the variance badge, which rows only explain on hover", () => {
    expect(text).toContain("+3d / −2d: forecast finish against the estimate, in working days. Due dates are the ◆.");
  });

  it("says what each type letter means", () => {
    expect(text).toContain("E Epic");
    expect(text).toContain("B Bug");
  });
});
