/** A job waiting for the next animation frame, that can be dropped before it runs. */
export function frameQueue(
  raf: (fn: FrameRequestCallback) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): Readonly<{ queue: (job: () => void) => void; cancel: () => void }> {
  let waiting: number | null = null;
  const cancel = (): void => {
    if (waiting !== null) caf(waiting);
    waiting = null;
  };
  return {
    queue: (job): void => {
      cancel();
      waiting = raf(() => {
        waiting = null;
        job();
      });
    },
    cancel,
  };
}
