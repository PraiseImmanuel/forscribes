"""Local sentence embeddings via fastembed (ONNX Runtime - no PyTorch, keeps
the sidecar's dependency footprint small). Model weights download once on
first use and are cached under the user's home directory.

Transcripts can run long, and embedding models have a token limit and get
less precise over very long inputs anyway - so long text is split into
word-count chunks, each chunk is embedded separately, and the chunk vectors
are mean-pooled (then re-normalized) into one vector per transcript. This is
the standard, simple way to get a whole-document embedding out of a
sentence-embedding model.
"""
import threading

import numpy as np

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384
CHUNK_WORDS = 400

_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from fastembed import TextEmbedding

            _model = TextEmbedding(model_name=EMBEDDING_MODEL)
        return _model


def _chunk_text(text: str, chunk_words: int = CHUNK_WORDS) -> list[str]:
    words = text.split()
    if not words:
        return []
    return [
        " ".join(words[i : i + chunk_words])
        for i in range(0, len(words), chunk_words)
    ]


def embed_text(text: str) -> np.ndarray:
    """Returns a single L2-normalized float32 vector for the whole text."""
    chunks = _chunk_text(text)
    if not chunks:
        return np.zeros(EMBEDDING_DIM, dtype=np.float32)

    model = _get_model()
    vectors = list(model.embed(chunks))
    mean = np.mean(vectors, axis=0)
    norm = np.linalg.norm(mean)
    if norm > 0:
        mean = mean / norm
    return mean.astype(np.float32)


def embed_batch(texts: list[str]) -> list[np.ndarray]:
    return [embed_text(t) for t in texts]


def vector_to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def blob_to_vector(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
