#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose exec -T api python - <<'PY'
import urllib.request

request = urllib.request.Request("http://localhost:8000/admin/reset", method="POST")
request.add_header("x-admin-token", "tiquart-admin")
with urllib.request.urlopen(request) as response:
    print("reset:", response.status, response.read().decode())
PY
