import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { Search, Upload, X, CheckSquare, Square } from "lucide-react";
import { listTranscripts, type TranscriptSummary } from "../lib/transcription";
import { uploadDocument } from "../lib/grouping";
import { createTopicQuery, type CorpusItemType } from "../lib/topics";
import "./Transcribe.css";
import "./Library.css";

interface CorpusEntry {
  item_type: CorpusItemType;
  item_id: number;
  title: string;
}

export function NewTopicQuery() {
  const navigate = useNavigate();

  const [topicMode, setTopicMode] = useState<"text" | "document">("text");
  const [topicText, setTopicText] = useState("");
  const [topicDocPath, setTopicDocPath] = useState<string | null>(null);
  const [topicDocId, setTopicDocId] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TranscriptSummary[]>([]);
  const [corpus, setCorpus] = useState<CorpusEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState(
    `Topic query — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
  );
  const [threshold, setThreshold] = useState(4);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      const res = await listTranscripts(search || undefined);
      setResults(res.transcripts);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  const inCorpus = (id: number) => corpus.some((c) => c.item_type === "transcript" && c.item_id === id);

  function toggleTranscript(t: TranscriptSummary) {
    setCorpus((prev) =>
      inCorpus(t.id)
        ? prev.filter((c) => !(c.item_type === "transcript" && c.item_id === t.id))
        : [...prev, { item_type: "transcript", item_id: t.id, title: t.title }],
    );
  }

  function selectAllVisible() {
    setCorpus((prev) => {
      const existingKeys = new Set(prev.map((c) => `${c.item_type}-${c.item_id}`));
      const toAdd = results
        .filter((t) => !existingKeys.has(`transcript-${t.id}`))
        .map((t) => ({ item_type: "transcript" as const, item_id: t.id, title: t.title }));
      return [...prev, ...toAdd];
    });
  }

  function removeFromCorpus(type: CorpusItemType, id: number) {
    setCorpus((prev) => prev.filter((c) => !(c.item_type === type && c.item_id === id)));
  }

  async function uploadCorpusDocuments() {
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
        const doc = await uploadDocument(path, "corpus_upload");
        setCorpus((prev) => [...prev, { item_type: "document", item_id: doc.id, title: doc.original_filename }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function pickTopicDocument() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["txt", "md", "docx"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    setTopicDocPath(selected);
    try {
      const doc = await uploadDocument(selected, "topic");
      setTopicDocId(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runQuery() {
    if (topicMode === "text" && !topicText.trim()) {
      setError("Describe the topic, or switch to uploading a document.");
      return;
    }
    if (topicMode === "document" && !topicDocId) {
      setError("Upload a document to define the topic.");
      return;
    }
    if (corpus.length === 0) {
      setError("Add at least one transcript or document to the corpus.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await createTopicQuery({
        name,
        topic_source_type: topicMode,
        topic_text: topicMode === "text" ? topicText : undefined,
        topic_document_id: topicMode === "document" ? topicDocId! : undefined,
        corpus: corpus.map(({ item_type, item_id }) => ({ item_type, item_id })),
        relevance_threshold: threshold,
      });
      navigate(`/topics/${result.query_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="screen">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="screen-title">New topic query</h1>
        <p className="screen-subtitle">
          Define a topic, pick a corpus, and get every transcript rated 1–10 for how well it fits.
        </p>
      </motion.div>

      <div className="panel">
        <h3 className="panel-title">Query name</h3>
        <input className="model-select" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="panel">
        <div className="tabs" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: "0.3rem" }}>
          <button className={`tab${topicMode === "text" ? " active" : ""}`} onClick={() => setTopicMode("text")}>
            Describe topic
          </button>
          <button
            className={`tab${topicMode === "document" ? " active" : ""}`}
            onClick={() => setTopicMode("document")}
          >
            Upload topic document
          </button>
        </div>

        {topicMode === "text" ? (
          <textarea
            className="transcript-editor"
            rows={5}
            placeholder="e.g. Stories about starting my career, early jobs, and lessons learned the hard way…"
            value={topicText}
            onChange={(e) => setTopicText(e.target.value)}
          />
        ) : (
          <div className="panel-row">
            <button className="btn-secondary" onClick={pickTopicDocument}>
              <Upload size={16} />
              Choose document
            </button>
            {topicDocPath && (
              <span className="panel-hint">{topicDocPath.split(/[\\/]/).pop()}</span>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-row">
          <h3 className="panel-title" style={{ flex: 1 }}>Corpus — add from Library</h3>
          <button className="icon-btn" onClick={selectAllVisible} title="Select all visible" aria-label="Select all visible">
            <CheckSquare size={16} />
          </button>
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
              {inCorpus(t.id) ? <CheckSquare size={14} /> : <Square size={14} />}
              <span className="file-name">{t.title}</span>
            </li>
          ))}
          {results.length === 0 && <p className="panel-hint">No transcripts match.</p>}
        </ul>
      </div>

      <div className="panel">
        <div className="panel-row">
          <button className="btn-secondary" onClick={uploadCorpusDocuments} disabled={uploading}>
            <Upload size={16} />
            {uploading ? "Uploading…" : "Upload corpus documents"}
          </button>
          <span className="panel-hint">.txt, .md, .docx</span>
        </div>
      </div>

      {corpus.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">Corpus ({corpus.length})</h3>
          <ul className="file-list">
            {corpus.map((c) => (
              <li key={`${c.item_type}-${c.item_id}`} className="file-row">
                <span className="file-name">
                  {c.item_type === "document" ? "📄 " : ""}
                  {c.title}
                </span>
                <button className="icon-btn" onClick={() => removeFromCorpus(c.item_type, c.item_id)} aria-label="Remove">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Relevance threshold</h3>
        <p className="panel-hint">Transcripts scoring at or above this count as "related" in the summary.</p>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
        <span className="panel-hint">{threshold} / 10</span>
      </div>

      {error && <p className="inline-error">{error}</p>}

      <button className="btn-primary" onClick={runQuery} disabled={running}>
        {running ? "Scoring…" : `Rate ${corpus.length || ""} item${corpus.length === 1 ? "" : "s"} against this topic`}
      </button>
    </section>
  );
}
