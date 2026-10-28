#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "--- puertos en WSL"
ss -ltnp | grep -E ':(8080|3000|8000)\b' || echo "ninguno"

echo "--- desde el contenedor api"
docker compose exec -T api python - <<'PY'
import urllib.request

for url in ("http://api:8000/health", "http://web:3000", "http://traefik:80/api/events"):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read()
            print(url, response.status, len(body))
    except Exception as exc:  # noqa: BLE001
        print(url, "ERROR", exc)
PY

echo "--- desde WSL (localhost)"
curl -s -m 5 -o /dev/null -w "traefik localhost: %{http_code}\n" http://localhost:8080/ || echo "curl falló"
curl -s -m 5 -o /dev/null -w "web directo:     %{http_code}\n" http://localhost:3000/ || echo "web no publicado"
