import "react";

declare module "react" {
  interface CSSProperties {
    /** Site accent color consumed by .chip, .dot, .site-badge and .site-group styles. */
    "--site"?: string;
    /** Timeline release flags: header lines in use (.tl-axis) and this flag's line (.tl-release-flag). */
    "--release-lines"?: number;
    "--line"?: number;
  }
}
