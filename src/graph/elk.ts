import type { ELK } from "elkjs/lib/elk-api.js";

let instance: Promise<ELK> | undefined;

/**
 * The layout engine, created once. In the app it runs in a Web Worker: layout no longer blocks
 * the main thread, and the 1.6 MB engine loads as a separate file instead of in the main bundle.
 * Under Vitest (Node, no workers) it runs in-process; the mode check is a build-time constant,
 * so the in-process copy isn't even emitted in app builds.
 *
 * A failed load or a crashed worker isn't cached: the next layout starts a fresh engine.
 */
export function getElk(): Promise<ELK> {
  instance ??= (
    import.meta.env.MODE === "test"
      ? import("elkjs/lib/elk.bundled.js").then(({ default: Elk }) => new Elk())
      : Promise.all([import("elkjs/lib/elk-api.js"), import("elkjs/lib/elk-worker.min.js?url")]).then(
          ([{ default: Elk }, { default: workerUrl }]) =>
            new Elk({
              workerFactory: (): Worker => {
                const worker = new Worker(workerUrl);
                worker.addEventListener("error", (e) => {
                  console.error("Layout worker failed; restarting on the next layout", e);
                  worker.terminate();
                  instance = undefined;
                });
                return worker;
              },
            }),
        )
  ).catch((e: unknown) => {
    instance = undefined;
    throw e;
  });
  return instance;
}
