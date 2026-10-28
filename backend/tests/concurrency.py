"""Prueba de no-sobreventa: N compradores pelean por el mismo asiento.

Uso dentro del contenedor:
    docker compose cp backend/tests/concurrency.py api:/tmp/concurrency.py
    docker compose exec -T api python /tmp/concurrency.py 40
"""

import json
import sys
import threading
import urllib.error
import urllib.request

BASE = "http://localhost:8000"


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw.decode(errors="replace")}


def login_or_register(index: int) -> str:
    email = f"bot{index}@tiquart.com"
    status, body = call(
        "POST",
        "/auth/register",
        {"name": f"Bot {index}", "email": email, "password": "demo1234"},
    )
    if status == 409:
        status, body = call(
            "POST", "/auth/login", {"email": email, "password": "demo1234"}
        )
    return body["token"]


def main() -> None:
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    _, events = call("GET", "/events")
    event_id = events[0]["id"]
    _, seats = call("GET", f"/events/{event_id}/seats")
    target = next(seat for seat in seats["seats"] if seat["status"] == "available")
    print(f"objetivo: {target['label']} (id={target['id']}) con {workers} compradores")

    tokens = [login_or_register(i) for i in range(workers)]
    results: list[tuple[int, dict, str]] = []
    lock = threading.Lock()

    def attempt(token: str) -> None:
        status, body = call(
            "POST", "/holds", {"event_id": event_id, "seat_ids": [target["id"]]}, token=token
        )
        with lock:
            results.append((status, body, token))

    threads = [threading.Thread(target=attempt, args=(token,)) for token in tokens]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    ok = [(body, token) for status, body, token in results if status == 200]
    conflict = [body for status, body, _ in results if status == 409]
    other = [status for status, _, _ in results if status not in (200, 409)]

    print(f"éxitos: {len(ok)} | conflictos: {len(conflict)} | otros: {other}")
    if ok:
        winner_hold, winner_token = ok[0]
        status, order = call(
            "POST",
            "/orders/checkout",
            {
                "hold_code": winner_hold["code"],
                "buyer_name": "Bot Winner",
                "buyer_email": "winner@tiquart.com",
            },
            token=winner_token,
        )
        print("checkout del ganador:", status)
        if status == 200:
            print("boletas emitidas:", len(order["tickets"]))

    print("VEREDICTO:", "OK sin sobreventa" if len(ok) <= 1 else "FALLO: sobreventa")


if __name__ == "__main__":
    main()
