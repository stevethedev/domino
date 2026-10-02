import type { ReactElement } from "react";

/**
 * Domino's icon set: one 24px grid, 2px round strokes, `currentColor`, so icons inherit the text
 * colour and size with the surrounding type. Decorative by default (the control carries the label).
 */
const PATHS = {
  settings: (
    <>
      <path d="M19.26 9.75 L21.86 10.31 L21.86 13.69 L19.26 14.25 L18.72 15.55 L20.17 17.77 L17.77 20.17 L15.55 18.72 L14.25 19.26 L13.69 21.86 L10.31 21.86 L9.75 19.26 L8.45 18.72 L6.23 20.17 L3.83 17.77 L5.28 15.55 L4.74 14.25 L2.14 13.69 L2.14 10.31 L4.74 9.75 L5.28 8.45 L3.83 6.23 L6.23 3.83 L8.45 5.28 L9.75 4.74 L10.31 2.14 L13.69 2.14 L14.25 4.74 L15.55 5.28 L17.77 3.83 L20.17 6.23 L18.72 8.45Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  alert: (
    <>
      <path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = "1em", className }: { name: IconName; size?: number | string; className?: string }): ReactElement {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
