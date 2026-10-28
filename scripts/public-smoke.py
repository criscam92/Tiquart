#!/usr/bin/env python3
"""Prueba de humo contra la URL pública: compra real de una butaca.

Uso:
    python3 scripts/public-smoke.py                       # usa .tunnel-url
    python3 scripts/public-smoke.py https://mi-url        # URL explícita
    python3 scripts/public-smoke.py http://127.0.0.1:8080 # local

No valida el QR (el token va dentro de la imagen); para eso está `make smoke`.
"""

from __future__ import annotations

import json
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def base_url() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1].rstrip("/")
    tunnel = ROOT / ".tunnel-url"
    if tunnel.exists():
        value = tunnel.read_text().strip()
        if value:
            return value.rstrip("/")
    return "http://127.0.0.1:8080"


BASE = base_url()


def _public_ipv4(host: str) -> str:
    """Resuelve por DNS público (DoH): MagicDNS no sirve el ingress de Funnel desde WSL."""
    url = f"https://1.1.1.1/dns-query?name={host}&type=A"
    request = urllib.request.Request(url, headers={"Accept": "application/dns-json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        data = json.load(response)
    for answer in data.get("Answer", []):
        if answer.get("type") == 1:
            return answer["data"]
    raise RuntimeError(f"sin registro A público para {host}")


# Tailscale Funnel: el nombre .ts.net resuelve a la IP del tailnet, que no
# expone el puerto 443 dentro de WSL. Parcheamos la resolución para que las
# peticiones salgan por internet como las de un compañero.
_HOST = urlparse(BASE).hostname
if _HOST and _HOST.endswith(".ts.net"):
    _IP = _public_ipv4(_HOST)
    _original_getaddrinfo = socket.getaddrinfo

    def _getaddrinfo(host, port, *args, **kwargs):
        if host == _HOST:
            return _original_getaddrinfo(_IP, port, *args, **kwargs)
        return _original_getaddrinfo(host, port, *args, **kwargs)

    socket.getaddrinfo = _getaddrinfo
    print(f"resolviendo {_HOST} → {_IP} (DNS público)")


def call(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw or b"{}"), time.monotonic() - started
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {"raw": raw.decode(errors="replace")}
        return exc.code, payload, time.monotonic() - started


def check(name: str, condition: bool, detail: str = "") -> None:
    mark = "OK  " if condition else "FALLA"
    print(f"[{mark}] {name}{(' — ' + detail) if detail else ''}")
    if not condition:
        raise SystemExit(1)


def main() -> None:
    print(f"URL: {BASE}")

    status, events, elapsed = call("GET", "/api/events")
    check("GET /api/events", status == 200 and isinstance(events, list) and events, f"{status} · {elapsed * 1000:.0f} ms")
    event = events[0]

    status, payload, elapsed = call("GET", f"/api/events/{event['id']}/seats")
    seats = payload.get("seats", []) if isinstance(payload, dict) else []
    free = [seat for seat in seats if seat.get("status") == "available"]
    check("GET asientos", status == 200 and bool(free), f"{len(free)} libres · {elapsed * 1000:.0f} ms")
    seat = free[0]

    email = f"publico-{int(time.time())}-{secrets.token_hex(3)}@tiquart.com"
    status, body, elapsed = call(
        "POST",
        "/api/auth/register",
        {"name": "Comprador Público", "email": email, "password": "demo1234"},
    )
    check("POST /api/auth/register", status == 200 and body.get("token"), f"{status} · {elapsed * 1000:.0f} ms")
    token = body["token"]

    status, hold, elapsed = call(
        "POST",
        "/api/holds",
        {"event_id": event["id"], "seat_ids": [seat["id"]]},
        token,
    )
    check("POST /api/holds", status == 200 and hold.get("code"), f"{status} · asiento {seat['label']} · {elapsed * 1000:.0f} ms")

    status, result, elapsed = call(
        "POST",
        "/api/orders/checkout",
        {
            "hold_code": hold["code"],
            "buyer_name": "Comprador Público",
            "buyer_email": email,
        },
        token,
    )
    order = result.get("order", {}) if isinstance(result, dict) else {}
    tickets = result.get("tickets", []) if isinstance(result, dict) else []
    check(
        "POST /api/orders/checkout",
        status == 200 and bool(order.get("code")) and bool(tickets),
        f"{status} · {order.get('code', '')} · {len(tickets)} boleta(s) · {elapsed * 1000:.0f} ms",
    )

    status, tickets, elapsed = call("GET", "/api/tickets/mine", token=token)
    check("GET /api/tickets/mine", status == 200 and isinstance(tickets, list) and tickets, f"{len(tickets)} boleta(s) · {elapsed * 1000:.0f} ms")

    status, stats, elapsed = call("GET", "/api/stats/live")
    seats_stats = stats.get("seats", {}) if isinstance(stats, dict) else {}
    check("GET /api/stats/live", status == 200 and "sold" in seats_stats, f"{status} · {seats_stats} · {elapsed * 1000:.0f} ms")

    print("RESULTADO: compra pública completa OK")


if __name__ == "__main__":
    main()
