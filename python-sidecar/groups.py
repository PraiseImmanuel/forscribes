"""Data access for GroupingSession / Group / GroupMembership.

A "working set" item is always identified by (item_type, item_id) where
item_type is 'transcript' or 'document' - the two source entities Feature 2
can pull from. Resolving an item to its display text/title crosses into
whichever table item_type points at.
"""
import db


def resolve_item(item_type: str, item_id: int) -> dict | None:
    conn = db.get_connection()
    try:
        if item_type == "transcript":
            row = conn.execute(
                "SELECT id, title, raw_text, cleaned_text, embedding FROM transcript WHERE id = ?",
                (item_id,),
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            d["text"] = d.get("cleaned_text") or d["raw_text"]
            return d
        elif item_type == "document":
            row = conn.execute(
                "SELECT id, original_filename AS title, raw_text, embedding FROM document WHERE id = ?",
                (item_id,),
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            d["text"] = d["raw_text"]
            return d
        raise ValueError(f"Unknown item_type: {item_type}")
    finally:
        conn.close()


def save_item_embedding(item_type: str, item_id: int, blob: bytes, model_name: str) -> None:
    conn = db.get_connection()
    try:
        table = "transcript" if item_type == "transcript" else "document"
        conn.execute(
            f"UPDATE {table} SET embedding = ?, embedding_model = ? WHERE id = ?",
            (blob, model_name, item_id),
        )
        conn.commit()
    finally:
        conn.close()


# ---- sessions ---------------------------------------------------------------

def create_session(name: str, granularity: float) -> int:
    conn = db.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO grouping_session (name, granularity_setting) VALUES (?, ?)",
            (name, granularity),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_sessions() -> list[dict]:
    conn = db.get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM grouping_session ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_session(session_id: int) -> dict | None:
    conn = db.get_connection()
    try:
        row = conn.execute("SELECT * FROM grouping_session WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def touch_session(session_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE grouping_session SET updated_at = datetime('now') WHERE id = ?",
            (session_id,),
        )
        conn.commit()
    finally:
        conn.close()


def update_session_granularity(session_id: int, granularity: float) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE grouping_session SET granularity_setting = ?, updated_at = datetime('now') WHERE id = ?",
            (granularity, session_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_session(session_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute("DELETE FROM grouping_session WHERE id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()


# ---- groups + membership -----------------------------------------------------

def clear_groups(session_id: int) -> None:
    """Deletes every group (and, via FK cascade, every membership) in a
    session - used right before writing a fresh clustering result."""
    conn = db.get_connection()
    try:
        conn.execute('DELETE FROM "group" WHERE grouping_session_id = ?', (session_id,))
        conn.commit()
    finally:
        conn.close()


def create_group(session_id: int, name: str, keyphrases: str | None = None) -> int:
    conn = db.get_connection()
    try:
        cur = conn.execute(
            'INSERT INTO "group" (grouping_session_id, name, auto_label_keyphrases) VALUES (?, ?, ?)',
            (session_id, name, keyphrases),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def add_membership(group_id: int, item_type: str, item_id: int) -> int:
    conn = db.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO group_membership (group_id, item_type, item_id) VALUES (?, ?, ?)",
            (group_id, item_type, item_id),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def rename_group(group_id: int, name: str) -> None:
    conn = db.get_connection()
    try:
        conn.execute('UPDATE "group" SET name = ? WHERE id = ?', (name, group_id))
        conn.commit()
    finally:
        conn.close()


def delete_group(group_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute('DELETE FROM "group" WHERE id = ?', (group_id,))
        conn.commit()
    finally:
        conn.close()


def move_membership(membership_id: int, new_group_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute(
            "UPDATE group_membership SET group_id = ? WHERE id = ?",
            (new_group_id, membership_id),
        )
        conn.commit()
    finally:
        conn.close()


def remove_membership(membership_id: int) -> None:
    conn = db.get_connection()
    try:
        conn.execute("DELETE FROM group_membership WHERE id = ?", (membership_id,))
        conn.commit()
    finally:
        conn.close()


def get_session_detail(session_id: int) -> dict | None:
    session = get_session(session_id)
    if session is None:
        return None

    conn = db.get_connection()
    try:
        group_rows = conn.execute(
            'SELECT * FROM "group" WHERE grouping_session_id = ? ORDER BY id', (session_id,)
        ).fetchall()
        groups = []
        for g in group_rows:
            group_dict = dict(g)
            member_rows = conn.execute(
                "SELECT * FROM group_membership WHERE group_id = ? ORDER BY id", (g["id"],)
            ).fetchall()
            members = []
            for m in member_rows:
                item = resolve_item(m["item_type"], m["item_id"])
                members.append(
                    {
                        "membership_id": m["id"],
                        "item_type": m["item_type"],
                        "item_id": m["item_id"],
                        "title": item["title"] if item else "(deleted)",
                        "preview": (item["text"][:160] if item and item.get("text") else ""),
                    }
                )
            group_dict["members"] = members
            groups.append(group_dict)
        session["groups"] = groups
        return session
    finally:
        conn.close()
