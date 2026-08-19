"""Document entity: uploaded files distinct from app-generated Transcripts.
Used for (a) grouping-session uploads, (b) topic-query corpus uploads, and
(c) topic-definition documents in Feature 3. A Document can be "promoted"
into the Transcript library if the user wants it to stick around there too.
"""
from pathlib import Path

import db


def parse_file_text(path: str) -> str:
    p = Path(path)
    suffix = p.suffix.lower()
    if suffix in (".txt", ".md"):
        return p.read_text(encoding="utf-8", errors="replace")
    if suffix == ".docx":
        from docx import Document as DocxDocument

        doc = DocxDocument(path)
        return "\n\n".join(para.text for para in doc.paragraphs if para.text.strip())
    raise ValueError(f"Unsupported document format: {suffix}")


def create_document(path: str, source_type: str) -> dict:
    text = parse_file_text(path)
    p = Path(path)
    conn = db.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO document (source_type, original_filename, file_format, raw_text)
               VALUES (?, ?, ?, ?)""",
            (source_type, p.name, p.suffix.lstrip(".").lower(), text),
        )
        conn.commit()
        return get_document(cur.lastrowid)
    finally:
        conn.close()


def create_document_from_text(text: str, title: str, source_type: str) -> dict:
    conn = db.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO document (source_type, original_filename, file_format, raw_text)
               VALUES (?, ?, 'text', ?)""",
            (source_type, title, text),
        )
        conn.commit()
        return get_document(cur.lastrowid)
    finally:
        conn.close()


def _row_to_dict(row) -> dict:
    d = dict(row)
    # embedding is a raw float32 BLOB, not JSON-serializable and not
    # something the frontend needs - same reasoning as transcripts.py.
    d["has_embedding"] = d.get("embedding") is not None
    d.pop("embedding", None)
    return d


def get_document(document_id: int) -> dict | None:
    conn = db.get_connection()
    try:
        row = conn.execute("SELECT * FROM document WHERE id = ?", (document_id,)).fetchone()
        return _row_to_dict(row) if row else None
    finally:
        conn.close()


def list_documents(source_type: str | None = None) -> list[dict]:
    conn = db.get_connection()
    try:
        if source_type:
            rows = conn.execute(
                "SELECT * FROM document WHERE source_type = ? ORDER BY uploaded_at DESC",
                (source_type,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM document ORDER BY uploaded_at DESC").fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def save_embedding(document_id: int, blob: bytes, model_name: str) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE document SET embedding = ?, embedding_model = ? WHERE id = ?",
            (blob, model_name, document_id),
        )
        conn.commit()
    finally:
        conn.close()


def promote_to_transcript(document_id: int) -> dict:
    """Creates a standalone Transcript from a Document's text, with no
    linked audio file, and records the link back on the Document."""
    doc = get_document(document_id)
    if doc is None:
        raise ValueError("Document not found")
    if doc.get("promoted_transcript_id"):
        from transcripts import get_transcript

        return get_transcript(doc["promoted_transcript_id"])

    conn = db.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO audio_file (file_path, original_filename, format)
               VALUES ('', ?, 'document')""",
            (doc["original_filename"],),
        )
        audio_file_id = cur.lastrowid

        title = Path(doc["original_filename"]).stem
        cur = conn.execute(
            """INSERT INTO transcript (audio_file_id, title, raw_text, model_used)
               VALUES (?, ?, ?, 'uploaded-document')""",
            (audio_file_id, title, doc["raw_text"]),
        )
        transcript_id = cur.lastrowid
        conn.execute(
            "UPDATE document SET promoted_transcript_id = ? WHERE id = ?",
            (transcript_id, document_id),
        )
        conn.commit()
    finally:
        conn.close()

    from transcripts import get_transcript

    return get_transcript(transcript_id)
