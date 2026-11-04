import { describe, expect, it } from "vitest";
import css from "../tokens.css?raw";

type Rgb = readonly [r: number, g: number, b: number];
type Tokens = ReadonlyMap<string, string>;

/** The `--name: value;` declarations in a block of CSS. */
const declarations = (block: string): Map<string, string> =>
  new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light: Tokens = declarations(css.slice(0, darkStart));
const dark: Tokens = new Map([...light, ...declarations(css.slice(darkStart))]);

const hex = (h: string): Rgb => {
  const s = h.length === 4 ? h.slice(1).replace(/./g, "$&$&") : h.slice(1);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/** A token's colour: hex, another token, or `color-mix(in srgb, A N%, B)`. */
function color(tokens: Tokens, value: string): Rgb {
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const name = ref[1];
    const next = tokens.get(name);
    if (next === undefined) throw new Error(`missing ${name}`);
    return color(tokens, next);
  }
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v)) return hex(v);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const [a, b, p] = [color(tokens, mix[1]), color(tokens, mix[3]), Number(mix[2]) / 100];
    const at = (i: 0 | 1 | 2): number => a[i] * p + b[i] * (1 - p);
    return [at(0), at(1), at(2)];
  }
  throw new Error(`can't read colour "${v}"`);
}

/** WCAG 2 relative luminance and contrast ratio. */
const channel = (x: number): number => {
  const s = x / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (tokens: Tokens, fg: string, bg: string): number => {
  const a = luminance(color(tokens, `var(${fg})`));
  const b = luminance(color(tokens, `var(${bg})`));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const TEXT = 4.5;
const EDGE = 3;
const PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ...["--type-default", "--type-story", "--type-task", "--type-bug"].map((t) => ["--on-type", t, TEXT] as const),
  ["--on-type-epic", "--type-epic", TEXT],
  ["--link", "--surface", TEXT],
  ["--link", "--surface-2", TEXT],
  ["--done-fg", "--surface", TEXT],
  ["--muted", "--surface-2", TEXT],
  ["--critical-fg", "--critical-bg", TEXT],
  ["--text", "--selected-bg", TEXT],
  ["--border-control", "--bg", EDGE],
  ["--border-control", "--surface", EDGE],
  ["--border-control", "--surface-2", EDGE],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("tokens in the %s theme", (_theme, tokens) => {
  it.each(PAIRS)("%s on %s reaches %s:1", (fg, bg, min) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
