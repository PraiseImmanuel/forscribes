"""Batch transcription job manager.

Transcription is CPU-bound and synchronous (faster-whisper doesn't have an
async API), so each batch runs in a plain background thread rather than on
FastAPI's event loop - otherwise a running transcription would freeze /health
and every other request. Jobs process files one at a time, on purpose: this
app is built and tested on a 2-core laptop, and running whisper on several
files at once would just make all of them slower rather than actually
finishing sooner.

Job state lives in memory only. If the sidecar restarts mid-batch the job's
progress display is lost, but every file that finished before the restart is
already committed to SQLite - nothing already-transcribed is lost. A partial
model download on disk survives a restart too (huggingface_hub resumes it),
so an interrupted first-time download isn't lost either.
"""
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from faster_whisper import WhisperModel

import db
from cleanup import clean_transcript
from hardware import MODELS, device_and_compute_type

_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()

# Keep the most recently used model loaded so a follow-up batch with the same
# model doesn't pay the load cost again. Loading is what actually reads the
# (possibly multi-hundred-MB) model weights into memory.
_loaded_model: Optional[WhisperModel] = None
_loaded_model_id: Optional[str] = None
_model_lock = threading.Lock()

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma", ".mp4"}

_HF_CACHE_ROOT = Path.home() / ".cache" / "huggingface" / "hub"


def _model_cache_dir(model_id: str) -> Path:
    # faster-whisper's plain size names (base, small, large-v3, ...) resolve
    # to Systran's mirror of the official OpenAI weights on the Hub.
    return _HF_CACHE_ROOT / f"models--Systran--faster-whisper-{model_id}"


def _cache_dir_size_mb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def _model_is_fully_cached(model_id: str) -> bool:
    """Good-enough heuristic: no huggingface_hub .incomplete markers left
    and the on-disk size roughly matches the known download size."""
    cache_dir = _model_cache_dir(model_id)
    if not cache_dir.exists():
        return False
    if any(cache_dir.rglob("*.incomplete")):
        return False
    expected_mb = next((m["approx_download_mb"] for m in MODELS if m["id"] == model_id), None)
    if expected_mb is None:
        return True  # unknown model id (shouldn't happen) - don't block on it
    return _cache_dir_size_mb(cache_dir) >= expected_mb * 0.9


def _watch_model_download(job: dict, model_id: str, stop_event: threading.Event) -> None:
    expected_mb = next((m["approx_download_mb"] for m in MODELS if m["id"] == model_id), None)
    cache_dir = _model_cache_dir(model_id)
    while not stop_event.is_set():
        downloaded_mb = _cache_dir_size_mb(cache_dir)
        percent = min(99, int(downloaded_mb / expected_mb * 100)) if expected_mb else None
        job["model_progress"] = {
            "downloaded_mb": round(downloaded_mb, 1),
            "total_mb": expected_mb,
            "percent": percent,
        }
        stop_event.wait(0.5)


def _get_model(model_id: str, hw: dict, job: dict) -> WhisperModel:
    global _loaded_model, _loaded_model_id
    with _model_lock:
        if _loaded_model is not None and _loaded_model_id == model_id:
            return _loaded_model

        already_cached = _model_is_fully_cached(model_id)
        job["model_status"] = "loading" if already_cached else "downloading"

        stop_event = threading.Event()
        watcher = None
        if not already_cached:
            watcher = threading.Thread(
                target=_watch_model_download, args=(job, model_id, stop_event), daemon=True
            )
            watcher.start()

        try:
            device, compute_type = device_and_compute_type(hw)
            _loaded_model = WhisperModel(model_id, device=device, compute_type=compute_type)
            _loaded_model_id = model_id
        finally:
            stop_event.set()
            if watcher:
                watcher.join(timeout=2)

        job["model_status"] = "ready"
        job["model_progress"] = None
        return _loaded_model


