#!/usr/bin/env bash
# Comprueba que SSE llega en streaming (no solo cabeceras).
# Uso: bash scripts/sse-check.sh https://mi-url [event_id]
set -uo pipefail
cd "$(dirname "$0")/.."

URL="${1:-}"
EVENT_ID="${2:-1}"
if [[ -z "$URL" ]]; then
  URL=$(cat .tunnel-url 2>/dev/null || true)
fi
if [[ -z "$URL" ]]; then
  echo "Falta la URL"
  exit 1
fi

CURL=(curl -s)
if [[ "$URL" == *".ts.net"* ]]; then
  CURL+=(--doh-url https://1.1.1.1/dns-query)
fi

echo "SSE live ($URL)"
"${CURL[@]}" -N --no-buffer --max-time 7 "$URL/api/sse/live" | tr -d '\000' | grep -E '^(data|event):' | tail -4 || true
echo "SSE evento $EVENT_ID"
"${CURL[@]}" -N --no-buffer --max-time 4 "$URL/api/sse/events/$EVENT_ID" | grep -E '^(data|event):' | tail -2 || true
