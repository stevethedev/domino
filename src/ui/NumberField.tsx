import { useEffect, useState, type ReactElement } from "react";

/**
 * A number input that keeps what you type (e.g. "0." on the way to "0.5") and only commits
 * values that are valid; on blur it shows the committed value again.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max = Number.POSITIVE_INFINITY,
  step,
  integer = false,
  ...rest
}: {
  value: number;
  onCommit: (n: number) => void;
  /** Smallest committed value (inclusive). */
  min: number;
  /** Largest committed value (inclusive). */
  max?: number;
  step: number;
  integer?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "step" | "type">): ReactElement {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) onCommit(n);
      }}
      onBlur={() => {
        setDraft(String(value));
      }}
    />
  );
}
