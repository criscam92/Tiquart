#!/usr/bin/env bash
# Imprime la URL pública actual y la guarda en .tunnel-url.
# Prioridad: Tailscale Funnel (estable, SSE) > Cloudflare quick tunnel.
set -uo pipefail
cd "$(dirname "$0")/.."

TS="/mnt/c/Program Files/Tailscale/tailscale.exe"
url=""

if [[ -x "$TS" ]]; then
  url=$("$TS" funnel status 2>/dev/null | grep -o 'https://[^ ]*' | head -1 || true)
fi

if [[ -z "$url" ]]; then
  url=$(docker compose logs cloudflared --no-log-prefix 2>&1 |
    grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
fi

if [[ -z "$url" ]]; then
  echo "No hay URL pública. Ejecuta: make tunnel" >&2
  exit 1
fi

printf '%s\n' "$url" > .tunnel-url
printf '%s\n' "$url"
