"""HTTP routes for Feature 1 (Transcription). Mounted onto the main FastAPI
app in main.py. All requests are local-only, from the Tauri frontend.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import transcription
import transcripts as transcripts_db
from cleanup import clean_transcript
from export import export_transcript
from hardware import MODELS, detect_hardware, recommend_model

router = APIRouter()

MAX_BATCH_SIZE = 5  # Deliberately small for now - raise once the pipeline is proven out.


# ---- hardware / model info ------------------------------------------------

@router.get("/transcription/hardware")
def get_hardware():
    hw = detect_hardware()
    return {**hw, "recommended_model": recommend_model(hw)}


@router.get("/transcription/models")
def get_models():
    return {"models": MODELS}


# ---- batch jobs -------------------------------------------------------------

class StartJobRequest(BaseModel):
    file_paths: list[str]
    model_id: str


@router.post("/transcription/jobs")
def start_job(req: StartJobRequest):
    if not req.file_paths:
        raise HTTPException(400, "No files provided.")
    if len(req.file_paths) > MAX_BATCH_SIZE:
        raise HTTPException(
            400,
            f"Batch is capped at {MAX_BATCH_SIZE} files for now - "
            f"you sent {len(req.file_paths)}. Run additional batches separately.",
        )
    valid_models = {m["id"] for m in MODELS}
    if req.model_id not in valid_models:
        raise HTTPException(400, f"Unknown model '{req.model_id}'.")

    hw = detect_hardware()
    job_id = transcription.start_batch_job(req.file_paths, req.model_id, hw)
    return {"job_id": job_id}


@router.get("/transcription/jobs/{job_id}")
def get_job(job_id: str):
    job = transcription.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found.")
    return job


# ---- transcript library -----------------------------------------------------

@router.get("/transcripts")
def list_transcripts(search: str | None = None):
    return {"transcripts": transcripts_db.list_transcripts(search)}


@router.get("/transcripts/{transcript_id}")
def get_transcript(transcript_id: int):
    t = transcripts_db.get_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, "Transcript not found.")
    return t


class UpdateTranscriptRequest(BaseModel):
    title: str | None = None
    cleaned_text: str | None = None


@router.patch("/transcripts/{transcript_id}")
def update_transcript(transcript_id: int, req: UpdateTranscriptRequest):
    t = transcripts_db.update_transcript(transcript_id, req.title, req.cleaned_text)
    if t is None:
        raise HTTPException(404, "Transcript not found.")
    return t


@router.post("/transcripts/{transcript_id}/cleanup")
def cleanup_transcript(transcript_id: int):
    t = transcripts_db.get_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, "Transcript not found.")
    if not t.get("segments"):
        raise HTTPException(400, "This transcript has no segment data to clean up from.")
    cleaned = clean_transcript(t["segments"])
    return transcripts_db.update_transcript(transcript_id, cleaned_text=cleaned)


@router.delete("/transcripts/{transcript_id}")
def delete_transcript(transcript_id: int):
    t = transcripts_db.get_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, "Transcript not found.")
    transcripts_db.delete_transcript(transcript_id)
    return {"deleted": True}


class ExportRequest(BaseModel):
    variant: str  # "raw" | "cleaned"
    format: str  # "txt" | "md" | "docx"
    dest_path: str


@router.post("/transcripts/{transcript_id}/export")
def export(transcript_id: int, req: ExportRequest):
    t = transcripts_db.get_transcript(transcript_id)
    if t is None:
        raise HTTPException(404, "Transcript not found.")
    if req.variant not in ("raw", "cleaned"):
        raise HTTPException(400, "variant must be 'raw' or 'cleaned'.")
    if req.format not in ("txt", "md", "docx"):
        raise HTTPException(400, "format must be 'txt', 'md', or 'docx'.")
    try:
        export_transcript(t, req.variant, req.format, req.dest_path)
    except OSError as e:
        raise HTTPException(500, f"Could not write file: {e}")
    return {"exported_to": req.dest_path}
