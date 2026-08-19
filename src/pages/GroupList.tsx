import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Waypoints, Plus } from "lucide-react";
import { listGroupingSessions, type GroupingSessionSummary } from "../lib/grouping";
import "./Transcribe.css";
import "./Library.css";

function formatDate(iso: string): string {
  try {
    return new Date(iso + "Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function GroupList() {
  const [sessions, setSessions] = useState<GroupingSessionSummary[] | null>(null);

  useEffect(() => {
    listGroupingSessions().then((res) => setSessions(res.sessions));
  }, []);

  return (
    <section className="screen">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="screen-title">Auto-grouping</h1>
        <p className="screen-subtitle">
          Pick a set of transcripts and cluster them by what they're actually about.
        </p>
      </motion.div>

      <Link to="/group/new" className="btn-primary" style={{ alignSelf: "flex-start" }}>
        <Plus size={16} />
        New grouping session
      </Link>

      {sessions === null && <p className="panel-hint">Loading…</p>}

      {sessions?.length === 0 && (
        <div className="empty-state">
          <Waypoints size={28} />
          <p>No grouping sessions yet — start one above.</p>
        </div>
      )}

      <ul className="transcript-list">
        {sessions?.map((s, i) => (
          <motion.li
            key={s.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
          >
            <Link to={`/group/${s.id}`} className="transcript-row">
              <div className="transcript-row-main">
                <h3>{s.name}</h3>
              </div>
              <div className="transcript-row-meta">
                <span>{formatDate(s.updated_at)}</span>
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
