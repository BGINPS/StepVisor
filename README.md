# StepVisor v1.0

**StepVisor** is the software release (algorithm + interactive demo) for **plateau detection** in nanopore peptide ionic-current signals. It converts a continuous current trace into a piecewise-constant plateau representation (candidate-boundary generation → boundary refinement → optional end refinement).

| | |
|---|---|
| **Name** | **StepVisor** (method + software; one brand) |
| **Release** | **StepVisor v1.0** (algorithm + browser visualization) |
| **Repository** | https://github.com/JiangShizhe/StepVisor |
| **Interactive demo** | https://JiangShizhe.github.io/StepVisor/ |
| **Version** | **1.0.0** |

> This repository provides the reference implementation and browser demo for manuscript reproducibility. Full analysis pipelines and raw sequencing datasets are maintained separately.

---

## Features

- **Split**: permissive recursive candidate boundaries (over-segmentation allowed)
- **Merge (boundary refinement)**: screen candidates by current jump, statistical evidence (*t*), and BIC
- **End refinement** (optional): recover short terminal plateaus
- Plateau levels summarized by **segment median**; detector does **not** fix the number of plateaus \(K\)

Default parameters (see Table S1 in the manuscript Supplementary Note):  
`skip_ratio=0.1`, `K_split=3.0`, `K_merge=5.5`, `K_end=2.5`, …

---

## Quick start (Python)

```bash
git clone https://github.com/JiangShizhe/StepVisor.git
cd StepVisor
python -m pip install -e .
python examples/run_example.py
# or: python examples/run_example.py examples/data/E_k9_example.csv
```

Minimal API (Python package import name remains `stairdetect` for compatibility):

```python
import numpy as np
from stairdetect import find_stairs

x = np.loadtxt("examples/data/A_k9_example.csv", delimiter=",", skiprows=1)
out = find_stairs(x)
print(out["stair_num"], out["levels"])
```

For a full read object (`signal` + `OpenPore` + optional `window`), use `detect_from_read(read_obj)`.

**Dependency:** Python ≥ 3.9, NumPy.

---

## Interactive browser demo

**Online:** https://JiangShizhe.github.io/StepVisor/  
(GitHub Pages serves the `docs/` folder.)

**Local:**

```bash
cd StepVisor
python -m http.server 8080 --directory docs
```

Open http://127.0.0.1:8080

1. Load a built-in example or upload a CSV  
2. If uploading: a small dialog asks which column to use, and optionally an OpenPore value  
   (**Selected** = use the column as-is; **Enter value** = divide by OpenPore; leave blank to use the column’s first sample)  
3. Click **Run** (v1.0 uses fixed defaults; no parameter panel)  
4. Inspect **Raw → After split → After merge → Final → Aligned**
   (`Aligned` = H1→0.3 height scaling + equal-width plateau index, for cross-read shape comparison)

### CSV input

Any numeric CSV with a header row works. After upload, pick the current column in the dialog.

Examples:

```csv
I_I0
0.258561
0.261539
```

```csv
sample_index,signal_pA
0,214.5
1,205.1
```

For raw current (pA), choose **Enter value** and leave OpenPore blank to divide by the first sample, or type an OpenPore value.

---

## Repository layout

```
stairdetect/          # Python package (reference implementation; import name unchanged)
  detect.py
examples/
  data/               # small CSV examples
  run_example.py
docs/                 # browser demo (GitHub Pages) — StepVisor v1.0 UI
  index.html
  css/ js/ examples/
LICENSE
CITATION.cff
pyproject.toml
```

---

## Citation

Please cite the associated manuscript when available, and this software release:

- Repository: https://github.com/JiangShizhe/StepVisor  
- See `CITATION.cff` (Zenodo DOI to be added with the archival release)

---

## License

MIT — see `LICENSE`.
