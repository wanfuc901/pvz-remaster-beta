"""Renders the Hoa Hồng Gai sounds with the game's own gen_audio toolkit,
without touching the rest of the catalogue.

Run: python render.py --gen-audio <pvz-remaster>/tools/gen_audio [--out wav] [--report report]

One-shots go through the shared mastering chain (same loudness groups as
the rest of the game). The flight loop keeps its exact period and carries
a "smpl" loop chunk.
"""
from __future__ import annotations

import argparse
import sys
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent


def seam_report(take: np.ndarray) -> str:
    """Compares the jump across the loop seam with ordinary sample steps."""
    steps = np.abs(np.diff(take))
    seam = abs(take[0] - take[-1])
    return f"seam jump {seam:.4f} (p99 step {np.percentile(steps, 99):.4f})"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gen-audio", type=Path, required=True, help="path to pvz-remaster/tools/gen_audio")
    parser.add_argument("--out", type=Path, default=HERE / "wav")
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    sys.path.insert(0, str(args.gen_audio.resolve()))
    sys.path.insert(0, str(HERE))

    import soundfile

    import build
    import dsp as d
    import sfx_rose_thorn as rose
    from registry import SOUNDS

    args.out.mkdir(parents=True, exist_ok=True)
    lines, firsts = [], {}
    for spec in [spec for spec in SOUNDS if spec.name.startswith("rose_thorn_")]:
        for index, take in enumerate(build.render(spec), start=1):
            soundfile.write(args.out / f"{spec.name}_{index}.wav", take.astype(np.float32), d.SAMPLE_RATE, subtype="PCM_16")
            if index == 1:
                firsts[spec.name] = take
                lines.append(build.describe(spec.name, take))
    for loop in rose.LOOPS:
        seed = zlib.crc32(f"{loop.name}:0".encode())
        take = rose.master_loop(loop.recipe(np.random.default_rng(seed), loop.period_sec), loop.period_sec)
        rose.write_loop_wav(args.out / f"{loop.name}_1.wav", take)
        firsts[loop.name] = take
        lines.append(build.describe(loop.name, take) + "  loop, " + seam_report(take))
    print("\n".join(lines))
    if args.report:
        args.report.mkdir(parents=True, exist_ok=True)
        (args.report / "levels.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        build.write_sheet(firsts, args.report / "sheet.png")


if __name__ == "__main__":
    main()
