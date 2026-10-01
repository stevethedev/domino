/** A type guard for "one of these string literals", e.g. `const isScale = isOneOf(SCALES)`. */
export const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v); // widening to compare; the guard narrows back
