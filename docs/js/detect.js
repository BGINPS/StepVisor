/**
 * StepVisor v1.0 — JS port (Split → Merge → End).
 * Pure browser; no server required.
 */
(function (global) {
  "use strict";

  const DEFAULTS = {
    skipRatio: 0.1,
    minLen: 50,
    kSplit: 3.0,
    kMerge: 5.5,
    sigmaFloorFactor: 0.65,
    bicScale: 1.0,
    endEnable: true,
    endWindow: 30,
    endPlateauStart: 120,
    endPlateauEnd: 40,
    kEnd: 2.5,
    minEndLen: 25,
    endMinLastSeg: 80,
  };

  function median(arr) {
    const n = arr.length;
    if (n === 0) return 0;
    const a = Float64Array.from(arr).sort();
    const m = n >> 1;
    return n % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
  }

  function applySkipTail(signal, skipRatio) {
    const x = Float64Array.from(signal);
    if (x.length === 0) return { tail: x, skipOffset: 0 };
    const offset = Math.floor(x.length * skipRatio);
    return { tail: x.subarray(offset), skipOffset: offset };
  }

  function sigmaDiffMad(signal) {
    const x = signal;
    if (x.length < 3) return 0;
    const d = new Float64Array(x.length - 1);
    for (let i = 0; i < d.length; i++) d[i] = x[i + 1] - x[i];
    const med = median(d);
    const absDev = new Float64Array(d.length);
    for (let i = 0; i < d.length; i++) absDev[i] = Math.abs(d[i] - med);
    const mad = median(absDev);
    return (1.4826 * mad) / Math.sqrt(2.0);
  }

  function computeMinLen(signal, baseMinLen) {
    const n = signal.length;
    const base = n > 0 ? Math.ceil(n / 50.0) : 0;
    return Math.max(baseMinLen | 0, base);
  }

  function autoNoiseParams(nTotal, sigmaGlobal, minLen, sigmaFloorFactor) {
    const eps = 1e-12;
    const nCap = Math.min(
      120,
      Math.max(minLen * 2, Math.round(Math.sqrt(Math.max(nTotal, 1))))
    );
    return {
      sigmaFloor: Math.max(sigmaGlobal * sigmaFloorFactor, eps),
      nCap: Math.max(nCap, 1),
    };
  }

  function prefixSums(x) {
    const n = x.length;
    const csum = new Float64Array(n + 1);
    const csumsq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      csum[i + 1] = csum[i] + x[i];
      csumsq[i + 1] = csumsq[i] + x[i] * x[i];
    }
    return { csum, csumsq };
  }

  function sseConst(a, b, csum, csumsq) {
    const m = (csum[b] - csum[a]) / (b - a);
    return csumsq[b] - csumsq[a] - (b - a) * m * m;
  }

  function segmentRecursivePropose(L, R, minLen, kSplit, sigma, transitions, csum, csumsq) {
    const n = R - L;
    if (n <= 2 * minLen) return;
    const sBefore = sseConst(L, R, csum, csumsq);
    let bestGain = 0;
    let bestK = null;
    const jumpOkAlways = sigma <= 0;
    for (let k = L + minLen; k < R - minLen; k++) {
      const m1 = (csum[k] - csum[L]) / (k - L);
      const m2 = (csum[R] - csum[k]) / (R - k);
      const gain =
        sBefore - (sseConst(L, k, csum, csumsq) + sseConst(k, R, csum, csumsq));
      if (jumpOkAlways || Math.abs(m1 - m2) >= kSplit * sigma) {
        if (gain > bestGain) {
          bestGain = gain;
          bestK = k;
        }
      }
    }
    if (bestK === null) return;
    transitions.push(bestK);
    segmentRecursivePropose(L, bestK, minLen, kSplit, sigma, transitions, csum, csumsq);
    segmentRecursivePropose(bestK, R, minLen, kSplit, sigma, transitions, csum, csumsq);
  }

  function deltaBicMerge(sseSplit, sseMerged, n, bicScale) {
    if (n <= 1) return 0;
    const eps = 1e-12;
    return (
      n *
        (Math.log((sseMerged + eps) / n) - Math.log((sseSplit + eps) / n)) -
      bicScale * Math.log(n)
    );
  }

  function mergeJumpThreshold(s1, s2, sigmaFloor, kMerge) {
    const sigmaAmp = Math.max(Math.min(s1, s2), sigmaFloor);
    return kMerge * sigmaAmp;
  }

  function sliceArr(x, a, b) {
    const out = new Float64Array(b - a);
    for (let i = a; i < b; i++) out[i - a] = x[i];
    return out;
  }

  function cutpointMetrics(x, trans, cutIdx, csum, csumsq, minLen, sigmaFloor, nCap, kMerge, bicScale) {
    const a0 = trans[cutIdx - 1];
    const a1 = trans[cutIdx];
    const a2 = trans[cutIdx + 1];
    const left = sliceArr(x, a0, a1);
    const right = sliceArr(x, a1, a2);
    const n1 = Math.max(1, left.length);
    const n2 = Math.max(1, right.length);
    const nAc = n1 + n2;

    const medL = left.length ? median(left) : 0;
    const medR = right.length ? median(right) : 0;
    const jump = Math.abs(medR - medL);

    const s1 = Math.max(sigmaDiffMad(left), sigmaFloor);
    const s2 = Math.max(sigmaDiffMad(right), sigmaFloor);
    const sigmaAmp = Math.max(Math.min(s1, s2), sigmaFloor);
    const jumpMin = mergeJumpThreshold(s1, s2, sigmaFloor, kMerge);

    const n1Eff = Math.min(n1, nCap);
    const n2Eff = Math.min(n2, nCap);
    const se = Math.sqrt((s1 * s1) / n1Eff + (s2 * s2) / n2Eff + 1e-12);
    const tStat = jump / se;

    const sseSplit = sseConst(a0, a1, csum, csumsq) + sseConst(a1, a2, csum, csumsq);
    const sseMerged = sseConst(a0, a2, csum, csumsq);
    const dBic = deltaBicMerge(sseSplit, sseMerged, nAc, bicScale);

    const tooShort = n1 < minLen || n2 < minLen;
    const lowJump = jump < jumpMin;
    const lowT = tStat < kMerge;
    const mergeBetter = dBic < 0;
    const deletable = tooShort || lowJump || lowT || mergeBetter;

    const eps = 1e-12;
    let priority;
    if (tooShort) {
      priority = 0;
    } else {
      const bicScore = mergeBetter ? 0 : 1;
      priority = Math.min(jump / Math.max(jumpMin, eps), tStat / Math.max(kMerge, eps), bicScore);
    }

    return {
      pos: a1,
      jump,
      t: tStat,
      deltaBic: dBic,
      jumpMin,
      sigmaAmp,
      tooShort,
      lowJump,
      lowT,
      mergeBetter,
      deletable,
      priority,
    };
  }

  function uniqueSorted(arr, nTotal) {
    const s = new Set();
    for (const t of arr) {
      const v = t | 0;
      if (v >= 0 && v <= nTotal) s.add(v);
    }
    return Array.from(s).sort((a, b) => a - b);
  }

  function mergeByAndKeep(x, transitions, minLen, sigmaGlobal, kMerge, bicScale, sigmaFloorFactor) {
    const nTotal = x.length;
    let trans = uniqueSorted(transitions, nTotal);
    if (trans.length <= 2) return { transitions: trans, audit: [] };

    const aux = autoNoiseParams(nTotal, sigmaGlobal, minLen, sigmaFloorFactor);
    const { csum, csumsq } = prefixSums(x);
    const audit = [];

    while (trans.length > 2) {
      const candidates = [];
      for (let i = 1; i < trans.length - 1; i++) {
        const m = cutpointMetrics(
          x,
          trans,
          i,
          csum,
          csumsq,
          minLen,
          aux.sigmaFloor,
          aux.nCap,
          kMerge,
          bicScale
        );
        if (m.deletable) candidates.push({ priority: m.priority, i, m });
      }
      if (!candidates.length) break;
      candidates.sort((a, b) => a.priority - b.priority);
      const best = candidates[0];
      audit.push({ action: "merged", pos: best.m.pos | 0, priority: best.m.priority });
      trans.splice(best.i, 1);
    }
    return { transitions: trans, audit };
  }

  function buildStateTable(x, transitions) {
    const nTotal = Math.max(x.length, 1);
    const levels = [];
    const durationSamples = [];
    const occupancy = [];
    for (let i = 0; i < transitions.length - 1; i++) {
      const a = transitions[i];
      const b = transitions[i + 1];
      const dur = Math.max(0, b - a);
      const seg = dur ? sliceArr(x, a, b) : new Float64Array(0);
      levels.push(dur ? median(seg) : 0);
      durationSamples.push(dur);
      occupancy.push(dur / nTotal);
    }
    return { levels, durationSamples, occupancy };
  }

  function probeEndDrop(x, transitions, sigma, minLen, opts) {
    const n = x.length;
    let trans = uniqueSorted(transitions, n);
    if (!opts.endEnable || trans.length < 2 || n < opts.endPlateauStart) {
      return { transitions: trans, endAudit: null };
    }
    const ew = Math.max(opts.minEndLen | 0, opts.endWindow | 0);
    if (ew >= n || opts.endPlateauEnd >= opts.endPlateauStart) {
      return { transitions: trans, endAudit: null };
    }
    const lastStart = trans[trans.length - 2];
    const lastLen = n - lastStart;
    if (lastLen < opts.endMinLastSeg) return { transitions: trans, endAudit: null };

    const guard = Math.max(minLen * 2, ew + 10);
    for (let i = 1; i < trans.length - 1; i++) {
      if (trans[i] > n - guard) return { transitions: trans, endAudit: null };
    }

    const plateau = sliceArr(x, n - opts.endPlateauStart, n - opts.endPlateauEnd);
    const endSeg = sliceArr(x, n - ew, n);
    const plateauMed = median(plateau);
    const endMed = median(endSeg);
    const drop = plateauMed - endMed;
    const dropMin = opts.kEnd * sigma;
    if (drop < dropMin) return { transitions: trans, endAudit: null };

    const cut = n - ew;
    if (cut <= lastStart + opts.minEndLen || cut <= 0 || cut >= n) {
      return { transitions: trans, endAudit: null };
    }
    const newTrans = uniqueSorted(trans.slice(0, -1).concat([cut, n]), n);
    return {
      transitions: newTrans,
      endAudit: {
        action: "end_probe",
        pos: cut,
        drop,
        dropMin,
        plateauMed,
        endMed,
        endWindow: ew,
      },
    };
  }

  function buildStair(x, transitions, levels) {
    const stair = new Float64Array(x.length);
    for (let i = 0; i < transitions.length - 1; i++) {
      const a = transitions[i];
      const b = transitions[i + 1];
      const lv = levels && i < levels.length ? levels[i] : median(sliceArr(x, a, b));
      for (let j = a; j < b; j++) stair[j] = lv;
    }
    return stair;
  }

  function packStage(x, transitions) {
    const states = buildStateTable(x, transitions);
    return {
      transitions: transitions.slice(),
      levels: states.levels,
      durationSamples: states.durationSamples,
      stair: Array.from(buildStair(x, transitions, states.levels)),
      stairNum: transitions.length - 1,
    };
  }

  function detectWithStages(signal, userOpts) {
    const opts = Object.assign({}, DEFAULTS, userOpts || {});
    const { tail, skipOffset } = applySkipTail(signal, opts.skipRatio);
    if (!tail.length) throw new Error("signal empty after skip");

    const minLen = computeMinLen(tail, opts.minLen);
    const sigma = sigmaDiffMad(tail);
    const { csum, csumsq } = prefixSums(tail);
    const n = tail.length;

    let transSplit = [0, n];
    segmentRecursivePropose(0, n, minLen, opts.kSplit, sigma, transSplit, csum, csumsq);
    transSplit = uniqueSorted(transSplit, n);
    const afterSplit = packStage(tail, transSplit);

    const merged = mergeByAndKeep(
      tail,
      transSplit,
      minLen,
      sigma,
      opts.kMerge,
      opts.bicScale,
      opts.sigmaFloorFactor
    );
    const afterMerge = packStage(tail, merged.transitions);

    const ended = probeEndDrop(tail, merged.transitions, sigma, minLen, opts);
    const afterEnd = packStage(tail, ended.transitions);

    const table = afterEnd.levels.map((lv, i) => ({
      stair: i + 1,
      median: Math.round(lv * 1e5) / 1e5,
      duration: afterEnd.durationSamples[i],
      delta: i === 0 ? null : Math.round((lv - afterEnd.levels[i - 1]) * 1e5) / 1e5,
    }));

    return {
      tail: Array.from(tail),
      skipOffset,
      sigma,
      minLen,
      afterSplit,
      afterMerge,
      afterEnd,
      endAudit: ended.endAudit,
      table,
      params: opts,
    };
  }

  const api = {
    DEFAULTS,
    detectWithStages,
    median,
  };
  global.StepVisor = api;
  global.StairDetect = api; // legacy alias
})(typeof window !== "undefined" ? window : globalThis);
