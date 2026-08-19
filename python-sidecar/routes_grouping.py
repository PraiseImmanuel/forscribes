"""HTTP routes for Feature 2 (Auto-grouping)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import documents as documents_db
import groups as groups_db
from clustering import cluster_vectors, label_groups
from embeddings import blob_to_vector, embed_text, vector_to_blob, EMBEDDING_MODEL

router = APIRouter()


# ---- documents ----------------------------------------------------------------

class UploadDocumentRequest(BaseModel):
    file_path: str
    source_type: str = "grouping_upload"  # 'grouping_upload' | 'corpus_upload' | 'topic'


@router.post("/documents/upload")
def upload_document(req: UploadDocumentRequest):
    try:
        return documents_db.create_document(req.file_path, req.source_type)
    except (ValueError, FileNotFoundError, OSError) as e:
        raise HTTPException(400, str(e))


@router.get("/documents")
def list_documents(source_type: str | None = None):
    return {"documents": documents_db.list_documents(source_type)}


@router.post("/documents/{document_id}/promote")
def promote_document(document_id: int):
    try:
        return documents_db.promote_to_transcript(document_id)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---- grouping sessions ----------------------------------------------------------

class WorkingSetItem(BaseModel):
    item_type: str  # 'transcript' | 'document'
    item_id: int


class CreateSessionRequest(BaseModel):
    name: str
    items: list[WorkingSetItem]
    granularity: float = 0.5  # 0 = many small groups, 1 = few large groups


def _run_clustering_and_write(session_id: int, items: list[WorkingSetItem], granularity: float) -> None:
    vectors = []
    texts = []
    resolved_items = []

    for item in items:
        record = groups_db.resolve_item(item.item_type, item.item_id)
        if record is None:
            continue  # source was deleted since being added to the working set

        if record.get("embedding"):
            vec = blob_to_vector(record["embedding"])
        else:
            vec = embed_text(record["text"] or "")
            groups_db.save_item_embedding(
                item.item_type, item.item_id, vector_to_blob(vec), EMBEDDING_MODEL
            )

        vectors.append(vec)
        texts.append(record["text"] or "")
        resolved_items.append(item)

    groups_db.clear_groups(session_id)

    if not vectors:
        return

    labels = cluster_vectors(vectors, granularity)
    texts_by_label: dict[int, list[str]] = {}
    for label, text in zip(labels, texts):
        texts_by_label.setdefault(label, []).append(text)
    auto_labels = label_groups(texts_by_label)

    group_id_by_label: dict[int, int] = {}
    for label in sorted(set(labels)):
        name = auto_labels.get(label, f"Group {label + 1}")
        group_id_by_label[label] = groups_db.create_group(session_id, name)

    for label, item in zip(labels, resolved_items):
        groups_db.add_membership(group_id_by_label[label], item.item_type, item.item_id)

    groups_db.update_session_granularity(session_id, granularity)


@router.post("/grouping/sessions")
def create_session(req: CreateSessionRequest):
    if not req.items:
        raise HTTPException(400, "Working set is empty - add or select at least one item.")
    session_id = groups_db.create_session(req.name, req.granularity)
    _run_clustering_and_write(session_id, req.items, req.granularity)
    return groups_db.get_session_detail(session_id)


@router.get("/grouping/sessions")
def list_sessions():
    return {"sessions": groups_db.list_sessions()}


@router.get("/grouping/sessions/{session_id}")
def get_session(session_id: int):
    detail = groups_db.get_session_detail(session_id)
    if detail is None:
        raise HTTPException(404, "Grouping session not found.")
    return detail


class RegroupRequest(BaseModel):
    granularity: float


@router.post("/grouping/sessions/{session_id}/regroup")
def regroup_session(session_id: int, req: RegroupRequest):
    detail = groups_db.get_session_detail(session_id)
    if detail is None:
        raise HTTPException(404, "Grouping session not found.")

    items = [
        WorkingSetItem(item_type=m["item_type"], item_id=m["item_id"])
        for g in detail["groups"]
        for m in g["members"]
    ]
    _run_clustering_and_write(session_id, items, req.granularity)
    return groups_db.get_session_detail(session_id)


@router.delete("/grouping/sessions/{session_id}")
def delete_session(session_id: int):
    groups_db.delete_session(session_id)
    return {"deleted": True}


# ---- manual group editing --------------------------------------------------------

class RenameGroupRequest(BaseModel):
    name: str


@router.patch("/grouping/groups/{group_id}")
def rename_group(group_id: int, req: RenameGroupRequest):
    groups_db.rename_group(group_id, req.name)
    return {"renamed": True}


class MoveMemberRequest(BaseModel):
    membership_id: int
    target_group_id: int


@router.post("/grouping/groups/move-member")
def move_member(req: MoveMemberRequest):
    groups_db.move_membership(req.membership_id, req.target_group_id)
    return {"moved": True}


@router.delete("/grouping/members/{membership_id}")
def remove_member(membership_id: int):
    groups_db.remove_membership(membership_id)
    return {"removed": True}


class MergeGroupsRequest(BaseModel):
    source_group_id: int
    target_group_id: int


@router.post("/grouping/groups/merge")
def merge_groups(req: MergeGroupsRequest):
    import db

    conn = db.get_connection()
    try:
        rows = conn.execute(
            "SELECT id FROM group_membership WHERE group_id = ?", (req.source_group_id,)
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        groups_db.move_membership(row["id"], req.target_group_id)
    groups_db.delete_group(req.source_group_id)
    return {"merged": True}


class SplitGroupRequest(BaseModel):
    group_id: int


@router.post("/grouping/groups/split")
def split_group(req: SplitGroupRequest):
    """Re-clusters just this group's members into two subgroups (granularity
    tightened relative to the session default), replacing the original."""
    import db

    conn = db.get_connection()
    try:
        group_row = conn.execute('SELECT * FROM "group" WHERE id = ?', (req.group_id,)).fetchone()
        if group_row is None:
            raise HTTPException(404, "Group not found.")
        member_rows = conn.execute(
            "SELECT * FROM group_membership WHERE group_id = ?", (req.group_id,)
        ).fetchall()
    finally:
        conn.close()

    if len(member_rows) < 2:
        raise HTTPException(400, "A group needs at least 2 items to split.")

    session_id = group_row["grouping_session_id"]
    vectors, texts, items = [], [], []
    for m in member_rows:
        record = groups_db.resolve_item(m["item_type"], m["item_id"])
        if record is None:
            continue
        vec = blob_to_vector(record["embedding"]) if record.get("embedding") else embed_text(record["text"] or "")
        vectors.append(vec)
        texts.append(record["text"] or "")
        items.append((m["item_type"], m["item_id"]))

    from sklearn.cluster import KMeans
    import numpy as np

    k = 2
    matrix = np.vstack(vectors)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(matrix)
    sub_labels = km.labels_.tolist()

    texts_by_label: dict[int, list[str]] = {}
    for label, text in zip(sub_labels, texts):
        texts_by_label.setdefault(label, []).append(text)
    auto_labels = label_groups(texts_by_label)

    new_group_ids = {}
    for label in sorted(set(sub_labels)):
        name = auto_labels.get(label, f"{group_row['name']} ({label + 1})")
        new_group_ids[label] = groups_db.create_group(session_id, name)

    for label, (item_type, item_id) in zip(sub_labels, items):
        groups_db.add_membership(new_group_ids[label], item_type, item_id)

    groups_db.delete_group(req.group_id)
    groups_db.touch_session(session_id)
    return groups_db.get_session_detail(session_id)
