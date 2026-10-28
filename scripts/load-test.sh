#!/usr/bin/env bash
# Carga de demo: 60 VUs comprando asientos + muestreo de CPU/RAM.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "--- reset"
bash scripts/reset.sh

rm -f /tmp/tiquart-stats.txt
(
  for _ in $(seq 1 12); do
    docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' >> /tmp/tiquart-stats.txt
    sleep 4
  done
) &
SAMPLER=$!

echo "--- k6"
docker compose --profile load run --rm k6

wait "$SAMPLER" 2>/dev/null || true

echo "--- pico de CPU por contenedor"
python3 - <<'PY'
from pathlib import Path
from collections import defaultdict

peaks = defaultdict(lambda: (0.0, ""))
for line in Path("/tmp/tiquart-stats.txt").read_text().splitlines():
    try:
        name, cpu, mem = line.split("|")
    except ValueError:
        continue
    value = float(cpu.strip().rstrip("%"))
    if value > peaks[name][0]:
        peaks[name] = (value, mem)

for name, (cpu, mem) in sorted(peaks.items(), key=lambda item: -item[1][0])[:8]:
    print(f"{cpu:6.1f}%  {name:28s} {mem}")
PY
