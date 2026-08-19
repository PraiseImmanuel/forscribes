import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdateAndRestart, type UpdateProgress } from "../lib/updater";

// VS Code-style cadence: check shortly after launch (not instantly - let
// the sidecar and UI settle first), then again periodically while the app
// stays open. Update availability is also exposed as a manual "Check for
// updates" trigger from Settings/Dashboard.
const INITIAL_CHECK_DELAY_MS = 5_000;
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export type UpdaterStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "installing"; progress: UpdateProgress | null }
  | { status: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdaterStatus>({ status: "idle" });
  const checkInFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setState({ status: "checking" });
    try {
      const update = await checkForUpdate();
      setState(update ? { status: "available", update } : { status: "up-to-date" });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  const installAndRestart = useCallback(async () => {
    if (state.status !== "available") return;
    const update = state.update;
    setState({ status: "installing", progress: null });
    try {
      await installUpdateAndRestart(update, (progress) => {
        setState({ status: "installing", progress });
      });
      // installUpdateAndRestart() ends by relaunching the app - if we ever
      // get here, the relaunch didn't happen for some reason.
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const initialTimer = window.setTimeout(checkNow, INITIAL_CHECK_DELAY_MS);
    const interval = window.setInterval(checkNow, PERIODIC_CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, checkNow, installAndRestart };
}
