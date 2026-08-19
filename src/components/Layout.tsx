import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { useTranscriptionJob } from "../context/TranscriptionJobContext";
import { ThemeToggle } from "./ThemeToggle";
import { UpdateBanner } from "./UpdateBanner";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transcribe", label: "Transcribe" },
  { to: "/library", label: "Library" },
  { to: "/group", label: "Group" },
  { to: "/topics", label: "Topics" },
];

export function Layout() {
  const { theme, toggle } = useTheme();
  const { job } = useTranscriptionJob();
  const location = useLocation();

  const showJobPill = Boolean(job) && location.pathname !== "/transcribe";
  const doneCount = job?.files.filter((f) => f.status === "done" || f.status === "error").length ?? 0;
  const totalCount = job?.files.length ?? 0;
  const jobFailed = job?.status === "error";

  return (
    <div className="page">
      <div className="ambient-glow" aria-hidden="true" />

      <UpdateBanner />

      <header className="topbar">
        <motion.div
          className="brand"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="brand-mark">FS</span>
          <span className="brand-name">ForScribe</span>
        </motion.div>

        <nav className="top-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `top-nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <NavLink
          to="/transcribe"
          className={`job-pill${showJobPill ? " visible" : ""}`}
          tabIndex={showJobPill ? 0 : -1}
        >
          {job?.status === "running" ? (
            <Loader2 size={14} className="spin" />
          ) : jobFailed ? (
            <XCircle size={14} className="text-error" />
          ) : (
            <CheckCircle2 size={14} className="text-success" />
          )}
          <span>
            {job?.status === "running" ? "Transcribing" : "Transcription done"} {doneCount}/{totalCount}
          </span>
        </NavLink>

        <ThemeToggle theme={theme} onToggle={toggle} />
      </header>

      <Outlet />
    </div>
  );
}
