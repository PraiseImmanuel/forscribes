import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { checkHealth, type HealthResponse } from "../lib/sidecar";
import { FeatureGrid } from "../components/FeatureGrid";
import { useUpdater } from "../hooks/useUpdater";
import { getUnhealthyLaunchCount, markLaunchHealthy } from "../lib/launchHealth";

// Mirrors UNHEALTHY_LAUNCH_WARNING_THRESHOLD in src-tauri/src/lib.rs.
const UNHEALTHY_LAUNCH_WARNING_THRESHOLD = 3;
const RELEASES_URL = "https://github.com/PraiseImmanuel/forscribes/releases";

type SidecarState =
  | { kind: "connecting" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export function Dashboard() {
  const [sidecar, setSidecar] = useState<SidecarState>({ kind: "connecting" });
  const [version, setVersion] = useState<string>("");
  const [unhealthyCount, setUnhealthyCount] = useState(0);
  const { state: updateState, checkNow, installAndRestart } = useUpdater();

  useEffect(() => {
    // Defensive .catch()s: these only ever fail if the app-data directory
    // is unwritable or similar - rare, but should degrade quietly rather
    // than surface as an unhandled promise rejection.
    getVersion()
      .then(setVersion)
      .catch(() => {});
    getUnhealthyLaunchCount()
      .then(setUnhealthyCount)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function waitForSidecar() {
      // The sidecar is a PyInstaller --onefile bundle: every launch, a
      // bootloader process first re-extracts the whole ~150MB bundle (plus
      // heavy ML libs) to a temp folder before the real server process
      // even starts. Measured at 40+ seconds on this project's reference
      // hardware (dual-core, HDD) - the old 10s window here gave up while
      // the sidecar was still legitimately starting, which is what was
      // actually behind the "model list stays empty" report, not a quick
      // hiccup this length of retry could paper over.
      const maxAttempts = 180; // 180 x 500ms = 90s
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const data = await checkHealth();
          if (!cancelled) setSidecar({ kind: "ok", data });
          // A confirmed sidecar connection is our definition of "this
          // launch worked" - reset the unhealthy-streak counter so the
          // rollback warning doesn't fire on a run that's actually fine.
          // Not awaited (no need to block on it), but still needs a .catch -
          // an un-awaited rejection here would otherwise bypass the try/catch
          // this call sits inside.
          markLaunchHealthy().catch(() => {});
          return;
        } catch {
          if (attempt === maxAttempts) {
            if (!cancelled) {
              setSidecar({
                kind: "error",
                message: "Could not reach the local sidecar after 90s.",
              });
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    waitForSidecar();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {unhealthyCount >= UNHEALTHY_LAUNCH_WARNING_THRESHOLD && (
        <motion.div
          className="rollback-warning"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertTriangle size={15} />
          <span>
            ForScribe hasn't started cleanly the last {unhealthyCount} times. If this started
            after an update, you can download the previous version from{" "}
            <button className="link-inline" onClick={() => openUrl(RELEASES_URL)}>
              GitHub Releases
            </button>{" "}
            and reinstall it.
          </span>
        </motion.div>
      )}

      <section className="hero">
        <motion.h1
          className="hero-title"
          initial="hidden"
          animate="show"
          custom={0.05}
          variants={fadeUp}
        >
          Turn years of voice memos
          <br />
          into <span className="gradient-text">your next book</span>.
        </motion.h1>

        <motion.p
          className="hero-subtitle"
          initial="hidden"
          animate="show"
          custom={0.15}
          variants={fadeUp}
        >
          Transcribe, group by topic, and rate relevance — all offline, all
          on your machine.
        </motion.p>

        <motion.div
          className={`status-pill status-${sidecar.kind}`}
          initial="hidden"
          animate="show"
          custom={0.25}
          variants={fadeUp}
        >
          <span className="status-dot" />
          {sidecar.kind === "connecting" && (
            <span>Connecting to local engine… (can take up to a minute each time ForScribe starts)</span>
          )}
          {sidecar.kind === "ok" && <span>Local engine connected</span>}
          {sidecar.kind === "error" && <span>{sidecar.message}</span>}
        </motion.div>

        {sidecar.kind === "ok" && (
          <motion.p
            className="db-path"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            {sidecar.data.db_path}
          </motion.p>
        )}
      </section>

      <FeatureGrid />

      <footer className="page-footer">
        <span>ForScribe{version ? ` v${version}` : ""}</span>
        <span className="footer-dot">·</span>
        <span>Runs fully offline. Nothing here leaves your machine.</span>
        <span className="footer-dot">·</span>
        {updateState.status === "idle" || updateState.status === "checking" ? (
          <button className="footer-link-btn" onClick={checkNow} disabled={updateState.status === "checking"}>
            <RefreshCw size={11} className={updateState.status === "checking" ? "spin" : ""} />
            {updateState.status === "checking" ? "Checking…" : "Check for updates"}
          </button>
        ) : updateState.status === "up-to-date" ? (
          <span>You're up to date</span>
        ) : updateState.status === "available" ? (
          <button className="footer-link-btn" onClick={installAndRestart}>
            Update to v{updateState.update.version} available — install
          </button>
        ) : updateState.status === "installing" ? (
          <span>Installing update…</span>
        ) : (
          <button className="footer-link-btn" onClick={checkNow}>
            Update check failed — retry
          </button>
        )}
      </footer>
    </>
  );
}
