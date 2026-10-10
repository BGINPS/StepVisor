#!/usr/bin/env python3
"""Minimal example: run StepVisor on a CSV with column I_I0."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stairdetect import find_stairs  # noqa: E402


def load_i_i0(path: Path) -> np.ndarray:
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f"empty CSV: {path}")
        fields = {h.strip(): h for h in reader.fieldnames}
        key = None
        for cand in ("I_I0", "I/I0", "signal"):
            if cand in fields:
                key = fields[cand]
                break
        if key is None:
            key = reader.fieldnames[0]
        vals = [float(row[key]) for row in reader if row.get(key) not in (None, "")]
    return np.asarray(vals, dtype=float)


def main() -> None:
    csv_path = ROOT / "examples" / "data" / "A_k9_example.csv"
    if len(sys.argv) > 1:
        csv_path = Path(sys.argv[1])
    x = load_i_i0(csv_path)
    out = find_stairs(x)
    print(f"file: {csv_path.name}")
    print(f"n samples (input series): {len(x)}")
    print(f"number of plateaus K: {out['stair_num']}")
    print(f"global sigma: {out['sigma']:.6g}")
    print("median currents:")
    for i, lv in enumerate(out["levels"], start=1):
        dur = out["duration_samples"][i - 1]
        print(f"  plateau {i:2d}: median={lv:.6g}  duration={dur}")


if __name__ == "__main__":
    main()
