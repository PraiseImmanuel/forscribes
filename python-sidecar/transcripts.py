"""Data access for stored transcripts - the Library screen's backing store."""
import json

import db


def row_to_dict(row) -> dict:
    d = dict(row)
    if d.get("segments"):
        try:
            d["segments"] = json.loads(d["segments"])
        except (TypeError, json.JSONDecodeError):
            d["segments"] = None
    # embedding is a raw float32 BLOB used internally for grouping/topic
    # scoring - it's not JSON-serializable and the frontend has no use for
    # it, so it never leaves this module. Callers only see whether one exists.
    d["has_embedding"] = d.get("embedding") is not None
    d.pop("embedding", None)
    return d


def list_transcripts(search: str | None = None) -> list[dict]:
    conn = db.get_connection()
    try:
        if search:
            rows = conn.execute(
                """SELECT t.*, a.file_path, a.original_filename
                   FROM transcript t
                   JOIN audio_file a ON a.id = t.audio_file_id
                   WHERE t.title LIKE ? OR t.raw_text LIKE ? OR a.original_filename LIKE ?
                   ORDER BY t.created_at DESC""",
                (f"%{search}%", f"%{search}%", f"%{search}%"),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT t.*, a.file_path, a.original_filename
                   FROM transcript t
                   JOIN audio_file a ON a.id = t.audio_file_id
                   ORDER BY t.created_at DESC"""
            ).fetchall()
        # Don't ship full transcript text in the list view - just a preview.
        results = []
        for row in rows:
            d = row_to_dict(row)
            preview_source = d.get("cleaned_text") or d.get("raw_text") or ""
            d["preview"] = preview_source[:180]
            del d["raw_text"]
            d.pop("cleaned_text", None)
            d.pop("segments", None)
            results.append(d)
        return results
    finally:
        conn.close()


def get_transcript(transcript_id: int) -> dict | None:
    conn = db.get_connection()
    try:
        row = conn.execute(
            """SELECT t.*, a.file_path, a.original_filename
               FROM transcript t
               JOIN audio_file a ON a.id = t.audio_file_id
               WHERE t.id = ?""",
            (transcript_id,),
        ).fetchone()
        return row_to_dict(row) if row else None
    finally:
        conn.close()


def update_transcript(
    transcript_id: int,
    title: str | None = None,
    cleaned_text: str | None = None,
) -> dict | None:
    conn = db.get_connection()
    try:
        fields, values = [], []
        if title is not None:
            fields.append("title = ?")
            values.append(title)
        if cleaned_text is not None:
            fields.append("cleaned_text = ?")
            values.append(cleaned_text)
        if fields:
            fields.append("updated_at = datetime('now')")
            values.append(transcript_id)
            conn.execute(f"UPDATE transcript SET {', '.join(fields)} WHERE id = ?", values)
            conn.commit()
    finally:
        conn.close()
    return get_transcript(transcript_id)


def delete_transcript(transcript_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute("DELETE FROM transcript WHERE id = ?", (transcript_id,))
        conn.commit()
    finally:
        conn.close()
