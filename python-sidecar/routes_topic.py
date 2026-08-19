"""HTTP routes for Feature 3 (Topic-relevance query & rating)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import documents as documents_db
import groups as groups_db
import topic_query as tq_db
from embeddings import embed_text, blob_to_vector, vector_to_blob, EMBEDDING_MODEL
from rubric import (
    DEFAULT_RUBRIC_CONFIG,
    combine_scores,
    score_coherence,
    score_depth,
    score_length_fit,
    score_quotability,
    score_relevance,
    score_uniqueness,
)

router = APIRouter()


class CorpusItem(BaseModel):
    item_type: str
    item_id: int


class CreateTopicQueryRequest(BaseModel):
    name: str | None = None
    topic_source_type: str  # 'document' | 'text'
    topic_document_id: int | None = None
    topic_text: str | None = None
    corpus: list[CorpusItem]
    rubric_config: dict | None = None
    relevance_threshold: float = 4.0


def _resolve_topic_text(req: CreateTopicQueryRequest) -> str:
    if req.topic_source_type == "text":
        if not req.topic_text or not req.topic_text.strip():
            raise HTTPException(400, "topic_text is required when topic_source_type is 'text'.")
        return req.topic_text
    if req.topic_source_type == "document":
        if req.topic_document_id is None:
            raise HTTPException(400, "topic_document_id is required when topic_source_type is 'document'.")
        doc = documents_db.get_document(req.topic_document_id)
        if doc is None:
            raise HTTPException(404, "Topic document not found.")
        return doc["raw_text"]
    raise HTTPException(400, "topic_source_type must be 'document' or 'text'.")


def _run_scoring(
    topic_text: str,
    corpus: list[CorpusItem],
    rubric_config: dict,
    threshold: float,
) -> list[dict]:
    topic_vec = embed_text(topic_text)
    weights = rubric_config.get("weights", DEFAULT_RUBRIC_CONFIG["weights"])

    resolved = []
    for item in corpus:
        record = groups_db.resolve_item(item.item_type, item.item_id)
        if record is None:
            continue
        text = record.get("text") or ""
        if record.get("embedding"):
            vec = blob_to_vector(record["embedding"])
        else:
            vec = embed_text(text)
            groups_db.save_item_embedding(item.item_type, item.item_id, vector_to_blob(vec), EMBEDDING_MODEL)
        resolved.append({
            "item_type": item.item_type,
            "item_id": item.item_id,
            "title": record["title"],
            "text": text,
            "vec": vec,
        })

    # Pass 1: relevance + everything that doesn't depend on other items.
    for r in resolved:
        relevance_10, cos_sim = score_relevance(topic_vec, r["vec"], rubric_config)
        r["sub_scores"] = {
            "relevance": relevance_10,
            "depth": score_depth(r["text"], topic_text),
            "quotability": score_quotability(r["text"]),
            "coherence": score_coherence(r["text"]),
            "length_fit": score_length_fit(r["text"], rubric_config),
        }
        r["raw_cosine_similarity"] = cos_sim

    # Pass 2: uniqueness, relative to other items that look relevant enough
    # to matter (using the relevance sub-score alone as a cheap first cut,
    # before the full weighted score is even known).
    relevant_ids = {
        (r["item_type"], r["item_id"])
        for r in resolved
        if r["sub_scores"]["relevance"] >= threshold
    }
    for r in resolved:
        key = (r["item_type"], r["item_id"])
        if key in relevant_ids:
            others = [
                o["vec"] for o in resolved
                if (o["item_type"], o["item_id"]) in relevant_ids and (o["item_type"], o["item_id"]) != key
            ]
            r["sub_scores"]["uniqueness"] = score_uniqueness(r["vec"], others)
        else:
            r["sub_scores"]["uniqueness"] = 10.0  # not competing for a "duplicate" slot

    # Pass 3: combine, rank.
    for r in resolved:
        r["relevance_score"] = combine_scores(r["sub_scores"], weights)

    resolved.sort(key=lambda r: r["relevance_score"], reverse=True)
    for i, r in enumerate(resolved):
        r["rank"] = i + 1

    return resolved


@router.post("/topics/queries")
def create_topic_query(req: CreateTopicQueryRequest):
    if not req.corpus:
        raise HTTPException(400, "Corpus is empty - add at least one transcript or document.")

    topic_text = _resolve_topic_text(req)
    rubric_config = req.rubric_config or DEFAULT_RUBRIC_CONFIG

    query_id = tq_db.create_topic_query(
        req.name,
        req.topic_source_type,
        req.topic_document_id,
        req.topic_text if req.topic_source_type == "text" else None,
        rubric_config,
        req.relevance_threshold,
    )

    results = _run_scoring(topic_text, req.corpus, rubric_config, req.relevance_threshold)
    tq_db.save_ratings(query_id, results)

    return _build_response(query_id, results, req.relevance_threshold)


def _build_response(query_id: int, results: list[dict], threshold: float) -> dict:
    count_above_threshold = sum(1 for r in results if r["relevance_score"] >= threshold)
    return {
        "query_id": query_id,
        "total_count": len(results),
        "count_above_threshold": count_above_threshold,
        "relevance_threshold": threshold,
        "results": [
            {
                "item_type": r["item_type"],
                "item_id": r["item_id"],
                "title": r["title"],
                "preview": r["text"][:200],
                "relevance_score": r["relevance_score"],
                "sub_scores": r["sub_scores"],
                "rank": r["rank"],
                "above_threshold": r["relevance_score"] >= threshold,
            }
            for r in results
        ],
    }


@router.get("/topics/queries")
def list_topic_queries():
    return {"queries": tq_db.list_topic_queries()}


@router.get("/topics/queries/{query_id}")
def get_topic_query(query_id: int):
    q = tq_db.get_topic_query(query_id)
    if q is None:
        raise HTTPException(404, "Topic query not found.")
    ratings = tq_db.get_ratings(query_id)
    threshold = q["relevance_threshold"]
    count_above = sum(1 for r in ratings if r["relevance_score"] >= threshold)
    results = []
    for r in sorted(ratings, key=lambda x: x["rank"]):
        item = groups_db.resolve_item(r["item_type"], r["item_id"])
        results.append({
            "item_type": r["item_type"],
            "item_id": r["item_id"],
            "title": item["title"] if item else "(deleted)",
            "preview": (item["text"][:200] if item and item.get("text") else ""),
            "relevance_score": r["relevance_score"],
            "sub_scores": r["sub_scores"],
            "rank": r["rank"],
            "above_threshold": r["relevance_score"] >= threshold,
        })
    return {
        "query": q,
        "total_count": len(results),
        "count_above_threshold": count_above,
        "relevance_threshold": threshold,
        "results": results,
    }


class UpdateRubricRequest(BaseModel):
    rubric_config: dict


@router.patch("/topics/queries/{query_id}/rubric")
def update_rubric(query_id: int, req: UpdateRubricRequest):
    """Re-weights from CACHED sub-scores - no re-embedding, no re-scoring
    the text itself. This is what makes weight adjustment instant."""
    q = tq_db.get_topic_query(query_id)
    if q is None:
        raise HTTPException(404, "Topic query not found.")

    tq_db.update_rubric_config(query_id, req.rubric_config)
    ratings = tq_db.get_ratings(query_id)
    weights = req.rubric_config.get("weights", DEFAULT_RUBRIC_CONFIG["weights"])

    for r in ratings:
        r["relevance_score"] = combine_scores(r["sub_scores"], weights)
    ratings.sort(key=lambda r: r["relevance_score"], reverse=True)
    for i, r in enumerate(ratings):
        r["rank"] = i + 1

    tq_db.clear_ratings(query_id)
    tq_db.save_ratings(query_id, ratings)

    return get_topic_query(query_id)


class UpdateThresholdRequest(BaseModel):
    relevance_threshold: float


@router.patch("/topics/queries/{query_id}/threshold")
def update_threshold(query_id: int, req: UpdateThresholdRequest):
    q = tq_db.get_topic_query(query_id)
    if q is None:
        raise HTTPException(404, "Topic query not found.")
    tq_db.update_threshold(query_id, req.relevance_threshold)
    return get_topic_query(query_id)


@router.post("/topics/queries/{query_id}/rerun")
def rerun_topic_query(query_id: int):
    """Full recompute against the current corpus - use if transcripts in
    the corpus have changed since the query was first run."""
    q = tq_db.get_topic_query(query_id)
    if q is None:
        raise HTTPException(404, "Topic query not found.")

    existing_ratings = tq_db.get_ratings(query_id)
    corpus = [CorpusItem(item_type=r["item_type"], item_id=r["item_id"]) for r in existing_ratings]
    if q["topic_source_type"] == "text":
        topic_text = q["topic_text"]
    else:
        doc = documents_db.get_document(q["topic_document_id"])
        if doc is None:
            raise HTTPException(404, "Topic document no longer exists.")
        topic_text = doc["raw_text"]

    results = _run_scoring(topic_text, corpus, q["rubric_config"], q["relevance_threshold"])
    tq_db.clear_ratings(query_id)
    tq_db.save_ratings(query_id, results)
    return get_topic_query(query_id)


@router.delete("/topics/queries/{query_id}")
def delete_topic_query(query_id: int):
    tq_db.delete_topic_query(query_id)
    return {"deleted": True}
