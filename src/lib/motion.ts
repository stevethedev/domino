/** Whether the viewer asked the OS for reduced motion (animations should snap instead). */
export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
