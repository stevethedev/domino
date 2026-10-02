import type { ReactElement } from "react";

/**
 * The Domino mark: three tiles in a cascade, the amber one tipping first (see assets/brand).
 * Shapes come from assets/brand/mark.svg; the blue follows the theme's accent.
 */
export function BrandMark({ size = 20 }: { size?: number }): ReactElement {
  return (
    <svg className="brand-mark" viewBox="-705.8 -418.1 713.8 426.1" height={size} aria-hidden="true" focusable="false">
      <rect transform="rotate(34 -556.8 0)" x="-726.8" y="-380" width="170" height="380" rx="44" fill="var(--brand-amber)" />
      <rect transform="rotate(13 -255.5 0)" x="-425.5" y="-380" width="170" height="380" rx="44" fill="var(--accent)" />
      <rect transform="rotate(0 0.0 0)" x="-170.0" y="-380" width="170" height="380" rx="44" fill="var(--accent)" />
    </svg>
  );
}
