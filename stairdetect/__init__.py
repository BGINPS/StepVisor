"""StepVisor: split–merge plateau detection for nanopore peptide current."""

from .detect import (
    BIC_SCALE,
    END_ENABLE,
    END_MIN_LAST_SEG,
    END_PLATEAU_END,
    END_PLATEAU_START,
    END_WINDOW,
    K_END,
    K_MERGE,
    K_SPLIT,
    MIN_END_LEN,
    MIN_LEN,
    SIGMA_FLOOR_FACTOR,
    SKIP_RATIO,
    detect_from_read,
    find_stairs,
    merge_by_and_keep,
    probe_end_drop,
)

__all__ = [
    "SKIP_RATIO",
    "MIN_LEN",
    "K_SPLIT",
    "K_MERGE",
    "SIGMA_FLOOR_FACTOR",
    "BIC_SCALE",
    "END_ENABLE",
    "END_WINDOW",
    "END_PLATEAU_START",
    "END_PLATEAU_END",
    "K_END",
    "MIN_END_LEN",
    "END_MIN_LAST_SEG",
    "detect_from_read",
    "find_stairs",
    "merge_by_and_keep",
    "probe_end_drop",
]

__version__ = "0.1.0"
