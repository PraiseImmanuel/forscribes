import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Target, Plus } from "lucide-react";
import { listTopicQueries, type TopicQuerySummary } from "../lib/topics";
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

export function TopicList() {
  const [queries, setQueries] = useState<TopicQuerySummary[] | null>(null);

  useEffect(() => {
    listTopicQueries().then((res) => setQueries(res.queries));
  }, []);

  return (
    <section className="screen">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="screen-title">Topic rating</h1>
        <p className="screen-subtitle">
          Define a topic and see how many transcripts relate to it, ranked 1–10.
        </p>
      </motion.div>

      <Link to="/topics/new" className="btn-primary" style={{ alignSelf: "flex-start" }}>
        <Plus size={16} />
        New topic query
      </Link>

      {queries === null && <p className="panel-hint">Loading…</p>}

      {queries?.length === 0 && (
        <div className="empty-state">
          <Target size={28} />
          <p>No topic queries yet — start one above.</p>
        </div>
      )}

      <ul className="transcript-list">
        {queries?.map((q, i) => (
          <motion.li
            key={q.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
          >
            <Link to={`/topics/${q.id}`} className="transcript-row">
              <div className="transcript-row-main">
                <h3>{q.name || "Untitled topic query"}</h3>
              </div>
              <div className="transcript-row-meta">
                <span>{formatDate(q.created_at)}</span>
                <span>threshold {q.relevance_threshold}</span>
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
