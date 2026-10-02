/** A type guard for "one of these string literals", e.g. `const isScale = isOneOf(SCALES)`. */
export const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v); // widening to compare; the guard narrows back

/** For values the caller knows are present: a missing one is a bug, so it throws instead of flowing on as undefined. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be defined`);
  return value;
}

/** `map.get(key)` for keys the caller knows are in the map (see `defined`). */
export function getOrThrow<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Expected map entry ${String(key)} to be defined`); // message built only on failure (hot loops)
  return value;
}
