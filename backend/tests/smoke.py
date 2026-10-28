"""Smoke test end-to-end contra la API dentro del contenedor."""

import json
import urllib.error
import urllib.request

BASE = "http://localhost:8000"


def call(method, path, body=None, token=None, admin=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if admin:
        req.add_header("x-admin-token", admin)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def main() -> None:
    print("health:", call("GET", "/health"))
    status, events = call("GET", "/events")
    print("eventos:", status, [(e["id"], e["title"], e["stats"]) for e in events])
    event_id = events[0]["id"]

    _, seats = call("GET", f"/events/{event_id}/seats")
    free = [seat for seat in seats["seats"] if seat["status"] == "available"][:2]
    print("asientos libres:", [seat["label"] for seat in free])

    status, reg = call(
        "POST",
        "/auth/register",
        {"name": "Smoke Test", "email": "smoke1@tiquart.com", "password": "demo1234"},
    )
    print("registro:", status)
    if status == 409:
        status, reg = call(
            "POST",
            "/auth/login",
            {"email": "smoke1@tiquart.com", "password": "demo1234"},
        )
        print("login:", status)
    token = reg["token"]

    status, hold = call(
        "POST",
        "/holds",
        {"event_id": event_id, "seat_ids": [seat["id"] for seat in free]},
        token=token,
    )
    print("hold:", status, hold.get("code"), hold.get("total_cents"))

    status, order = call(
        "POST",
        "/orders/checkout",
        {
            "hold_code": hold["code"],
            "buyer_name": "Smoke Test",
            "buyer_email": "smoke1@tiquart.com",
        },
        token=token,
    )
    print("checkout:", status, order.get("order", {}).get("code"), len(order.get("tickets", [])))

    if order.get("tickets"):
        qr = order["tickets"][0]["token"]
        print("validar QR:", call("POST", "/tickets/validate", {"code": qr}, admin="tiquart-admin")[0])
        print(
            "validar QR otra vez (esperado 409):",
            call("POST", "/tickets/validate", {"code": qr}, admin="tiquart-admin")[0],
        )

    _, mine = call("GET", "/orders/mine", token=token)
    print("mis boletas:", [(t["label"], t["section"]) for t in mine[0]["tickets"]])


if __name__ == "__main__":
    main()
