import "react";

declare module "react" {
  interface CSSProperties {
    /** Site accent color consumed by .chip, .dot, .site-badge and .site-group styles. */
    "--site"?: string;
  }
}
