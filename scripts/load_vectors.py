"""Load stored image vectors into Postgres (halfvec 3072 + truncated 1536).

    python3 scripts/load_vectors.py SOURCE NPY IDS_JSON  > vectors.tsv
    psql "$DATABASE_URL" -c "\\copy ..."   (see scripts/load_vectors.sh)

Writes TSV rows: source_key \t [3072 floats] \t [1536 floats], only for ids given in
ONLY_IDS (a folder of sidecars) when set. Vectors are L2-normalised; the 1536 variant is the
first 1536 dims re-normalised (Matryoshka truncation).
"""
import json, os, sys
import numpy as np

source, npy, ids_json = sys.argv[1:4]
ids = json.load(open(ids_json))
V = np.load(npy, mmap_mode="r")
only = None
if os.environ.get("ONLY_DIR"):
    only = {f[:-5] for f in os.listdir(os.environ["ONLY_DIR"]) if f.endswith(".json")}

fmt = lambda v: "[" + ",".join(f"{x:.5f}" for x in v) + "]"
out = sys.stdout
for n, i in enumerate(ids):
    if only is not None and i not in only:
        continue
    v = np.asarray(V[n], dtype=np.float32)
    v = v / (np.linalg.norm(v) or 1)
    h = v[:1536] / (np.linalg.norm(v[:1536]) or 1)
    out.write(f"{source}:{i}\t{fmt(v)}\t{fmt(h)}\n")
