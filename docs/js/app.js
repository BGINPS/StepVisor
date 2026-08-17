/* StepVisor v1.0 static demo UI */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let uploadedSignal = null;
  let lastResult = null;

  function fillExamples() {
    const sel = $("example");
    sel.innerHTML = "";
    (window.STAIR_EXAMPLES || []).forEach((ex, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = ex.label;
      sel.appendChild(opt);
    });
  }

  function currentSignal() {
    if (uploadedSignal && uploadedSignal.length) return uploadedSignal;
    const idx = Number($("example").value);
    const ex = (window.STAIR_EXAMPLES || [])[idx];
    if (!ex) throw new Error("No example selected");
    return ex.signal;
  }

  function parseCsvText(text) {
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) throw new Error("Empty CSV");
    const header = lines[0].toLowerCase();
    let start = 0;
    let col = 0;
    let mode = "first";
    if (/[a-z_]/.test(header.replace(/[,.\d\s\-e+]/gi, ""))) {
      start = 1;
      const cols = lines[0].split(",").map((s) => s.trim());
      const iI0 = cols.findIndex((c) => c === "I_I0" || c === "i_i0");
      const iSig = cols.findIndex((c) => c.toLowerCase() === "signal");
      const iOp = cols.findIndex((c) => c.toLowerCase() === "openpore" || c === "OpenPore");
      if (iI0 >= 0) {
        col = iI0;
        mode = "i0";
      } else if (iSig >= 0 && iOp >= 0) {
        mode = "raw";
      } else {
        col = 0;
        mode = "first";
      }
    }
    const out = [];
    if (mode === "raw") {
      const cols = lines[0].split(",").map((s) => s.trim());
      const iSig = cols.findIndex((c) => c.toLowerCase() === "signal");
      const iOp = cols.findIndex((c) => c.toLowerCase() === "openpore");
      for (let i = start; i < lines.length; i++) {
        const p = lines[i].split(",");
        const s = Number(p[iSig]);
        const o = Number(p[iOp]);
        if (Number.isFinite(s) && Number.isFinite(o) && o !== 0) out.push(s / o);
      }
    } else {
      for (let i = start; i < lines.length; i++) {
        const p = lines[i].split(",");
        const v = Number(p[col]);
        if (Number.isFinite(v)) out.push(v);
      }
    }
    if (!out.length) throw new Error("No numeric samples in CSV");
    return out;
  }

  function readParams() {
    // v1.0: always use built-in defaults (do not pass undefined overrides)
    return Object.assign({}, (window.StepVisor && window.StepVisor.DEFAULTS) || {});
  }

  function downsample(y, maxPts) {
    if (y.length <= maxPts) return { x: y.map((_, i) => i), y: Array.from(y) };
    const step = Math.ceil(y.length / maxPts);
    const x = [];
    const yy = [];
    for (let i = 0; i < y.length; i += step) {
      x.push(i);
      yy.push(y[i]);
    }
    return { x, y: yy };
  }

  function drawPlot(canvas, tail, stage, title) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight || 260;
    if (w < 2 || h < 2) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 48, r: 12, t: 28, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const raw = downsample(tail, 2500);
    const st = stage ? downsample(stage.stair, 2500) : null;

    let ymin = Infinity;
    let ymax = -Infinity;
    for (const v of raw.y) {
      if (v < ymin) ymin = v;
      if (v > ymax) ymax = v;
    }
    if (st) {
      for (const v of st.y) {
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
    const dy = ymax - ymin || 1e-6;
    ymin -= 0.05 * dy;
    ymax += 0.05 * dy;

    const xMax = tail.length - 1 || 1;
    const X = (i) => pad.l + (i / xMax) * plotW;
    const Y = (v) => pad.t + ((ymax - v) / (ymax - ymin)) * plotH;

    // axes
    ctx.strokeStyle = "#d0d4d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, pad.t + plotH);
    ctx.lineTo(pad.l + plotW, pad.t + plotH);
    ctx.stroke();

    ctx.fillStyle = "#1a1f24";
    ctx.font = "600 13px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillText(title, pad.l, 18);
    ctx.font = "11px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillStyle = "#5a6570";
    ctx.fillText("sample", pad.l + plotW / 2 - 18, h - 10);
    ctx.save();
    ctx.translate(14, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("I / I₀", 0, 0);
    ctx.restore();

    // raw
    ctx.strokeStyle = "#8a939c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    raw.x.forEach((xi, i) => {
      const px = X(xi);
      const py = Y(raw.y[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    if (stage) {
      // cut lines
      ctx.strokeStyle = "rgba(60,70,80,0.35)";
      ctx.lineWidth = 1;
      for (let i = 1; i < stage.transitions.length - 1; i++) {
        const t = stage.transitions[i];
        ctx.beginPath();
        ctx.moveTo(X(t), pad.t);
        ctx.lineTo(X(t), pad.t + plotH);
        ctx.stroke();
      }
      // stair
      ctx.strokeStyle = "#c44536";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      st.x.forEach((xi, i) => {
        const px = X(xi);
        const py = Y(st.y[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }

  function renderTable(rows) {
    const tb = $("level-table").querySelector("tbody");
    tb.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${r.stair}</td><td>${r.median}</td><td>${r.duration}</td><td>${
        r.delta === null || r.delta === undefined ? "—" : r.delta
      }</td>`;
      tb.appendChild(tr);
    });
  }

  function showStage(name) {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.stage === name);
    });
    if (!lastResult) return;
    const canvas = $("plot");
    const { tail } = lastResult;
    if (name === "raw") {
      drawPlot(canvas, tail, null, `Raw (after skip) · σ=${lastResult.sigma.toPrecision(4)}`);
    } else if (name === "split") {
      drawPlot(canvas, tail, lastResult.afterSplit, `After split · K=${lastResult.afterSplit.stairNum}`);
    } else if (name === "merge") {
      drawPlot(canvas, tail, lastResult.afterMerge, `After merge · K=${lastResult.afterMerge.stairNum}`);
    } else {
      drawPlot(canvas, tail, lastResult.afterEnd, `Final · K=${lastResult.afterEnd.stairNum}`);
    }
  }

  function run() {
    $("status").textContent = "Running…";
    try {
      if (!window.StepVisor || typeof window.StepVisor.detectWithStages !== "function") {
        throw new Error("StepVisor failed to load (detect.js)");
      }
      if (!(window.STAIR_EXAMPLES || []).length && !(uploadedSignal && uploadedSignal.length)) {
        throw new Error("No example data loaded (examples-data.js)");
      }
      const signal = currentSignal();
      const out = window.StepVisor.detectWithStages(signal, readParams());
      lastResult = out;
      let endNote = "";
      if (out.endAudit) {
        endNote = ` · end cut@${out.endAudit.pos} (drop=${out.endAudit.drop.toPrecision(4)})`;
      }
      $("status").innerHTML =
        `<strong>σ</strong>=${out.sigma.toPrecision(5)} · ` +
        `<strong>K</strong>=${out.afterEnd.stairNum} · ` +
        `split→${out.afterSplit.stairNum} → merge→${out.afterMerge.stairNum} → end refinement→${out.afterEnd.stairNum}` +
        endNote;
      renderTable(out.table);
      const active = document.querySelector(".tab.active");
      const stage = active ? active.dataset.stage : "final";
      // draw after layout so canvas has non-zero size
      requestAnimationFrame(() => {
        showStage(stage);
        requestAnimationFrame(() => showStage(stage));
      });
    } catch (e) {
      $("status").textContent = "Error: " + e.message;
      console.error(e);
    }
  }

  function init() {
    try {
      fillExamples();
      $("file").addEventListener("change", (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) {
          uploadedSignal = null;
          $("file-label").textContent = "No file";
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            uploadedSignal = parseCsvText(String(reader.result));
            $("file-label").textContent = `${f.name} (${uploadedSignal.length} pts)`;
            run();
          } catch (e) {
            uploadedSignal = null;
            $("file-label").textContent = "Parse error";
            $("status").textContent = "Error: " + e.message;
          }
        };
        reader.readAsText(f);
      });
      $("clear-file").addEventListener("click", () => {
        uploadedSignal = null;
        $("file").value = "";
        $("file-label").textContent = "No file — using example";
        run();
      });
      $("example").addEventListener("change", () => {
        uploadedSignal = null;
        $("file").value = "";
        $("file-label").textContent = "No file — using example";
        run();
      });
      $("run").addEventListener("click", run);
      document.querySelectorAll(".tab").forEach((b) => {
        b.addEventListener("click", () => showStage(b.dataset.stage));
      });
      window.addEventListener("resize", () => {
        if (lastResult) {
          const active = document.querySelector(".tab.active");
          showStage(active ? active.dataset.stage : "final");
        }
      });
      run();
    } catch (e) {
      $("status").textContent = "Error: " + e.message;
      console.error(e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
