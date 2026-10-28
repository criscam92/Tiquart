import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.API_BASE || "http://api:8000";
const USERS = Number(__ENV.K6_USERS || 80);

export const options = {
  scenarios: {
    estampida: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 30 },
        { duration: "20s", target: 60 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    // Habrá 409 a propósito cuando dos compradores pelean el mismo asiento.
    http_req_failed: ["rate<0.30"],
    http_req_duration: ["p(95)<1500"],
  },
};

function jsonHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// El registro (Argon2) se hace una sola vez por usuario, fuera de la ventana
// de carga. Así medimos el camino crítico: asientos + checkout.
export function setup() {
  const events = http.get(`${BASE}/events`).json();
  const event = events[0];
  const stamp = Date.now();
  const requests = [];
  for (let i = 1; i <= USERS; i += 1) {
    requests.push({
      method: "POST",
      url: `${BASE}/auth/register`,
      body: JSON.stringify({
        name: `K6 VU ${i}`,
        email: `k6-${stamp}-${i}@tiquart.com`,
        password: "demo1234",
      }),
      params: { headers: jsonHeaders() },
    });
  }
  const responses = http.batch(requests);
  const sessions = [];
  for (const response of responses) {
    if (response.status !== 200) continue;
    const body = response.json();
    sessions.push({ token: body.token, email: body.user.email });
  }
  console.log(`setup: ${sessions.length}/${USERS} usuarios listos`);
  return { eventId: event.id, sessions };
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  if (!session) {
    sleep(1);
    return;
  }

  const seats = http.get(`${BASE}/events/${data.eventId}/seats`).json("seats");
  const available = seats.filter((seat) => seat.status === "available");
  if (available.length === 0) {
    sleep(1);
    return;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seat = available[Math.floor(Math.random() * available.length)];
    const hold = http.post(
      `${BASE}/holds`,
      JSON.stringify({ event_id: data.eventId, seat_ids: [seat.id] }),
      { headers: jsonHeaders(session.token) },
    );
    check(hold, { "hold 200 o 409": (r) => r.status === 200 || r.status === 409 });
    if (hold.status !== 200) {
      sleep(0.3);
      continue;
    }

    const checkout = http.post(
      `${BASE}/orders/checkout`,
      JSON.stringify({
        hold_code: hold.json("code"),
        buyer_name: `K6 VU ${__VU}`,
        buyer_email: session.email,
      }),
      { headers: jsonHeaders(session.token) },
    );
    check(checkout, { "checkout 200 o 409": (r) => r.status === 200 || r.status === 409 });
    break;
  }

  sleep(Math.random() * 1.5 + 0.5);
}
