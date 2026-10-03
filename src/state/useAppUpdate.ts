import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../data/errors";
import { checkForUpdate, type AvailableUpdate } from "../platform";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  /** Checked, and this is the newest version. */
  | { status: "current" }
  | { status: "available"; update: AvailableUpdate }
  /** `progress` is 0..1, or null while the download size is unknown. */
  | { status: "installing"; update: AvailableUpdate; progress: number | null }
  /** `update` is set when the install failed (it can be retried); unset when the check failed. */
  | { status: "failed"; message: string; update?: AvailableUpdate };

/** First automatic check: soon after launch, but not competing with the first load. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

export type AppUpdate = Readonly<{
  state: UpdateState;
  /** Checks now. */
  check: () => void;
  /** Downloads and installs the available update, then restarts. */
  install: () => void;
}>;

/**
 * In-app updates: checks the release feed shortly after launch and every few hours while
 * `autoCheck` is on, and on demand. A failed automatic check stays quiet (the network may simply
 * be down); a failed manual check or install is reported.
 */
export function useAppUpdate(autoCheck: boolean): AppUpdate {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const busy = useRef(false);

  const run = useCallback((manual: boolean) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setState({ status: "checking" });
    checkForUpdate().then(
      (update) => {
        busy.current = false;
        setState(update ? { status: "available", update } : { status: "current" });
      },
      (e: unknown) => {
        busy.current = false;
        if (manual) setState({ status: "failed", message: `Couldn't check for updates: ${errorMessage(e)}` });
      },
    );
  }, []);

  useEffect(() => {
    if (!autoCheck) return;
    const first = setTimeout(() => {
      run(false);
    }, FIRST_CHECK_MS);
    const every = setInterval(() => {
      run(false);
    }, CHECK_EVERY_MS);
    return (): void => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [autoCheck, run]);

  const install = (): void => {
    const update = state.status === "available" || (state.status === "failed" && state.update) ? state.update : undefined;
    if (!update || busy.current) return;
    busy.current = true;
    setState({ status: "installing", update, progress: 0 });
    update
      .install((progress) => {
        setState({ status: "installing", update, progress });
      })
      .catch((e: unknown) => {
        // Installing restarts the app on success, so only a failure lands here.
        busy.current = false;
        setState({ status: "failed", message: `The update didn't install: ${errorMessage(e)}`, update });
      });
  };

  return {
    state,
    check: () => {
      run(true);
    },
    install,
  };
}
