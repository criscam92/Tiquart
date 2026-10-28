#!/usr/bin/env bash
# Túnel público alternativo sin cuenta: localhost.run (SSH).
# Uso: bash scripts/ssh-tunnel.sh
# La URL queda en .tunnel-url y los logs en /tmp/tiquart-lhr.log
set -uo pipefail
cd "$(dirname "$0")/.."

rm -f .tunnel-url /tmp/tiquart-lhr.log
ssh -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=20 \
    -o ExitOnForwardFailure=yes \
    -R 80:localhost:8080 \
    nokey@localhost.run 2>&1 | tee -a /tmp/tiquart-lhr.log | while IFS= read -r line; do
  echo "$line"
  url=$(printf '%s' "$line" | grep -o 'https://[a-z0-9]*\.lhr\.life' | tail -1 || true)
  if [[ -n "$url" ]]; then
    printf '%s\n' "$url" > .tunnel-url
  fi
done
