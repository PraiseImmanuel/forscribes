"""Transcript cleanup: filler-word removal and paragraphing.

Deliberately simple, deterministic string/regex logic - no ML here. This
keeps cleanup instant and easy to reason about, and the filler word list is
just a plain list a future settings screen can expose for editing.
"""
import re

DEFAULT_FILLER_WORDS = [
    "um", "umm", "uh", "uhh", "erm", "hmm",
    "you know", "i mean", "sort of", "kind of",
    "basically", "actually", "literally",
]

# A pause longer than this between two whisper segments starts a new
# paragraph. Short pauses (a breath, a comma-pause) stay in the same one.
DEFAULT_PARAGRAPH_GAP_SECONDS = 2.5


def remove_fillers(text: str, filler_words: list[str] | None = None) -> str:
    words = filler_words if filler_words is not None else DEFAULT_FILLER_WORDS
    result = text
    for filler in words:
        pattern = r"\b" + re.escape(filler) + r"\b[,]?\s*"
        result = re.sub(pattern, "", result, flags=re.IGNORECASE)
    # Fix up spacing/punctuation left behind by removed words.
    result = re.sub(r"\s{2,}", " ", result)
    result = re.sub(r"\s+([.,!?])", r"\1", result)
    result = re.sub(r"(^|\.\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), result)
    return result.strip()


def paragraph_from_segments(
    segments: list[dict],
    gap_threshold: float = DEFAULT_PARAGRAPH_GAP_SECONDS,
) -> str:
    """segments: list of {"start": float, "end": float, "text": str}."""
    if not segments:
        return ""

    paragraphs: list[str] = []
    current: list[str] = []
    last_end: float | None = None

    for seg in segments:
        if last_end is not None and seg["start"] - last_end > gap_threshold and current:
            paragraphs.append(" ".join(current).strip())
            current = []
        current.append(seg["text"].strip())
        last_end = seg["end"]

    if current:
        paragraphs.append(" ".join(current).strip())

    return "\n\n".join(p for p in paragraphs if p)


def clean_transcript(
    segments: list[dict],
    filler_words: list[str] | None = None,
    gap_threshold: float = DEFAULT_PARAGRAPH_GAP_SECONDS,
) -> str:
    paragraphed = paragraph_from_segments(segments, gap_threshold)
    paragraphs = paragraphed.split("\n\n")
    cleaned_paragraphs = [remove_fillers(p, filler_words) for p in paragraphs]
    return "\n\n".join(p for p in cleaned_paragraphs if p)
