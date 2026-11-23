#!/usr/bin/env bash
# Usage: DATABASE_URL=... scripts/load_vectors.sh SOURCE NPY IDS_JSON [ONLY_DIR]
# Streams vectors into a temp table and joins them onto references by source_key.
set -euo pipefail
SRC=$1; NPY=$2; IDS=$3; ONLY=${4:-}
TMP=$(mktemp)
ONLY_DIR="$ONLY" python3 "$(dirname "$0")/load_vectors.py" "$SRC" "$NPY" "$IDS" > "$TMP"
echo "rows: $(wc -l < "$TMP")"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP TABLE v_in (source_key text PRIMARY KEY, e3072 halfvec(3072), e1536 halfvec(1536));
\copy v_in FROM '$TMP'
UPDATE "references" r SET embedding = v.e3072, embedding_1536 = v.e1536
  FROM v_in v WHERE r.source_key = v.source_key;
SELECT count(*) AS with_vectors FROM "references" WHERE embedding IS NOT NULL;
SQL
rm -f "$TMP"
