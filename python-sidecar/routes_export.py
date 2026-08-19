"""HTTP routes for Feature 4 (Export). One generic endpoint serves all three
entry points (Library multi-select, Grouping session, Topic query results) -
the caller builds the block list, this just resolves items and assembles
the file."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import documents as documents_db
import transcripts as transcripts_db
from combined_export import build_combined_docx, build_combined_markdown, build_zip
from export import format_duration

router = APIRouter()


class ExportBlock(BaseModel):
    type: str  # "divider" | "content"
    text: str | None = None  # divider label
    item_type: str | None = None  # "transcript" | "document", for content
    item_id: int | None = None
    title_override: str | None = None  # e.g. "#1 · Title (8.2/10)"


class CombinedExportRequest(BaseModel):
    blocks: list[ExportBlock]
    overall_title: str | None = None
    variant: str = "cleaned"  # "raw" | "cleaned" - transcripts only
    format: str  # "md" | "docx" | "zip"
    include_metadata: bool = True
    dest_path: str


def _resolve_block(block: ExportBlock, variant: str) -> dict:
    if block.item_type == "transcript":
        t = transcripts_db.get_transcript(block.item_id)
        if t is None:
            raise HTTPException(404, f"Transcript {block.item_id} not found.")
        text = t["raw_text"]
        if variant == "cleaned" and t.get("cleaned_text"):
            text = t["cleaned_text"]
        return {
            "type": "content",
            "title": block.title_override or t["title"],
            "meta": f"{t['created_at']} · {format_duration(t['duration_seconds'])}",
            "text": text,
        }
    elif block.item_type == "document":
        d = documents_db.get_document(block.item_id)
        if d is None:
            raise HTTPException(404, f"Document {block.item_id} not found.")
        return {
            "type": "content",
            "title": block.title_override or d["original_filename"],
            "meta": f"uploaded {d['uploaded_at']}",
            "text": d["raw_text"],
        }
    raise HTTPException(400, f"Unknown item_type: {block.item_type}")


@router.post("/export/combined")
def export_combined(req: CombinedExportRequest):
    if not req.blocks:
        raise HTTPException(400, "Nothing selected to export.")
    if req.format not in ("md", "docx", "zip"):
        raise HTTPException(400, "format must be 'md', 'docx', or 'zip'.")

    resolved_blocks = []
    for block in req.blocks:
        if block.type == "divider":
            resolved_blocks.append({"type": "divider", "text": block.text or ""})
        elif block.type == "content":
            resolved_blocks.append(_resolve_block(block, req.variant))
        else:
            raise HTTPException(400, f"Unknown block type: {block.type}")

    if not any(b["type"] == "content" for b in resolved_blocks):
        raise HTTPException(400, "Nothing selected to export.")

    try:
        if req.format == "md":
            content = build_combined_markdown(resolved_blocks, req.overall_title, req.include_metadata)
            from pathlib import Path

            Path(req.dest_path).write_text(content, encoding="utf-8")
        elif req.format == "docx":
            build_combined_docx(resolved_blocks, req.overall_title, req.include_metadata, req.dest_path)
        elif req.format == "zip":
            # ZIP entries are always individual documents - default to
            # Markdown per file unless the caller's dest_path says otherwise
            # isn't meaningful here, so we standardize on .md inside the zip.
            build_zip(resolved_blocks, "md", req.include_metadata, req.dest_path)
    except OSError as e:
        raise HTTPException(500, f"Could not write file: {e}")

    return {"exported_to": req.dest_path, "item_count": sum(1 for b in resolved_blocks if b["type"] == "content")}
