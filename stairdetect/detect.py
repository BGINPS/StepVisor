"""
StepVisor core: plateau detection for nanopore peptide current.

Pipeline: preprocess → split → boundary refinement (merge) → optional end refinement.

This module is the reference Python implementation accompanying the StepVisor
manuscript (Methods / Supplementary Note S1).
"""

from __future__ import annotations

import math
import pickle
from pathlib import Path
from typing import Any

import numpy as np

SKIP_RATIO = 0.1
MIN_LEN = 50
K_SPLIT = 3.0
K_MERGE = 5.5
SIGMA_FLOOR_FACTOR = 0.65
BIC_SCALE = 1.0

END_ENABLE = True
END_WINDOW = 30
END_PLATEAU_START = 120
END_PLATEAU_END = 40
K_END = 2.5
MIN_END_LEN = 25
END_MIN_LAST_SEG = 80

K_SIGMA = K_SPLIT


def merge_jump_threshold(
    s1: float,
    s2: float,
    *,
    sigma_floor: float,
    k_merge: float = K_MERGE,
) -> float:
    """jump_min = K_MERGE · max(min(σ_L, σ_R), σ_floor)。"""
    sigma_amp = max(min(float(s1), float(s2)), float(sigma_floor))
    return float(k_merge) * sigma_amp


def load_reads(p: Path) -> dict[str, dict[str, Any]]:
    with p.open("rb") as f:
        obj = pickle.load(f)
    if not isinstance(obj, dict):
        raise TypeError(f"Expected dict, got {type(obj)}")
    return obj


def preprocess_signal(read_obj: dict[str, Any]) -> np.ndarray:
    signal = np.asarray(read_obj["signal"], dtype=float) / float(read_obj["OpenPore"])
    w = read_obj.get("window", None)
    if w is None:
        return signal
    start, end = w
    return signal[int(start) : int(end) + 1]


def apply_skip_tail(signal: np.ndarray, skip_ratio: float = SKIP_RATIO) -> tuple[np.ndarray, int]:
    x = np.asarray(signal, dtype=float)
    if x.size == 0:
        return x, 0
    offset = int(len(x) * float(skip_ratio))
    return x[offset:], offset


def sigma_diff_mad(signal: np.ndarray) -> float:
    x = np.asarray(signal, dtype=float)
    if len(x) < 3:
        return 0.0
    d = np.diff(x)
    med = np.median(d)
    mad = np.median(np.abs(d - med))
    return float(1.4826 * mad / math.sqrt(2.0))


def compute_min_len(signal: np.ndarray, base_min_len: int = MIN_LEN) -> int:
    n = max(0, int(len(signal)))
    base = int(math.ceil(n / 50.0)) if n > 0 else 0
    return max(int(base_min_len), base)


def auto_noise_params(n_total: int, sigma_global: float, min_len: int) -> dict[str, float]:
    eps = 1e-12
    n_cap = int(min(120, max(min_len * 2, round(math.sqrt(max(n_total, 1))))))
    return {
        "sigma_floor": max(float(sigma_global) * SIGMA_FLOOR_FACTOR, eps),
        "n_cap": max(n_cap, 1),
    }


