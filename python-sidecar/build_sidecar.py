"""Bundles the Python sidecar into a single standalone .exe with PyInstaller,
so the installed app never needs Python on the end user's machine.

Run this from python-sidecar/ with the venv's Python:
    .venv\\Scripts\\python.exe build_sidecar.py

Output lands at src-tauri/binaries/forscribe-sidecar-<target-triple>.exe,
matching the name Tauri's `externalBin` bundling expects to find at
`tauri build` time. Re-run this before every release build.
"""
import platform
import shutil
import subprocess
import sys
from pathlib import Path

SIDECAR_DIR = Path(__file__).parent
BINARIES_DIR = SIDECAR_DIR.parent / "src-tauri" / "binaries"

# Native/compiled dependencies PyInstaller's static analysis tends to miss
# pieces of - safer to grab everything from these than debug missing-module
# errors one at a time in a bundle this size.
COLLECT_ALL = [
    "ctranslate2",
    "onnxruntime",
    "fastembed",
    "sklearn",
    "tokenizers",
    # faster_whisper ships its VAD model (silero_vad_v6.onnx) as package
    # data, not code - without --collect-all it's silently left out and
    # transcription fails at runtime with vad_filter=True.
    "faster_whisper",
]


def target_triple() -> str:
    machine = platform.machine().lower()
    arch = "x86_64" if machine in ("amd64", "x86_64") else machine
    return f"{arch}-pc-windows-msvc"


def main() -> None:
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name",
        "forscribe-sidecar",
        "--onefile",
        "--noconfirm",
        "--distpath",
        str(SIDECAR_DIR / "dist"),
        "--workpath",
        str(SIDECAR_DIR / "build"),
        "--specpath",
        str(SIDECAR_DIR),
    ]
    for pkg in COLLECT_ALL:
        cmd += ["--collect-all", pkg]
    cmd.append(str(SIDECAR_DIR / "main.py"))

    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=SIDECAR_DIR)

    built_exe = SIDECAR_DIR / "dist" / "forscribe-sidecar.exe"
    if not built_exe.exists():
        raise SystemExit(f"Expected PyInstaller output not found: {built_exe}")

    dest = BINARIES_DIR / f"forscribe-sidecar-{target_triple()}.exe"
    shutil.copy2(built_exe, dest)
    size_mb = dest.stat().st_size / (1024 * 1024)
    print(f"\nSidecar bundled: {dest} ({size_mb:.0f} MB)")


if __name__ == "__main__":
    main()
