import type { Options } from "modern-screenshot";
import type { Capture } from "./ExportMenu";

/** WebKit (Tauri on macOS) caps a canvas at about 16.7 million pixels; stay under it. */
const MAX_CANVAS_PIXELS = 16_000_000;
const PNG_SCALE = 2; // sharp on high-DPI screens

/** The theme background, so exports aren't transparent (and read right in dark mode). */
const background = (): string => getComputedStyle(document.body).backgroundColor;

/** The CSS-pixel size to render at, plus styles applied to the copy (not the live page). */
export type CaptureSize = Readonly<{ width: number; height: number; style?: Partial<CSSStyleDeclaration> }>;

/**
 * A capture of `el` rendered at the size `size` gives for it. `prepare` runs before each render
 * (it may wait for React to re-render) and returns a cleanup for after, for temporary changes the
 * export needs.
 */
export function captureElement(
  el: () => HTMLElement | null,
  size: (node: HTMLElement) => CaptureSize,
  prepare: () => Promise<() => void> | (() => void) = () => () => undefined,
): Capture {
  const render = async <T>(draw: (node: HTMLElement, options: Options) => Promise<T>, scale: number): Promise<T> => {
    const node = el();
    if (!node) throw new Error("Nothing to export yet");
    const cleanup = await prepare();
    try {
      const { width, height, style } = size(node);
      const fit = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)));
      return await draw(node, { width, height, style, scale: fit, backgroundColor: background() });
    } finally {
      cleanup();
    }
  };
  // The renderer loads on first export, so it stays out of the startup bundle.
  return {
    png: () =>
      render(async (node, options) => {
        const { domToBlob } = await import("modern-screenshot");
        return domToBlob(node, { ...options, type: "image/png" });
      }, PNG_SCALE),
    svg: () =>
      render(async (node, options) => {
        const { domToForeignObjectSvg } = await import("modern-screenshot");
        return new XMLSerializer().serializeToString(await domToForeignObjectSvg(node, options));
      }, 1),
  };
}
