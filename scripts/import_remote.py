"""Import sidecars (+ images + vectors) into a deployed library over HTTPS.

  BASE=https://... EMAIL=... PASSWORD=... [CONCURRENCY=6] python3 scripts/import_remote.py SOURCE DIR [NPY IDS_JSON]

One request per reference. Resumable: references already in the library (with image and vector)
are skipped, so the same command can simply be run again after an interruption.
Only the first 1536 vector dims are sent (the library stores 1536). Images over 3 MB are
re-encoded to JPEG (max 3000 px) so each request stays under the 4.5 MB function limit.
"""
import base64, io, json, os, sys, time, concurrent.futures as cf
import requests

BASE, SOURCE, DIR = os.environ['BASE'].rstrip('/'), sys.argv[1], sys.argv[2]
vec = {}
if len(sys.argv) > 4:
    import numpy as np
    V = np.load(sys.argv[3], mmap_mode='r')
    ids = json.load(open(sys.argv[4]))
    vec = {k: i for i, k in enumerate(ids)}

s = requests.Session()
s.mount('https://', requests.adapters.HTTPAdapter(pool_maxsize=32))
if os.environ.get('BYPASS'):
    s.headers['x-vercel-protection-bypass'] = os.environ['BYPASS']


def login():
    tok = s.post(f'{BASE}/api/users/login', json={'email': os.environ['EMAIL'], 'password': os.environ['PASSWORD']}).json()['token']
    s.headers['Authorization'] = f'JWT {tok}'


login()
last_login = time.time()

# Already imported (resume).
have, after = set(), 0
while True:
    r = s.get(f'{BASE}/api/references/keys', params={'source': SOURCE, 'after': after}, timeout=120).json()
    have.update(r['keys'])
    if not r['last'] or len(r['keys']) < 5000:
        break
    after = r['last']
print(f'{len(have)} already in the library', flush=True)


def image_bytes(path):
    data = open(path, 'rb').read()
    if len(data) <= 3_000_000:
        return data, os.path.basename(path)
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert('RGB')
    im.thumbnail((3000, 3000))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=88)
    return buf.getvalue(), os.path.splitext(os.path.basename(path))[0] + '.jpg'


def one(f):
    global last_login
    sc = json.load(open(os.path.join(DIR, f)))
    if f"{SOURCE}:{sc['id']}" in have:
        return 'skip'
    body = {'source': SOURCE, 'sidecar': sc}
    img = os.path.join(DIR, sc.get('file') or f"{sc['id']}.jpg")
    if os.path.exists(img):
        data, name = image_bytes(img)
        body['image'] = base64.b64encode(data).decode()
        body['filename'] = name
    if sc['id'] in vec:
        body['vector'] = [round(float(x), 6) for x in V[vec[sc['id']]][:1536]]
    err = None
    for attempt in range(6):
        try:
            r = s.post(f'{BASE}/api/references/import', json=body, timeout=180)
            if r.ok:
                return 'ok'
            if r.status_code == 401 and time.time() - last_login > 60:
                last_login = time.time()
                login()
            err = f'{r.status_code} {r.text[:200]}'
        except requests.RequestException as e:
            err = repr(e)[:200]
        time.sleep(min(60, 2 ** attempt))
    print('failed', f, err, flush=True)
    return 'fail'


files = sorted(x for x in os.listdir(DIR) if x.endswith('.json'))
n = {'ok': 0, 'skip': 0, 'fail': 0}
t0 = time.time()
with cf.ThreadPoolExecutor(int(os.environ.get('CONCURRENCY', 6))) as ex:
    for i, res in enumerate(ex.map(one, files), 1):
        n[res] += 1
        if i % 200 == 0:
            rate = n['ok'] / max(1, time.time() - t0)
            left = (len(files) - i) / max(rate, 1e-6) / 3600 if rate else 0
            print(f'{SOURCE} {i}/{len(files)} {n} {rate:.1f}/s ~{left:.1f} h left', flush=True)
print(f'done {SOURCE} {n}', flush=True)
