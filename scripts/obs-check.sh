#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "--- health"
curl -s -o /dev/null -w "grafana /api/health: %{http_code}\n" http://127.0.0.1:3001/api/health
curl -s -o /dev/null -w "prometheus /:        %{http_code}\n" http://127.0.0.1:9090/-/ready

echo "--- targets prometheus"
curl -s http://127.0.0.1:9090/api/v1/targets |
  python3 -c 'import json,sys; d=json.load(sys.stdin); [print(t["labels"]["job"], t["health"], t.get("lastError","")) for t in d["data"]["activeTargets"]]'

echo "--- dashboard provisionado"
curl -s -u admin:"${GRAFANA_PASSWORD:-tiquart}" "http://127.0.0.1:3001/api/search?query=Tiquart" |
  python3 -c 'import json,sys; d=json.load(sys.stdin); [print(x["title"], x.get("uid")) for x in d]'

echo "--- metricas de la app"
curl -s http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=tiquart_seats_sold' |
  python3 -c 'import json,sys; d=json.load(sys.stdin); print([(r["metric"].get("__name__"), r["value"][1]) for r in d["data"]["result"]])'
