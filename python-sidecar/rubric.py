"""The Feature 3 rating rubric: six 0-10 sub-scores, combined into one
overall 1-10 score by a set of adjustable weights. Deliberately all
deterministic embedding-similarity + text-statistics, no LLM judgment call -
see the PRD for why: this keeps scoring instant, explainable, and exactly
reproducible, which "transparent and adjustable" requires far more than an
LLM's qualitative judgment would deliver.

Every number here (filler list, sensory lexicon, ideal length range,
relevance floor/ceiling) is part of DEFAULT_RUBRIC_CONFIG below and travels
with each TopicQuery as adjustable, visible config - nothing is hidden.
"""
import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from cleanup import DEFAULT_FILLER_WORDS

SENSORY_EMOTIONAL_WORDS = {
    "felt", "feel", "feeling", "saw", "heard", "smelled", "tasted", "touched",
    "loved", "hated", "scared", "afraid", "happy", "sad", "angry", "proud",
    "cried", "laughed", "smiled", "beautiful", "terrible", "amazing",
    "remember", "remembered", "realized", "wondered", "hoped", "feared",
    "warm", "cold", "bright", "dark", "loud", "quiet", "soft", "sharp",
}

DISCOURSE_CONNECTIVES = {
    "because", "therefore", "however", "although", "then", "so", "since",
    "meanwhile", "eventually", "afterward", "afterwards", "first", "next",
    "finally", "but", "and then", "as a result", "in the end",
}

DEFAULT_RUBRIC_CONFIG = {
    "weights": {
        "relevance": 0.40,
        "depth": 0.15,
        "quotability": 0.15,
        "coherence": 0.10,
        "uniqueness": 0.10,
        "length_fit": 0.10,
    },
    # Cosine similarity floor/ceiling used to stretch relevance onto 0-10.
    # Text-embedding cosine similarity rarely spans the full -1..1 range in
    # practice; two *unrelated* passages from the same embedding model still
    # commonly land around 0.2-0.35, so treating that as "0" (rather than 0
    # itself) keeps the 0-10 scale meaningful instead of bunching everything
    # into 3-8.
    "relevance_floor": 0.25,
    "relevance_ceiling": 0.80,
    # Length-fit "sweet spot" for book-chapter source material, in words.
    "length_fit_ideal_min": 300,
    "length_fit_ideal_max": 3000,
}


def _word_count(text: str) -> int:
    return len(text.split())


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def score_relevance(topic_vec: np.ndarray, item_vec: np.ndarray, config: dict) -> tuple[float, float]:
    """Returns (score_0_10, raw_cosine_similarity)."""
    cos_sim = float(np.dot(topic_vec, item_vec))
    floor = config.get("relevance_floor", DEFAULT_RUBRIC_CONFIG["relevance_floor"])
    ceiling = config.get("relevance_ceiling", DEFAULT_RUBRIC_CONFIG["relevance_ceiling"])
    span = max(ceiling - floor, 1e-6)
    score = (cos_sim - floor) / span * 10
    return max(0.0, min(10.0, score)), cos_sim


def score_depth(text: str, topic_text: str) -> float:
    words = _word_count(text)
    # Log scale so 500 words doesn't need to be "twice as deep" as 250 to
    # register - depth flattens out rather than growing without bound.
    length_component = min(10.0, float(np.log1p(words) / np.log1p(600) * 10))

    try:
        vec = TfidfVectorizer(stop_words="english", max_features=100)
        matrix = vec.fit_transform([topic_text, text])
        topic_terms = set(
            vec.get_feature_names_out()[i]
            for i in matrix[0].toarray().flatten().argsort()[::-1][:15]
            if matrix[0, i] > 0
        )
        text_terms = set(
            vec.get_feature_names_out()[i]
            for i in matrix[1].toarray().flatten().argsort()[::-1][:30]
            if matrix[1, i] > 0
        )
        overlap = len(topic_terms & text_terms) / max(len(topic_terms), 1)
        overlap_component = min(10.0, overlap * 15)
    except ValueError:
        overlap_component = 0.0

    return round(0.6 * length_component + 0.4 * overlap_component, 2)


