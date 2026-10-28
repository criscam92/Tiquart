#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "--- HTTP paneles (localhost)"
for pair in "Portainer|http://127.0.0.1:9000/" "Glances|http://127.0.0.1:61208/" "WG-Easy|http://127.0.0.1:51821/" "Grafana|http://127.0.0.1:3001/api/health" "Prometheus|http://127.0.0.1:9090/-/ready"; do
  name="${pair%%|*}"
  url="${pair#*|}"
  code=$(curl -s -k -o /dev/null -m 10 -w "%{http_code}" "$url")
  echo "$name -> $code"
done

echo "--- puertos de mensajería"
python3 - <<'PY'
import socket
for host, port in (("127.0.0.1", 1883), ("127.0.0.1", 9001), ("127.0.0.1", 1139), ("127.0.0.1", 1445), ("127.0.0.1", 51820)):
    proto = socket.SOCK_DGRAM if port == 51820 else socket.SOCK_STREAM
    sock = socket.socket(socket.AF_INET, proto)
    sock.settimeout(2)
    try:
        if proto == socket.SOCK_STREAM:
            sock.connect((host, port))
            print(f"tcp {port} abierto")
        else:
            print(f"udp {port} (sin prueba de conexión)")
    except Exception as exc:  # noqa: BLE001
        print(f"{port} ERROR {exc}")
    finally:
        sock.close()
PY

echo "--- MQTT: espera un evento real y publica la compra"
mosquitto_sub -h 127.0.0.1 -t 'tiquart/#' -C 1 -W 20 > /tmp/mqtt-msg.txt 2>/dev/null &
SUB_PID=$!
sleep 2
docker compose exec -T api python - <<'PY'
import json, urllib.request
BASE = "http://localhost:8000"
def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as response:
        return response.status, json.loads(response.read() or b"{}")
_, events = call("GET", "/events")
_, seats = call("GET", f"/events/{events[0]['id']}/seats")
free = next(s for s in seats["seats"] if s["status"] == "available")
try:
    _, reg = call("POST", "/auth/register", {"name": "MQTT Check", "email": "mqtt-check@tiquart.com", "password": "demo1234"})
except Exception:
    _, reg = call("POST", "/auth/login", {"email": "mqtt-check@tiquart.com", "password": "demo1234"})
status, _ = call("POST", "/holds", {"event_id": events[0]["id"], "seat_ids": [free["id"]]}, token=reg["token"])
print("hold para MQTT:", status, free["label"])
PY
wait $SUB_PID || true
echo "mensaje MQTT recibido:"
cat /tmp/mqtt-msg.txt

echo "--- Samba (SMB en 1445)"
command -v smbclient >/dev/null || apt-get install -y -qq smbclient >/dev/null 2>&1 || true
if command -v smbclient >/dev/null; then
  smbclient -L 127.0.0.1 -p 1445 -N 2>&1 | head -20
else
  echo "smbclient no disponible"
fi
