import { AnimatePresence, motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";
import { useUpdater } from "../hooks/useUpdater";
import "./UpdateBanner.css";

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function UpdateBanner() {
  const { state, installAndRestart } = useUpdater();

  const visible = state.status === "available" || state.status === "installing";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="update-banner"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
        >
          {state.status === "available" && (
            <>
              <Download size={14} />
              <span>Version {state.update.version} is ready to install.</span>
              <button className="update-banner-btn" onClick={installAndRestart}>
                Restart &amp; update
              </button>
            </>
          )}
          {state.status === "installing" && (
            <>
              <RefreshCw size={14} className="spin" />
              <span>
                Installing update…
                {state.progress?.total
                  ? ` ${formatBytes(state.progress.downloaded)} / ${formatBytes(state.progress.total)}`
                  : ""}
              </span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
