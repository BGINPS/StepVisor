Plateau detection for nanopore peptide ionic-current signals (split → merge → optional end refinement), with a small browser demo.

| | |
|---|---|
| **Repository** | https://github.com/BGINPS/StepVisor |
| **Demo** | https://BGINPS.github.io/StepVisor/ |
| **Version** | 1.0.0 |

## Python

```bash
git clone https://github.com/BGINPS/StepVisor.git
cd StepVisor
python -m pip install -e .
python examples/run_example.py
```

```python
import numpy as np
from stairdetect import find_stairs

x = np.loadtxt("examples/data/A_k9_example.csv", delimiter=",", skiprows=1)
out = find_stairs(x)
print(out["stair_num"], out["levels"])
```

Requires Python ≥ 3.9 and NumPy. For `signal` + `OpenPore` (+ optional `window`), use `detect_from_read`.

## Citation & license

See `CITATION.cff`. MIT — see `LICENSE`.
