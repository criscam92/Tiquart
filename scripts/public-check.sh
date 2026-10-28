#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

URL="${1:-}"
if [[ -z "$URL" ]]; then
  URL=$(cat .tunnel-url 2>/dev/null || true)
fi
if [[ -z "$URL" ]]; then
  URL=$(docker compose logs cloudflared 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
fi
if [[ -z "$URL" ]]; then
  echo "No hay URL de túnel. Usa: bash scripts/public-check.sh https://tu-url"
  exit 1
fi

echo "URL pública: $URL"
CURL=(curl -s)
# Tailscale Funnel: MagicDNS resuelve a la IP del tailnet, que no sirve el
# ingress desde WSL. Forzamos DNS público (DoH) para probar como un invitado.
if [[ "$URL" == *".ts.net"* ]]; then
  CURL+=(--doh-url https://1.1.1.1/dns-query)
fi
echo "--- rutas"
for path in "/" "/login" "/eventos/1" "/boletas" "/admin" "/live" "/api/events" "/api/stats/live"; do
  code=$("${CURL[@]}" -o /dev/null -m 20 -w "%{http_code}" "$URL$path")
  echo "$path -> $code"
done

echo "--- SSE a través del túnel"
bash scripts/sse-check.sh "$URL"
