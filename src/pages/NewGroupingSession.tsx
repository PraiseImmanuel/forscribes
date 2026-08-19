import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Search, Upload, X } from "lucide-react";
import { listTranscripts, type TranscriptSummary } from "../lib/transcription";
import { uploadDocument, createGroupingSession, type WorkingSetItemType } from "../lib/grouping";
import "./Transcribe.css";
import "./Library.css";

interface WorkingSetEntry {
  item_type: WorkingSetItemType;
  item_id: number;
  title: string;
}

export function NewGroupingSession() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TranscriptSummary[]>([]);
  const [workingSet, setWorkingSet] = useState<WorkingSetEntry[]>([]);
  const [granularity, setGranularity] = useState(0.5);
  const [sessionName, setSessionName] = useState(
    `Grouping — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
  );
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      const res = await listTranscripts(search || undefined);
      setResults(res.transcripts);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  const inSet = (type: WorkingSetItemType, id: number) =>
    workingSet.some((w) => w.item_type === type && w.item_id === id);

  function toggleTranscript(t: TranscriptSummary) {
    setWorkingSet((prev) =>
      inSet("transcript", t.id)
        ? prev.filter((w) => !(w.item_type === "transcript" && w.item_id === t.id))
        : [...prev, { item_type: "transcript", item_id: t.id, title: t.title }],
    );
  }

  function removeFromSet(type: WorkingSetItemType, id: number) {
    setWorkingSet((prev) => prev.filter((w) => !(w.item_type === type && w.item_id === id)));
  }

  async function uploadDocuments() {
    setError(null);
    const selected = await open({
      multiple: true,
      filters: [{ name: "Documents", extensions: ["txt", "md", "docx"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setUploading(true);
    try {
      for (const path of paths) {
        const doc = await uploadDocument(path, "grouping_upload");
        setWorkingSet((prev) => [
          ...prev,
          { item_type: "document", item_id: doc.id, title: doc.original_filename },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function startGrouping() {
    if (workingSet.length < 2) {
      setError("Add at least 2 items — grouping needs something to compare.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const session = await createGroupingSession(
        sessionName,
        workingSet.map(({ item_type, item_id }) => ({ item_type, item_id })),
        granularity,
      );
      navigate(`/group/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="screen">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="screen-title">New grouping session</h1>
        <p className="screen-subtitle">
          Add transcripts from your library and/or upload documents, then cluster them by content.
        </p>
      </motion.div>

      <div className="panel">
        <h3 className="panel-title">Session name</h3>
        <input
          className="model-select"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
        />
      </div>

      <div className="panel">
        <div className="panel-row">
          <h3 className="panel-title" style={{ flex: 1 }}>Add from Library</h3>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search transcripts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="file-list">
          {results.map((t) => (
            <li key={t.id} className="file-row" style={{ cursor: "pointer" }} onClick={() => toggleTranscript(t)}>
              <input type="checkbox" checked={inSet("transcript", t.id)} readOnly />
              <span className="file-name">{t.title}</span>
            </li>
          ))}
          {results.length === 0 && <p className="panel-hint">No transcripts match.</p>}
        </ul>
      </div>

      <div className="panel">
        <div className="panel-row">
          <button className="btn-secondary" onClick={uploadDocuments} disabled={uploading}>
            <Upload size={16} />
            {uploading ? "Uploading…" : "Upload documents"}
          </button>
          <span className="panel-hint">.txt, .md, .docx</span>
        </div>
      </div>

      {workingSet.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">Working set ({workingSet.length})</h3>
          <ul className="file-list">
            {workingSet.map((w) => (
              <li key={`${w.item_type}-${w.item_id}`} className="file-row">
                <span className="file-name">
                  {w.item_type === "document" ? "📄 " : ""}
                  {w.title}
                </span>
                <button className="icon-btn" onClick={() => removeFromSet(w.item_type, w.item_id)} aria-label="Remove">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Granularity</h3>
        <p className="panel-hint">Lower = many small, tightly-related groups. Higher = fewer, broader groups.</p>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={granularity}
          onChange={(e) => setGranularity(Number(e.target.value))}
        />
      </div>

      {error && <p className="inline-error">{error}</p>}

      <button className="btn-primary" onClick={startGrouping} disabled={creating}>
        {creating ? "Grouping…" : `Group ${workingSet.length || ""} item${workingSet.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}