def prefix_sums(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    csum = np.zeros(len(x) + 1, dtype=float)
    csumsq = np.zeros(len(x) + 1, dtype=float)
    csum[1:] = np.cumsum(x)
    csumsq[1:] = np.cumsum(x * x)
    return csum, csumsq


def sse_const(a: int, b: int, csum: np.ndarray, csumsq: np.ndarray) -> float:
    m = (csum[b] - csum[a]) / (b - a)
    return float((csumsq[b] - csumsq[a]) - (b - a) * m * m)


def segment_recursive_propose(
    signal: np.ndarray,
    L: int,
    R: int,
    min_len: int,
    k_split: float,
    sigma: float,
    transitions: list[int],
    csum: np.ndarray,
    csumsq: np.ndarray,
) -> None:
    n = R - L
    if n <= 2 * min_len:
        return
    s_before = sse_const(L, R, csum, csumsq)
    best_gain = 0.0
    best_k = None
    jump_ok_always = sigma <= 0
    for k in range(L + min_len, R - min_len):
        m1 = (csum[k] - csum[L]) / (k - L)
        m2 = (csum[R] - csum[k]) / (R - k)
        gain = s_before - (sse_const(L, k, csum, csumsq) + sse_const(k, R, csum, csumsq))
        if jump_ok_always or abs(m1 - m2) >= k_split * sigma:
            if gain > best_gain:
                best_gain = gain
                best_k = k
    if best_k is None:
        return
    transitions.append(best_k)
    segment_recursive_propose(signal, L, best_k, min_len, k_split, sigma, transitions, csum, csumsq)
    segment_recursive_propose(signal, best_k, R, min_len, k_split, sigma, transitions, csum, csumsq)


def delta_bic_merge(
    sse_split: float,
    sse_merged: float,
    n: int,
    *,
    bic_scale: float = BIC_SCALE,
) -> float:
    if n <= 1:
        return 0.0
    eps = 1e-12
    return float(n) * (
        math.log((float(sse_merged) + eps) / float(n))
        - math.log((float(sse_split) + eps) / float(n))
    ) - float(bic_scale) * math.log(float(n))


def cutpoint_metrics(
    signal: np.ndarray,
    trans: list[int],
    cut_idx: int,
    *,
    csum: np.ndarray,
    csumsq: np.ndarray,
    min_len: int,
    sigma_floor: float,
    n_cap: int,
    k_merge: float = K_MERGE,
    bic_scale: float = BIC_SCALE,
) -> dict[str, float | bool]:
    x = np.asarray(signal, dtype=float)
    a0, a1, a2 = trans[cut_idx - 1], trans[cut_idx], trans[cut_idx + 1]
    left = x[a0:a1]
    right = x[a1:a2]
    n1 = max(1, len(left))
    n2 = max(1, len(right))
    n_ac = n1 + n2

    med_l = float(np.median(left)) if n1 else 0.0
    med_r = float(np.median(right)) if n2 else 0.0
    jump = abs(med_r - med_l)

    s1 = max(float(sigma_diff_mad(left)), sigma_floor)
    s2 = max(float(sigma_diff_mad(right)), sigma_floor)
    sigma_amp = max(min(s1, s2), sigma_floor)
    jump_min = merge_jump_threshold(s1, s2, sigma_floor=sigma_floor, k_merge=k_merge)

    n1_eff = min(n1, n_cap)
    n2_eff = min(n2, n_cap)
    se = math.sqrt((s1 * s1) / n1_eff + (s2 * s2) / n2_eff + 1e-12)
    t_stat = jump / se

    sse_split = sse_const(a0, a1, csum, csumsq) + sse_const(a1, a2, csum, csumsq)
    sse_merged = sse_const(a0, a2, csum, csumsq)
    d_bic = delta_bic_merge(sse_split, sse_merged, n_ac, bic_scale=bic_scale)

    too_short = (n1 < min_len) or (n2 < min_len)
    low_jump = jump < jump_min
    low_t = t_stat < float(k_merge)
    merge_better = d_bic < 0.0
    deletable = too_short or low_jump or low_t or merge_better

    eps = 1e-12
    if too_short:
        priority = 0.0
    else:
        bic_score = 1.0 if not merge_better else 0.0
        priority = min(jump / max(jump_min, eps), t_stat / max(float(k_merge), eps), bic_score)

    return {
        "pos": float(a1),
        "jump": jump,
        "t": t_stat,
        "delta_bic": d_bic,
        "jump_min": jump_min,
        "sigma_amp": sigma_amp,
        "sigma_floor": float(sigma_floor),
        "too_short": too_short,
        "low_jump": low_jump,
        "low_t": low_t,
        "merge_better": merge_better,
        "deletable": deletable,
        "priority": priority,
        "n_left": float(n1),
        "n_right": float(n2),
    }


def merge_by_and_keep(
    signal: np.ndarray,
    transitions: list[int],
    *,
    min_len: int,
    sigma_global: float,
    k_merge: float = K_MERGE,
    bic_scale: float = BIC_SCALE,
    record_audit: bool = True,
) -> tuple[list[int], list[dict[str, Any]]]:
    x = np.asarray(signal, dtype=float)
    n_total = len(x)
    trans = sorted(set(int(t) for t in transitions if 0 <= int(t) <= n_total))
    if len(trans) <= 2:
        return trans, []

    aux = auto_noise_params(n_total, sigma_global, min_len)
    sigma_floor = aux["sigma_floor"]
    n_cap = int(aux["n_cap"])
    csum, csumsq = prefix_sums(x)
    audit: list[dict[str, Any]] = []

    while len(trans) > 2:
        candidates: list[tuple[float, int, dict[str, float | bool]]] = []
        for i in range(1, len(trans) - 1):
            m = cutpoint_metrics(
                x,
                trans,
                i,
                csum=csum,
                csumsq=csumsq,
                min_len=min_len,
                sigma_floor=sigma_floor,
                n_cap=n_cap,
                k_merge=k_merge,
                bic_scale=bic_scale,
            )
            if m["deletable"]:
                candidates.append((float(m["priority"]), i, m))
        if not candidates:
            break
        _, merge_at, metrics = min(candidates, key=lambda t: t[0])
        if record_audit:
            audit.append(
                {
                    "action": "merged",
                    "pos": int(metrics["pos"]),
                    "t": float(metrics["t"]),
                    "delta_bic": float(metrics["delta_bic"]),
                    "jump_min": float(metrics["jump_min"]),
                    "sigma_amp": float(metrics["sigma_amp"]),
                    "too_short": bool(metrics["too_short"]),
                    "low_jump": bool(metrics["low_jump"]),
                    "low_t": bool(metrics["low_t"]),
                    "merge_better": bool(metrics["merge_better"]),
                    "priority": float(metrics["priority"]),
                }
            )
        del trans[merge_at]

    return trans, audit


def build_state_table(signal: np.ndarray, transitions: list[int]) -> dict[str, list[float]]:
    x = np.asarray(signal, dtype=float)
    n_total = max(len(x), 1)
    levels: list[float] = []
    duration_samples: list[int] = []
    occupancy: list[float] = []
    for i in range(len(transitions) - 1):
        a, b = transitions[i], transitions[i + 1]
        seg = x[a:b]
        dur = max(0, b - a)
        levels.append(float(np.median(seg)) if dur else 0.0)
        duration_samples.append(int(dur))
        occupancy.append(float(dur) / float(n_total))
    return {
        "levels": levels,
        "duration_samples": duration_samples,
        "occupancy": occupancy,
    }


def probe_end_drop(
    signal: np.ndarray,
    transitions: list[int],
    *,
    sigma: float,
    min_len: int,
    end_enable: bool = END_ENABLE,
    end_window: int = END_WINDOW,
    plateau_start: int = END_PLATEAU_START,
    plateau_end: int = END_PLATEAU_END,
    k_end: float = K_END,
    min_end_len: int = MIN_END_LEN,
    end_min_last_seg: int = END_MIN_LAST_SEG,
) -> tuple[list[int], dict[str, Any] | None]:
    """merge 后补检末端下降；仅插入最后一个切点。"""
    x = np.asarray(signal, dtype=float)
    n = len(x)
    trans = sorted(set(int(t) for t in transitions if 0 <= int(t) <= n))
    if not end_enable or len(trans) < 2 or n < plateau_start:
        return trans, None

    ew = max(int(min_end_len), int(end_window))
    if ew >= n or plateau_end >= plateau_start:
        return trans, None

    last_start = trans[-2]
    last_len = n - last_start
    if last_len < int(end_min_last_seg):
        return trans, None

    guard = max(int(min_len) * 2, ew + 10)
    if any(t > n - guard for t in trans[1:-1]):
        return trans, None

    plateau_med = float(np.median(x[-plateau_start:-plateau_end]))
    end_med = float(np.median(x[-ew:]))
    drop = plateau_med - end_med
    drop_min = float(k_end) * float(sigma)
    if drop < drop_min:
        return trans, None

    cut = n - ew
    if cut <= last_start + int(min_end_len) or cut <= 0 or cut >= n:
        return trans, None

    new_trans = sorted(set(trans[:-1] + [cut, n]))
    return new_trans, {
        "action": "end_probe",
        "pos": int(cut),
        "drop": float(drop),
        "drop_min": float(drop_min),
        "plateau_med": float(plateau_med),
        "end_med": float(end_med),
        "end_window": int(ew),
    }


def build_stair(signal: np.ndarray, transitions: list[int], levels: list[float] | None = None) -> np.ndarray:
    x = np.asarray(signal, dtype=float)
    stair = np.zeros_like(x, dtype=float)
    for i in range(len(transitions) - 1):
        a, b = transitions[i], transitions[i + 1]
        if levels is not None and i < len(levels):
            stair[a:b] = levels[i]
        elif b > a:
            stair[a:b] = float(np.median(x[a:b]))
    return stair


def find_stairs(
    tail: np.ndarray,
    *,
    k_split: float = K_SPLIT,
    k_merge: float = K_MERGE,
    bic_scale: float = BIC_SCALE,
    record_audit: bool = True,
    end_enable: bool = END_ENABLE,
    end_window: int = END_WINDOW,
    k_end: float = K_END,
    min_end_len: int = MIN_END_LEN,
    end_min_last_seg: int = END_MIN_LAST_SEG,
) -> dict[str, Any]:
    x = np.asarray(tail, dtype=float)
    n = len(x)
    if n == 0:
        return {
            "transitions": [0],
            "stair": x,
            "sigma": 0.0,
            "stair_num": 0,
            "levels": [],
            "occupancy": [],
            "duration_samples": [],
            "cut_audit": [],
        }

    min_len = compute_min_len(x)
    sigma = sigma_diff_mad(x)
    csum, csumsq = prefix_sums(x)
    trans = [0, n]
    segment_recursive_propose(x, 0, n, min_len, k_split, sigma, trans, csum, csumsq)
    trans = sorted(set(trans))
    trans, cut_audit = merge_by_and_keep(
        x,
        trans,
        sigma_global=sigma,
        min_len=min_len,
        k_merge=k_merge,
        bic_scale=bic_scale,
        record_audit=record_audit,
    )
    trans, end_audit = probe_end_drop(
        x,
        trans,
        sigma=sigma,
        min_len=min_len,
        end_enable=end_enable,
        end_window=end_window,
        k_end=k_end,
        min_end_len=min_end_len,
        end_min_last_seg=end_min_last_seg,
    )
    if end_audit is not None and record_audit:
        cut_audit.append(end_audit)
    states = build_state_table(x, trans)
    stair = build_stair(x, trans, states["levels"])
    return {
        "transitions": trans,
        "stair": stair,
        "sigma": sigma,
        "stair_num": len(trans) - 1,
        "levels": states["levels"],
        "occupancy": states["occupancy"],
        "duration_samples": states["duration_samples"],
        "cut_audit": cut_audit,
    }


def detect_from_read(read_obj: dict, **kwargs: Any) -> dict[str, Any]:
    if "k_sigma" in kwargs and "k_split" not in kwargs:
        kwargs["k_split"] = kwargs.pop("k_sigma")
    sig_full = preprocess_signal(read_obj)
    tail, skip_offset = apply_skip_tail(sig_full)
    if tail.size == 0:
        return {
            "stair_num": 0,
            "tail": tail,
            "skip_offset": skip_offset,
            "transitions": [0],
            "stair": tail,
            "sigma": 0.0,
            "levels": [],
            "occupancy": [],
            "duration_samples": [],
            "cut_audit": [],
        }
    out = find_stairs(tail, **kwargs)
    out["tail"] = tail
    out["skip_offset"] = skip_offset
    return out


__all__ = [
    "SKIP_RATIO",
    "MIN_LEN",
    "K_SPLIT",
    "K_MERGE",
    "SIGMA_FLOOR_FACTOR",
    "K_SIGMA",
    "BIC_SCALE",
    "END_ENABLE",
    "END_WINDOW",
    "END_PLATEAU_START",
    "END_PLATEAU_END",
    "K_END",
    "MIN_END_LEN",
    "END_MIN_LAST_SEG",
    "load_reads",
    "preprocess_signal",
    "apply_skip_tail",
    "merge_jump_threshold",
    "probe_end_drop",
    "find_stairs",
    "detect_from_read",
    "merge_by_and_keep",
    "build_state_table",
]