def score_quotability(text: str) -> float:
    sentences = _sentences(text)
    if not sentences:
        return 0.0

    words = text.lower().split()
    total_words = max(len(words), 1)

    good_length = [s for s in sentences if 6 <= len(s.split()) <= 35]
    completeness = len(good_length) / len(sentences)

    sensory_hits = sum(1 for w in words if w.strip(".,!?\"'") in SENSORY_EMOTIONAL_WORDS)
    sensory_density = min(1.0, sensory_hits / total_words * 20)

    filler_hits = sum(1 for w in words if w.strip(".,!?\"'") in DEFAULT_FILLER_WORDS)
    filler_penalty = min(1.0, filler_hits / total_words * 15)

    raw = completeness * 5 + sensory_density * 4 - filler_penalty * 3
    return round(max(0.0, min(10.0, raw)), 2)


def score_coherence(text: str) -> float:
    sentences = _sentences(text)
    if not sentences:
        return 0.0

    words = text.lower().split()
    total_words = max(len(words), 1)

    filler_hits = sum(1 for w in words if w.strip(".,!?\"'") in DEFAULT_FILLER_WORDS)
    filler_ratio = filler_hits / total_words
    filler_score = max(0.0, 1 - filler_ratio * 12)

    lengths = [len(s.split()) for s in sentences]
    variance = float(np.std(lengths)) if len(lengths) > 1 else 0.0
    # Some variance is natural/good (mixed short and long sentences read
    # well); only heavily penalize extreme, erratic variance.
    variance_score = max(0.0, 1 - max(0.0, variance - 12) / 20)

    connective_hits = sum(1 for w in words if w.strip(".,!?\"'") in DISCOURSE_CONNECTIVES)
    connective_score = min(1.0, connective_hits / max(len(sentences), 1) * 4)

    raw = (filler_score * 4 + variance_score * 3 + connective_score * 3)
    return round(max(0.0, min(10.0, raw)), 2)


def score_length_fit(text: str, config: dict) -> float:
    words = _word_count(text)
    ideal_min = config.get("length_fit_ideal_min", DEFAULT_RUBRIC_CONFIG["length_fit_ideal_min"])
    ideal_max = config.get("length_fit_ideal_max", DEFAULT_RUBRIC_CONFIG["length_fit_ideal_max"])

    if ideal_min <= words <= ideal_max:
        return 10.0
    if words < ideal_min:
        if words <= 0:
            return 0.0
        return round(max(0.0, words / ideal_min) * 10, 2)
    # Beyond the ideal max: fall off gradually, never below 2 (a long
    # recording can still contain one great chapter-worthy passage).
    overflow_ratio = (words - ideal_max) / ideal_max
    return round(max(2.0, 10 - overflow_ratio * 6), 2)


def score_uniqueness(item_vec: np.ndarray, other_vecs: list[np.ndarray]) -> float:
    if not other_vecs:
        return 10.0
    similarities = [float(np.dot(item_vec, v)) for v in other_vecs]
    max_similarity = max(similarities)
    # A near-duplicate (similarity approaching 1.0) scores near 0; anything
    # below ~0.6 similarity to its closest neighbor is treated as fully
    # unique.
    score = (1 - max_similarity) / 0.4 * 10
    return round(max(0.0, min(10.0, score)), 2)


def combine_scores(sub_scores: dict[str, float], weights: dict[str, float]) -> float:
    total_weight = sum(weights.values()) or 1.0
    weighted = sum(sub_scores.get(k, 0.0) * w for k, w in weights.items())
    # float(...) guards this JSON-response boundary against any numpy
    # scalar (e.g. numpy.float64) sneaking in from a sub-score - those
    # aren't JSON-serializable and produce a confusing 500 further downstream.
    return float(round(weighted / total_weight, 2))
