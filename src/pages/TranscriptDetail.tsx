import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Sparkles, Download } from "lucide-react";
import {
  getTranscript,
  updateTranscript,
  cleanupTranscript,
  exportTranscript,
  type TranscriptDetail as TranscriptDetailType,
  type ExportFormat,
} from "../lib/transcription";
import "./Transcribe.css";
import "./TranscriptDetail.css";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "unknown length";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const EXPORT_FORMATS: { format: ExportFormat; label: string; ext: string }[] = [
  { format: "md", label: "Markdown", ext: "md" },
  { format: "docx", label: "Word", ext: "docx" },
  { format: "txt", label: "Plain text", ext: "txt" },
];

export function TranscriptDetail() {
  const { id } = useParams<{ id: string }>();
  const transcriptId = Number(id);

  const [transcript, setTranscript] = useState<TranscriptDetailType | null>(null);
  const [tab, setTab] = useState<"raw" | "cleaned">("raw");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    (async () => {
      const t = await getTranscript(transcriptId);
      setTranscript(t);
      setTitleDraft(t.title);
      if (t.cleaned_text) {
        setTab("cleaned");
        setDraft(t.cleaned_text);
      } else {
        setDraft(t.raw_text);
      }
    })();
  }, [transcriptId]);

  function switchTab(next: "raw" | "cleaned") {
    if (!transcript) return;
    setTab(next);
    setDirty(false);
    setDraft(next === "raw" ? transcript.raw_text : transcript.cleaned_text ?? "");
  }

  async function runCleanup() {
    setCleaning(true);
    try {
      const updated = await cleanupTranscript(transcriptId);
      setTranscript(updated);
      setTab("cleaned");
      setDraft(updated.cleaned_text ?? "");
      setDirty(false);
    } finally {
      setCleaning(false);
    }
  }

  async function saveDraft() {
    if (tab === "raw") return; // raw text is the original whisper output - never edited in place
    setSaving(true);
    try {
      const updated = await updateTranscript(transcriptId, { cleaned_text: draft });
      setTranscript(updated);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveTitle() {
    if (!transcript || titleDraft.trim() === transcript.title) return;
    const updated = await updateTranscript(transcriptId, { title: titleDraft.trim() });
    setTranscript(updated);
  }

  async function handleExport(format: ExportFormat) {
    if (!transcript) return;
    const ext = EXPORT_FORMATS.find((f) => f.format === format)!.ext;
    const destPath = await save({
      defaultPath: `${transcript.title}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!destPath) return;
    setExportStatus(`Exporting…`);
    try {
      await exportTranscript(transcriptId, tab, format, destPath);
      setExportStatus(`Saved to ${destPath}`);
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    }
  }

  if (!transcript) {
    return (
      <section className="screen">
        <p className="panel-hint">Loading transcript…</p>
      </section>
    );
  }

  return (
    <section className="screen">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Link to="/library" className="back-link">
          <ArrowLeft size={14} /> Back to Library
        </Link>

        <input
          className="title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={saveTitle}
        />

        <p className="screen-subtitle">
          {transcript.original_filename} · {formatDuration(transcript.duration_seconds)} ·{" "}
          {transcript.language ?? "unknown language"} · model: {transcript.model_used ?? "?"}
        </p>
      </motion.div>

      <div className="tabs">
        <button className={`tab${tab === "raw" ? " active" : ""}`} onClick={() => switchTab("raw")}>
          Raw
        </button>
        <button
          className={`tab${tab === "cleaned" ? " active" : ""}`}
          onClick={() => switchTab("cleaned")}
          disabled={!transcript.cleaned_text}
        >
          Cleaned {!transcript.cleaned_text && "(not run yet)"}
        </button>
        {!transcript.cleaned_text && (
          <button className="btn-secondary cleanup-btn" onClick={runCleanup} disabled={cleaning}>
            <Sparkles size={14} />
            {cleaning ? "Cleaning up…" : "Run cleanup"}
          </button>
        )}
      </div>

      <textarea
        className="transcript-editor"
        value={draft}
        readOnly={tab === "raw"}
        onChange={(e) => {
          setDraft(e.target.value);
          setDirty(true);
        }}
        rows={16}
      />

      {tab === "cleaned" && (
        <div className="panel-row">
          <button className="btn-secondary" onClick={runCleanup} disabled={cleaning}>
            <Sparkles size={14} />
            Re-run cleanup
          </button>
          <button className="btn-primary" onClick={saveDraft} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Export ({tab === "raw" ? "raw" : "cleaned"} text)</h3>
        <div className="panel-row">
          {EXPORT_FORMATS.map((f) => (
            <button key={f.format} className="btn-secondary" onClick={() => handleExport(f.format)}>
              <Download size={14} />
              {f.label}
            </button>
          ))}
        </div>
        {exportStatus && <p className="panel-hint">{exportStatus}</p>}
      </div>
    </section>
  );
}
