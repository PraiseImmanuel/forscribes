import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { FolderOpen, X, CheckCircle2, XCircle, Loader2, Download } from "lucide-react";
import { getHardware, getModels, type HardwareInfo, type ModelInfo } from "../lib/transcription";
import { useTranscriptionJob } from "../context/TranscriptionJobContext";
import "./Transcribe.css";

const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "wma", "mp4"];
const MAX_FILES = 5;
const MODEL_STORAGE_KEY = "forscribe-selected-model";

// Below this, a first-time download is quick enough not to warn about.
const WARN_DOWNLOAD_MB = 400;

function formatMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function Transcribe() {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [files, setFiles] = useState<string[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const { job, starting, startError, startJob, dismissJob } = useTranscriptionJob();

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      // The sidecar can take several seconds to come up on first launch -
      // it's a PyInstaller onefile bundle, so every start re-extracts the
      // whole thing before Python even runs, on top of slow ML imports
      // (ctranslate2, onnxruntime, sklearn). A single unretried fetch here
      // would fail outright on a slow machine, leaving the model dropdown
      // permanently empty. Same 20x/500ms retry window as Dashboard's
      // sidecar health check.
      const maxAttempts = 20;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const [hw, modelsRes] = await Promise.all([getHardware(), getModels()]);
          if (cancelled) return;
          setHardware(hw);
          setModels(modelsRes.models);
          // A previously-picked model wins over the hardware recommendation -
          // otherwise every fresh visit to this screen quietly reverts your
          // choice back to the default, which is exactly what caused the
          // "I picked Large v3 but it used Base" confusion.
          const remembered = localStorage.getItem(MODEL_STORAGE_KEY);
          const isValidRemembered = remembered && modelsRes.models.some((m) => m.id === remembered);
          setSelectedModel(isValidRemembered ? remembered : hw.recommended_model);
          setLoadingInit(false);
          return;
        } catch (e) {
          if (attempt === maxAttempts) {
            if (!cancelled) {
              setInitError(
                e instanceof Error ? e.message : "Could not reach the local engine after 10s.",
              );
              setLoadingInit(false);
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  function selectModel(modelId: string) {
    setSelectedModel(modelId);
    localStorage.setItem(MODEL_STORAGE_KEY, modelId);
  }

  const selectedModelInfo = models.find((m) => m.id === selectedModel);
  const showsDownloadWarning = (selectedModelInfo?.approx_download_mb ?? 0) >= WARN_DOWNLOAD_MB;

  async function pickFiles() {
    setPickError(null);
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    const merged = Array.from(new Set([...files, ...paths]));
    if (merged.length > MAX_FILES) {
      setPickError(
        `Batches are capped at ${MAX_FILES} files for now — you have ${merged.length}. Remove some, or run a second batch afterward.`,
      );
      setFiles(merged.slice(0, MAX_FILES));
      return;
    }
    setFiles(merged);
  }

  function removeFile(path: string) {
    setFiles((prev) => prev.filter((f) => f !== path));
    setPickError(null);
  }

  async function beginTranscription() {
    if (files.length === 0 || !selectedModel) return;
    await startJob(files, selectedModel);
  }

  function startOver() {
    dismissJob();
    setFiles([]);
    setPickError(null);
  }

  const jobRunning = job?.status === "running";
  const jobDone = job?.status === "done" || job?.status === "error";

  return (
    <section className="screen">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="screen-title">Transcription</h1>
        <p className="screen-subtitle">
          Pick up to {MAX_FILES} audio files, choose a model, and transcribe locally.
          Nothing leaves this machine.
        </p>
      </motion.div>

      {!job && (
        <>
          <div className="panel">
            <div className="panel-row">
              <button className="btn-secondary" onClick={pickFiles} disabled={files.length >= MAX_FILES}>
                <FolderOpen size={16} />
                Choose audio files
              </button>
              <span className="panel-hint">{files.length} / {MAX_FILES} selected</span>
            </div>

            {pickError && <p className="inline-error">{pickError}</p>}

            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f} className="file-row">
                    <span className="file-name" title={f}>{f.split(/[\\/]/).pop()}</span>
                    <button className="icon-btn" onClick={() => removeFile(f)} aria-label="Remove file">
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <h3 className="panel-title">Model</h3>
            {loadingInit && (
              <p className="panel-hint">
                <Loader2 size={13} className="spin" /> Connecting to the local engine…
              </p>
            )}
            {initError && (
              <p className="inline-error">
                Couldn't reach the local engine: {initError}. Try restarting ForScribe.
              </p>
            )}
            {hardware && (
              <p className="panel-hint">
                Detected: {hardware.cpu_count} core{hardware.cpu_count === 1 ? "" : "s"}
                {hardware.logical_cpu_count > hardware.cpu_count
                  ? ` (${hardware.logical_cpu_count} threads)`
                  : ""}
                , {hardware.total_ram_gb} GB RAM
                {hardware.has_gpu ? `, GPU available` : ", no GPU"} — recommended:{" "}
                <strong>{hardware.recommended_model}</strong>
              </p>
            )}
            {!loadingInit && !initError && (
              <select
                className="model-select"
                value={selectedModel}
                onChange={(e) => selectModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.params}) — {m.speed}, {m.accuracy} accuracy
                    {m.id === hardware?.recommended_model ? " · recommended" : ""}
                  </option>
                ))}
              </select>
            )}
            {showsDownloadWarning && selectedModelInfo && (
              <p className="inline-notice">
                <Download size={13} />
                First use downloads ~{formatMb(selectedModelInfo.approx_download_mb)} — after that
                it's cached and starts instantly. You'll see a progress bar for the download.
              </p>
            )}
          </div>

          <button
            className="btn-primary"
            onClick={beginTranscription}
            disabled={files.length === 0 || starting || loadingInit || !!initError}
          >
            {starting ? "Starting…" : `Transcribe ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </button>
          {startError && <p className="inline-error">{startError}</p>}
        </>
      )}

      {job && (
        <div className="panel">
          <h3 className="panel-title">
            {jobRunning ? "Transcribing…" : "Batch finished"}
          </h3>

          {(job.model_status === "downloading" || job.model_status === "loading") && (
            <div className="model-status-banner">
              <div className="model-status-row">
                <Loader2 size={15} className="spin" />
                <span>
                  {job.model_status === "downloading"
                    ? `Downloading ${job.model} model (one-time — cached after this)`
                    : `Loading ${job.model} model into memory…`}
                </span>
              </div>
              {job.model_progress && (
                <>
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${job.model_progress.percent ?? 5}%` }}
                    />
                  </div>
                  <span className="panel-hint">
                    {job.model_progress.total_mb
                      ? `${formatMb(job.model_progress.downloaded_mb ?? 0)} / ${formatMb(job.model_progress.total_mb)}`
                      : `${formatMb(job.model_progress.downloaded_mb ?? 0)} downloaded`}
                    {job.model_progress.percent != null && ` · ${job.model_progress.percent}%`}
                  </span>
                </>
              )}
            </div>
          )}

          <ul className="progress-list">
            {job.files.map((f) => (
              <li key={f.path} className="progress-row">
                <span className="progress-icon">
                  {f.status === "queued" && <span className="status-dot" />}
                  {f.status === "transcribing" && <Loader2 size={16} className="spin" />}
                  {f.status === "done" && <CheckCircle2 size={16} className="text-success" />}
                  {f.status === "error" && <XCircle size={16} className="text-error" />}
                </span>
                <span className="progress-name">{f.filename}</span>

                {f.status === "transcribing" && f.progress && (
                  <span className="progress-detail">
                    {f.progress.detail ?? "Transcribing…"}
                    {f.progress.percent != null && ` (${f.progress.percent}%)`}
                  </span>
                )}
                {f.status === "transcribing" && !f.progress && (
                  <span className="progress-detail">Starting…</span>
                )}

                {f.status === "done" && f.transcript_id && (
                  <Link to={`/library/${f.transcript_id}`} className="progress-link">
                    View →
                  </Link>
                )}
                {f.status === "error" && <span className="inline-error">{f.error}</span>}
              </li>
            ))}
          </ul>

          {jobDone && (
            <button className="btn-secondary" onClick={startOver}>
              Transcribe another batch
            </button>
          )}
        </div>
      )}
    </section>
  );
}
