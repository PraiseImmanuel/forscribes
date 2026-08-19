"""Groups items by content similarity using their embeddings, and generates
a rough auto-label per group from distinguishing keywords.

Deliberately uses scikit-learn's AgglomerativeClustering with a cosine
distance_threshold rather than KMeans: it doesn't require knowing the number
of groups up front, and re-running it with a different threshold (the
"granularity" the user controls) is cheap - no re-embedding needed since it
only touches the already-computed vectors.
"""
import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.feature_extraction.text import TfidfVectorizer

# Granularity slider (0=very split, 1=very merged) maps into this cosine
# distance_threshold range. Tuned by feel against short personal-recording
# transcripts, not a formal calibration - the slider exists precisely so a
# fixed number was never going to be right for every archive.
MIN_THRESHOLD = 0.15
MAX_THRESHOLD = 0.75


def granularity_to_threshold(granularity: float) -> float:
    granularity = max(0.0, min(1.0, granularity))
    return MIN_THRESHOLD + granularity * (MAX_THRESHOLD - MIN_THRESHOLD)


def cluster_vectors(vectors: list[np.ndarray], granularity: float) -> list[int]:
    """Returns a cluster label (0-indexed, contiguous) per input vector."""
    n = len(vectors)
    if n == 0:
        return []
    if n == 1:
        return [0]

    threshold = granularity_to_threshold(granularity)
    matrix = np.vstack(vectors)

    model = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=threshold,
        metric="cosine",
        linkage="average",
    )
    labels = model.fit_predict(matrix)
    return labels.tolist()


def label_groups(texts_by_label: dict[int, list[str]], top_n: int = 3) -> dict[int, str]:
    """texts_by_label: cluster label -> list of member texts.
    Returns cluster label -> short human-readable label string, built from
    terms that are distinctive to that group relative to the whole set.
    """
    labels = list(texts_by_label.keys())
    if len(labels) < 2:
        # Nothing to contrast against - fall back to the most frequent
        # meaningful words in the one group there is.
        docs = [" ".join(texts_by_label[labels[0]])] if labels else []
        if not docs or not docs[0].strip():
            return {labels[0]: "Untitled group"} if labels else {}
        try:
            vec = TfidfVectorizer(stop_words="english", max_features=50)
            matrix = vec.fit_transform(docs)
            terms = _top_terms(vec, matrix[0], top_n)
            return {labels[0]: _format_label(terms)}
        except ValueError:
            return {labels[0]: "Untitled group"}

    docs = [" ".join(texts_by_label[label]) for label in labels]
    try:
        vec = TfidfVectorizer(stop_words="english", max_features=200)
        matrix = vec.fit_transform(docs)
    except ValueError:
        return {label: "Untitled group" for label in labels}

    result = {}
    for i, label in enumerate(labels):
        terms = _top_terms(vec, matrix[i], top_n)
        result[label] = _format_label(terms) if terms else "Untitled group"
    return result


def _top_terms(vectorizer: TfidfVectorizer, row, top_n: int) -> list[str]:
    array = row.toarray().flatten()
    if not array.any():
        return []
    top_indices = array.argsort()[::-1][:top_n]
    feature_names = vectorizer.get_feature_names_out()
    return [feature_names[i] for i in top_indices if array[i] > 0]


def _format_label(terms: list[str]) -> str:
    return ", ".join(t.title() for t in terms) if terms else "Untitled group"
