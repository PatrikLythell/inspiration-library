"""Import sidecars (+ images + vectors) into a deployed library over HTTPS.

  BASE=https://... EMAIL=... PASSWORD=... python3 scripts/import_remote.py SOURCE DIR [NPY IDS_JSON]

One request per reference, 4 in parallel. Idempotent (upserts on sourceKey).
"""
import base64, json, os, sys, time, concurrent.futures as cf
import requests

BASE, SOURCE, DIR = os.environ['BASE'].rstrip('/'), sys.argv[1], sys.argv[2]
vec = {}
if len(sys.argv) > 4:
    import numpy as np
    V = np.load(sys.argv[3], mmap_mode='r')
    ids = json.load(open(sys.argv[4]))
    vec = {k: i for i, k in enumerate(ids)}

s = requests.Session()
if os.environ.get('BYPASS'):
    s.headers['x-vercel-protection-bypass'] = os.environ['BYPASS']
tok = s.post(f'{BASE}/api/users/login', json={'email': os.environ['EMAIL'], 'password': os.environ['PASSWORD']}).json()['token']
s.headers['Authorization'] = f'JWT {tok}'

def one(f):
    sc = json.load(open(os.path.join(DIR, f)))
    body = {'source': SOURCE, 'sidecar': sc}
    img = os.path.join(DIR, sc.get('file') or f"{sc['id']}.jpg")
    if os.path.exists(img):
        body['image'] = base64.b64encode(open(img, 'rb').read()).decode()
        body['filename'] = os.path.basename(img)
    if sc['id'] in vec:
        body['vector'] = [float(x) for x in V[vec[sc['id']]]]
    err = None
    for attempt in range(5):
        try:
            r = s.post(f'{BASE}/api/references/import', json=body, timeout=120)
            if r.ok:
                return True
            err = f'{r.status_code} {r.text[:200]}'
        except requests.RequestException as e:
            err = repr(e)[:200]
        time.sleep(2 ** attempt)
    print('failed', f, err, flush=True)
    return False

files = sorted(x for x in os.listdir(DIR) if x.endswith('.json'))
ok = 0
with cf.ThreadPoolExecutor(int(os.environ.get('CONCURRENCY', 4))) as ex:
    for i, res in enumerate(ex.map(one, files), 1):
        ok += res
        if i % 50 == 0:
            print(f'{i}/{len(files)} ok={ok}', flush=True)
print(f'done {ok}/{len(files)}')
