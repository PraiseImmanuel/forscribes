"""Hardware detection and Whisper model recommendation.

We never assume a beefy machine: this app is built and tested on a weak
dual-core laptop with no GPU, but has to work well on stronger machines other
people run it on too. So we detect what's actually available and suggest a
sensible default - the user can always override it.
"""
import os

import psutil

try:
    import ctranslate2
except ImportError:  # pragma: no cover - ctranslate2 ships with faster-whisper
    ctranslate2 = None

# Ordered weakest -> strongest. min_ram_gb / min_cores are soft gates used by
# recommend_model() below, not hard limits - the user can pick any of these
# regardless of what we recommend.
MODELS = [
    {
        "id": "tiny",
        "label": "Tiny",
        "params": "39M",
        "approx_download_mb": 75,
        "speed": "fastest",
        "accuracy": "basic",
    },
    {
        "id": "base",
        "label": "Base",
        "params": "74M",
        "approx_download_mb": 145,
        "speed": "very fast",
        "accuracy": "good",
    },
    {
        "id": "small",
        "label": "Small",
        "params": "244M",
        "approx_download_mb": 480,
        "speed": "fast",
        "accuracy": "better",
    },
    {
        "id": "medium",
        "label": "Medium",
        "params": "769M",
        "approx_download_mb": 1500,
        "speed": "moderate",
        "accuracy": "very good",
    },
    {
        "id": "large-v3-turbo",
        "label": "Large v3 Turbo",
        "params": "809M",
        "approx_download_mb": 1600,
        "speed": "fast for its accuracy (needs a decent CPU or a GPU)",
        "accuracy": "near-best",
    },
    {
        "id": "large-v3",
        "label": "Large v3",
        "params": "1.55B",
        "approx_download_mb": 3100,
        "speed": "slow on CPU, fast on GPU",
        "accuracy": "best",
    },
]


def detect_hardware() -> dict:
    # Physical cores, not logical/hyperthreaded ones: hyperthreading doesn't
    # give a proportional speedup for a compute-bound workload like this, so
    # counting logical cores over-recommends on older dual-core-with-HT CPUs.
    cpu_count = psutil.cpu_count(logical=False) or os.cpu_count() or 2
    total_ram_gb = psutil.virtual_memory().total / (1024**3)

    cuda_device_count = 0
    if ctranslate2 is not None:
        try:
            cuda_device_count = ctranslate2.get_cuda_device_count()
        except Exception:
            cuda_device_count = 0

    return {
        "cpu_count": cpu_count,
        "logical_cpu_count": os.cpu_count() or cpu_count,
        "total_ram_gb": round(total_ram_gb, 1),
        "has_gpu": cuda_device_count > 0,
        "cuda_device_count": cuda_device_count,
    }


def recommend_model(hw: dict) -> str:
    if hw["has_gpu"]:
        return "large-v3-turbo"
    if hw["cpu_count"] <= 2 or hw["total_ram_gb"] < 6:
        return "base"
    if hw["total_ram_gb"] < 10:
        return "small"
    return "medium"


def device_and_compute_type(hw: dict) -> tuple[str, str]:
    if hw["has_gpu"]:
        return "cuda", "float16"
    return "cpu", "int8"
