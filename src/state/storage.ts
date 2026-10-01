import { useCallback, useState } from "react";

// Per-viewer preferences in localStorage. Storage can be unavailable (private mode, blocked
// site data), so every access is guarded and the app always works with the fallback.

/** Reads `key` and validates it with `parse`; anything missing or invalid yields `fallback`. */
export function readStored<T>(key: string, parse: (raw: unknown) => T | undefined, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    if (text === null) return fallback;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = text; // values written before preferences were JSON-encoded
    }
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* preferences are a convenience; losing one is fine */
  }
}

/** `useState` that persists to `key`. */
export function usePersistentState<T>(key: string, parse: (raw: unknown) => T | undefined, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => readStored(key, parse, fallback));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(key, next);
    },
    [key],
  );
  return [value, set];
}

/** Parser for a string preference restricted by a type guard. */
export const oneOf =
  <T extends string>(guard: (v: string) => v is T) =>
  (raw: unknown): T | undefined =>
    typeof raw === "string" && guard(raw) ? raw : undefined;
