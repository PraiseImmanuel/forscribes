import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Search, FileText } from "lucide-react";
import { listTranscripts, type TranscriptSummary } from "../lib/transcription";
import { ExportPanel } from "../components/ExportPanel";
import type { ExportBlock } from "../lib/export";
import "./Transcribe.css";
import "./Library.css";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

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

export function Library() {
  const [transcripts, setTranscripts] = useState<TranscriptSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      const res = await listTranscripts(search || undefined);
      setTranscripts(res.transcripts);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const exportBlocks: ExportBlock[] = Array.from(selected).map((id) => ({
    type: "content",
    item_type: "transcript",
    item_id: id,
  }));

  return (
    <section className="screen">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="screen-title">Library</h1>
        <p className="screen-subtitle">Every transcript you've made, searchable by title or content.</p>
      </motion.div>

      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search transcripts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ExportPanel
        blocks={exportBlocks}
        itemCount={selected.size}
        defaultTitle="ForScribe export"
      />

      {transcripts === null && <p className="panel-hint">Loading…</p>}

      {transcripts?.length === 0 && (
        <div className="empty-state">
          <FileText size={28} />
          <p>{search ? "No transcripts match that search." : "No transcripts yet — head to Transcribe to make your first one."}</p>
        </div>
      )}

      <ul className="transcript-list">
        {transcripts?.map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
          >
            <div className="transcript-row">
              <input
                type="checkbox"
                className="transcript-row-checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
                aria-label={`Select ${t.title}`}
              />
              <Link to={`/library/${t.id}`} className="transcript-row-link">
                <div className="transcript-row-main">
                  <h3>{t.title}</h3>
                  <p>{t.preview}</p>
                </div>
                <div className="transcript-row-meta">
                  <span>{formatDate(t.created_at)}</span>
                  <span>{formatDuration(t.duration_seconds)}</span>
                </div>
              </Link>
            </div>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
