import { describe, expect, it } from "vitest";

/** Every component's source, to check how fields explain themselves. */
const sources = import.meta.glob<string>("../**/*.tsx", { query: "?raw", import: "default", eager: true });

/** The opening tags of `name` elements in JSX source, read up to the `>` outside any `{…}`. */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  for (const m of source.matchAll(new RegExp(String.raw`<${name}\b`, "g"))) {
    let depth = 0;
    let end = m.index + m[0].length;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(m.index, end + 1));
  }
  return tags;
}

describe("field help", () => {
  it("reads the components", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  // A field's explanation is an InfoTip: a title on its label or fieldset only shows on hover.
  it.each(["label", "fieldset"])("puts no title on a <%s>", (name) => {
    const titled = Object.entries(sources).flatMap(([path, source]) =>
      openingTags(source, name)
        .filter((tag) => /\stitle=/.test(tag))
        .map((tag) => `${path}: ${tag.replace(/\s+/g, " ")}`),
    );
    expect(titled).toEqual([]);
  });
});
