"""Data access for TopicQuery / RelevanceRating (Feature 3)."""
import json

import db


def create_topic_query(
    name: str | None,
    topic_source_type: str,
    topic_document_id: int | None,
    topic_text: str | None,
    rubric_config: dict,
    relevance_threshold: float,
) -> int:
    conn = db.get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO topic_query
               (name, topic_source_type, topic_document_id, topic_text,
                rubric_weights, relevance_threshold)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                name,
                topic_source_type,
                topic_document_id,
                topic_text,
                json.dumps(rubric_config),
                relevance_threshold,
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_topic_query(query_id: int) -> dict | None:
    conn = db.get_connection()
    try:
        row = conn.execute("SELECT * FROM topic_query WHERE id = ?", (query_id,)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["rubric_config"] = json.loads(d["rubric_weights"])
        return d
    finally:
        conn.close()


def list_topic_queries() -> list[dict]:
    conn = db.get_connection()
    try:
        rows = conn.execute("SELECT * FROM topic_query ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_rubric_config(query_id: int, rubric_config: dict) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE topic_query SET rubric_weights = ? WHERE id = ?",
            (json.dumps(rubric_config), query_id),
        )
        conn.commit()
    finally:
        conn.close()


def update_threshold(query_id: int, threshold: float) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE topic_query SET relevance_threshold = ? WHERE id = ?",
            (threshold, query_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_topic_query(query_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute("DELETE FROM topic_query WHERE id = ?", (query_id,))
        conn.commit()
    finally:
        conn.close()


def clear_ratings(query_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute("DELETE FROM relevance_rating WHERE topic_query_id = ?", (query_id,))
        conn.commit()
    finally:
        conn.close()


def save_ratings(query_id: int, ratings: list[dict]) -> None:
    """ratings: [{item_type, item_id, relevance_score, sub_scores: dict, rank}]"""
    conn = db.get_connection()
    try:
        conn.executemany(
            """INSERT INTO relevance_rating
               (topic_query_id, item_type, item_id, relevance_score, sub_scores, rank)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (
                    query_id,
                    r["item_type"],
                    r["item_id"],
                    r["relevance_score"],
                    json.dumps(r["sub_scores"]),
                    r["rank"],
                )
                for r in ratings
            ],
        )
        conn.commit()
    finally:
        conn.close()


def get_ratings(query_id: int) -> list[dict]:
    conn = db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM relevance_rating WHERE topic_query_id = ? ORDER BY rank",
            (query_id,),
        ).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["sub_scores"] = json.loads(d["sub_scores"])
            results.append(d)
        return results
    finally:
        conn.close()
