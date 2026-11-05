/** A job waiting for the next animation frame, that can be dropped before it runs. */
export function frameQueue(
  raf: (fn: FrameRequestCallback) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): Readonly<{ queue: (job: () => void) => void; cancel: () => void; waiting: () => boolean }> {
  let frame: number | null = null;
  const cancel = (): void => {
    if (frame !== null) caf(frame);
    frame = null;
  };
  return {
    queue: (job): void => {
      cancel();
      frame = raf(() => {
        frame = null;
        job();
      });
    },
    cancel,
    waiting: (): boolean => frame !== null,
  };
}
