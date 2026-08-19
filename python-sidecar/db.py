"""SQLite schema and connection helpers for Voicebook's local data store.

The database lives outside the project folder, in the OS's per-user app-data
directory, so it survives app updates/rebuilds and isn't tied to where the
source code happens to sit.
"""
import os
import sqlite3
from pathlib import Path

DB_FILENAME = "forscribe.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS audio_file (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    duration_seconds REAL,
    file_created_at TEXT,
    file_modified_at TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum TEXT,
    format TEXT
);

CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id INTEGER NOT NULL REFERENCES audio_file(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    cleaned_text TEXT,
    segments TEXT,
    language TEXT,
    model_used TEXT,
    duration_seconds REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    embedding BLOB,
    embedding_model TEXT
);

CREATE TABLE IF NOT EXISTS document (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL CHECK (source_type IN ('topic', 'corpus_upload', 'grouping_upload')),
    original_filename TEXT NOT NULL,
    file_format TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    embedding BLOB,
    embedding_model TEXT,
    promoted_transcript_id INTEGER REFERENCES transcript(id)
);

CREATE TABLE IF NOT EXISTS grouping_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    granularity_setting REAL
);

CREATE TABLE IF NOT EXISTS "group" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grouping_session_id INTEGER NOT NULL REFERENCES grouping_session(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    auto_label_keyphrases TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_membership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('transcript', 'document')),
    item_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_query (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    topic_source_type TEXT NOT NULL CHECK (topic_source_type IN ('document', 'text')),
    topic_document_id INTEGER REFERENCES document(id),
    topic_text TEXT,
    rubric_weights TEXT NOT NULL,
    relevance_threshold REAL NOT NULL DEFAULT 4.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relevance_rating (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_query_id INTEGER NOT NULL REFERENCES topic_query(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('transcript', 'document')),
    item_id INTEGER NOT NULL,
    relevance_score REAL NOT NULL,
    sub_scores TEXT NOT NULL,
    rank INTEGER,
    computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_db_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home() / ".local" / "share"
    app_dir = base / "forscribe"
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir / DB_FILENAME


def init_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path or get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