def _file_metadata(path: str) -> dict:
    p = Path(path)
    stat = p.stat()
    return {
        "original_filename": p.name,
        "format": p.suffix.lstrip(".").lower(),
        "file_created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
        "file_modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


def _format_hms(seconds: float) -> str:
    total = int(seconds)
    m, s = divmod(total, 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def start_batch_job(file_paths: list[str], model_id: str, hw: dict) -> str:
    job_id = str(uuid.uuid4())
    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "id": job_id,
            "model": model_id,
            "status": "running",
            "model_status": "checking",  # checking | downloading | loading | ready
            "model_progress": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "files": [
                {
                    "path": p,
                    "filename": Path(p).name,
                    "status": "queued",  # queued | transcribing | done | error
                    "progress": None,
                    "transcript_id": None,
                    "error": None,
                }
                for p in file_paths
            ],
        }
    thread = threading.Thread(target=_run_job, args=(job_id, hw), daemon=True)
    thread.start()
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


def _run_job(job_id: str, hw: dict) -> None:
    job = _JOBS[job_id]
    try:
        model = _get_model(job["model"], hw, job)
    except Exception as e:
        job["model_status"] = "ready"  # stop showing a download/load spinner
        for entry in job["files"]:
            entry["status"] = "error"
            entry["error"] = f"Could not load model '{job['model']}': {e}"
        job["status"] = "error"
        return

    for entry in job["files"]:
        entry["status"] = "transcribing"
        try:
            entry["transcript_id"] = _transcribe_one(entry, job["model"], model)
            entry["status"] = "done"
            entry["progress"] = {"percent": 100, "detail": "Done"}
        except Exception as e:  # bad audio, unsupported codec, etc - keep going
            entry["status"] = "error"
            entry["error"] = str(e)

    job["status"] = "done"


def _transcribe_one(entry: dict, model_id: str, model: WhisperModel) -> int:
    path = entry["path"]
    if not os.path.exists(path):
        raise FileNotFoundError(f"File no longer exists: {path}")

    meta = _file_metadata(path)
    # Tried widening beam_size/best_of/patience beyond faster-whisper's
    # defaults (5/5/1) - measurably slower, no accuracy change on real
    # test audio (see project notes). The errors it was meant to catch
    # turned out to be genuine mishearings, not "didn't search enough"
    # cases, so there was nothing here for a wider search to find. Back to
    # defaults.
    segments_iter, info = model.transcribe(path, vad_filter=True)
    total_duration = info.duration or 0.0

    segments = []
    text_parts = []
    last_progress_write = 0.0
    for seg in segments_iter:
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        text_parts.append(seg.text.strip())

        # Segment-by-segment yielding is real processing time, not a fake
        # progress bar - faster-whisper decodes each segment before handing
        # it back, so this tracks actual work done through the audio.
        now = time.monotonic()
        if now - last_progress_write > 0.2:  # throttle: no need to write every segment
            percent = min(99, int(seg.end / total_duration * 100)) if total_duration else None
            entry["progress"] = {
                "percent": percent,
                "detail": f"{_format_hms(seg.end)} / {_format_hms(total_duration)}" if total_duration else None,
            }
            last_progress_write = now

    raw_text = " ".join(text_parts).strip()
    cleaned_text = clean_transcript(segments) if segments else None

    conn = db.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO audio_file
               (file_path, original_filename, duration_seconds, file_created_at,
                file_modified_at, format)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                path,
                meta["original_filename"],
                info.duration,
                meta["file_created_at"],
                meta["file_modified_at"],
                meta["format"],
            ),
        )
        audio_file_id = cur.lastrowid

        title = Path(path).stem
        cur = conn.execute(
            """INSERT INTO transcript
               (audio_file_id, title, raw_text, cleaned_text, segments,
                language, model_used, duration_seconds)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                audio_file_id,
                title,
                raw_text,
                cleaned_text,
                _segments_to_json(segments),
                info.language,
                model_id,
                info.duration,
            ),
        )
        transcript_id = cur.lastrowid
        conn.commit()
        return transcript_id
    finally:
        conn.close()


def _segments_to_json(segments: list[dict]) -> str:
    import json

    return json.dumps(segments)
