"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  api,
  API,
  ApiError,
  CheckoutResult,
  errorMessage,
  EventItem,
  formatDate,
  getToken,
  getUser,
  Hold,
  money,
  Seat,
} from "@/lib/api";

type SeatChange = { id: number; status: Seat["status"] };

export default function EventPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const eventId = Number(params.id);

  const [event, setEvent] = useState<EventItem | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [mySeats, setMySeats] = useState<Set<number>>(new Set());
  const [hold, setHold] = useState<Hold | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [buyer, setBuyer] = useState({ name: "", email: "" });
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadEvent() {
    try {
      setEvent(await api<EventItem>(`/events/${eventId}`));
    } catch {
      setError("No se pudo cargar el evento.");
    }
  }

  async function loadSeats() {
    try {
      const data = await api<{ seats: Seat[] }>(`/events/${eventId}/seats`);
      setSeats(data.seats);
    } catch {
      setError("No se pudo cargar el mapa de asientos.");
    }
  }

  useEffect(() => {
    if (!Number.isFinite(eventId)) return;
    loadEvent();
    loadSeats();
    const source = new EventSource(`${API}/sse/events/${eventId}`);
    source.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as { type: string; seats?: SeatChange[] };
        if (data.type === "seats" && data.seats) {
          setSeats((prev) =>
            prev.map((seat) => {
              const change = data.seats?.find((item) => item.id === seat.id);
              return change ? { ...seat, status: change.status } : seat;
            }),
          );
        }
        if (data.type === "reset" || data.type === "expired") {
          loadSeats();
          loadEvent();
        }
      } catch {
        /* ignorar mensajes de ping */
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Respaldo de SSE: algunos proxies retienen text/event-stream. El polling
  // mantiene el mapa consistente aunque el stream no llegue.
  useEffect(() => {
    if (!Number.isFinite(eventId)) return;
    const timer = setInterval(() => {
      loadSeats();
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!hold) return;
    const tick = () => {
      const left = Math.max(
        0,
        Math.floor((new Date(hold.expires_at).getTime() - Date.now()) / 1000),
      );
      setRemaining(left);
      if (left === 0) {
        setHold(null);
        setMySeats(new Set());
        loadSeats();
        loadEvent();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  const sections = useMemo(() => {
    const map = new Map<string, { price: number; rows: Map<string, Seat[]> }>();
    for (const seat of seats) {
      if (!map.has(seat.section)) map.set(seat.section, { price: seat.price_cents, rows: new Map() });
      const section = map.get(seat.section)!;
      if (!section.rows.has(seat.row)) section.rows.set(seat.row, []);
      section.rows.get(seat.row)!.push(seat);
    }
    return [...map.entries()].map(([name, value]) => ({
      name,
      price: value.price,
      rows: [...value.rows.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
  }, [seats]);

  const selectedSeats = seats.filter((seat) => selected.includes(seat.id));
  const total = selectedSeats.reduce((sum, seat) => sum + seat.price_cents, 0);

  function toggleSeat(seat: Seat) {
    if (seat.status !== "available" || hold) return;
    setError("");
    setSelected((prev) => {
      if (prev.includes(seat.id)) return prev.filter((id) => id !== seat.id);
      if (prev.length >= 4) return prev;
      return [...prev, seat.id];
    });
  }

  async function reserve() {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api<Hold>("/holds", {
        method: "POST",
        body: JSON.stringify({ event_id: eventId, seat_ids: selected }),
      });
      setHold(created);
      setMySeats(new Set(created.seats.map((seat) => seat.id)));
      setSelected([]);
      const user = getUser();
      setBuyer((prev) => ({
        name: prev.name || user?.name || "",
        email: prev.email || user?.email || "",
      }));
      loadSeats();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) {
        loadSeats();
        loadEvent();
      }
    } finally {
      setBusy(false);
    }
  }

  async function pay(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (!hold) return;
    setBusy(true);
    setError("");
    try {
      const paid = await api<CheckoutResult>("/orders/checkout", {
        method: "POST",
        body: JSON.stringify({
          hold_code: hold.code,
          buyer_name: buyer.name,
          buyer_email: buyer.email,
        }),
      });
      setResult(paid);
      setHold(null);
      setMySeats(new Set());
      setSelected([]);
      loadSeats();
      loadEvent();
    } catch (err) {
      setError(errorMessage(err));
      loadSeats();
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    if (!hold) return;
    try {
      await api(`/holds/${hold.code}`, { method: "DELETE" });
    } catch {
      /* ignorar */
    }
    setHold(null);
    setMySeats(new Set());
    loadSeats();
    loadEvent();
  }

  if (!event) {
    return <p className="text-sm text-slate-500">Cargando evento…</p>;
  }

  const soldPct = Math.round((event.stats.sold / Math.max(event.stats.total, 1)) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-300">
            ← Volver a la cartelera
          </Link>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{event.title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {event.venue} · {event.city} · {formatDate(event.starts_at)}
          </p>
        </div>
        <div className="card min-w-44 rounded-xl px-4 py-3">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Vendidas</span>
            <span className="font-semibold text-slate-200">{soldPct}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300"
              style={{ width: `${soldPct}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {event.stats.available} libres · {event.stats.held} reservadas · {event.stats.sold} vendidas
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="card rounded-xl p-5">
          <div className="mb-8 text-center">
            <div className="mx-auto h-1.5 w-2/3 rounded-full bg-gradient-to-r from-transparent via-slate-500 to-transparent" />
            <p className="mt-2 text-[10px] uppercase tracking-[0.35em] text-slate-500">Escenario</p>
          </div>

          <div className="space-y-7">
            {sections.map((section) => (
              <div key={section.name}>
                <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    {section.name}
                  </span>
                  <span className="text-xs text-slate-500">{money(section.price)}</span>
                </div>
                <div className="space-y-1.5">
                  {section.rows.map(([row, rowSeats]) => (
                    <div key={row} className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-right text-[10px] text-slate-500">{row}</span>
                      <div className="flex flex-1 flex-wrap gap-1">
                        {rowSeats.map((seat) => {
                          const isMine = mySeats.has(seat.id);
                          const isSelected = selected.includes(seat.id);
                          const base =
                            "seat h-6 w-7 rounded text-[9px] font-semibold border border-slate-700";
                          let style = "bg-slate-800 text-slate-300 hover:border-orange-400";
                          if (isMine) style = "bg-orange-500 text-slate-950 border-orange-300";
                          else if (isSelected) style = "bg-amber-300 text-slate-950 border-amber-200";
                          else if (seat.status === "held") style = "bg-amber-950/60 text-amber-600 border-amber-900";
                          else if (seat.status === "sold") style = "bg-slate-900 text-slate-700 border-slate-900 line-through";
                          return (
                            <button
                              key={seat.id}
                              type="button"
                              disabled={seat.status !== "available" || Boolean(hold)}
                              onClick={() => toggleSeat(seat)}
                              className={`${base} ${style}`}
                              title={`${seat.label} · ${seat.section} · ${money(seat.price_cents)}`}
                            >
                              {seat.label.slice(seat.row.length)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-4 text-[11px] text-slate-400">
            {[
              ["bg-slate-800 border-slate-700", "Disponible"],
              ["bg-amber-300 border-amber-200", "Tu selección"],
              ["bg-orange-500 border-orange-300", "Tu reserva"],
              ["bg-amber-950/60 border-amber-900", "Reservado"],
              ["bg-slate-900 border-slate-900", "Vendido"],
            ].map(([classes, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded border ${classes}`} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card rounded-xl p-5">
            <h2 className="text-sm font-semibold">Tu compra</h2>
            {selectedSeats.length === 0 && !hold && (
              <p className="mt-2 text-xs text-slate-500">
                Haz clic en hasta 4 asientos disponibles del mapa.
              </p>
            )}

            {selectedSeats.length > 0 && !hold && (
              <div className="mt-3 space-y-2">
                {selectedSeats.map((seat) => (
                  <div key={seat.id} className="flex justify-between text-xs">
                    <span>
                      {seat.label} · {seat.section}
                    </span>
                    <span className="text-slate-400">{money(seat.price_cents)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-slate-800 pt-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>{money(total)}</span>
                </div>
                <button className="btn btn-primary mt-2 w-full" onClick={reserve} disabled={busy}>
                  Reservar {selectedSeats.length} asiento(s)
                </button>
              </div>
            )}

            {hold && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
                  <div className="flex items-center justify-between text-xs text-orange-200">
                    <span>Reserva activa</span>
                    <span className="font-mono font-bold">
                      {String(Math.floor(remaining / 60)).padStart(2, "0")}:
                      {String(remaining % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-orange-200/70">
                    {hold.seats.map((seat) => seat.label).join(", ")}
                  </p>
                </div>

                <form className="space-y-2" onSubmit={pay}>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                    Nombre
                    <input
                      className="input mt-1"
                      required
                      value={buyer.name}
                      onChange={(event) => setBuyer({ ...buyer, name: event.target.value })}
                    />
                  </label>
                  <label className="block text-[11px] uppercase tracking-wide text-slate-500">
                    Correo
                    <input
                      className="input mt-1"
                      type="email"
                      required
                      value={buyer.email}
                      onChange={(event) => setBuyer({ ...buyer, email: event.target.value })}
                    />
                  </label>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2 text-[10px] text-slate-500">
                    Pago simulado · no se cobra ninguna tarjeta
                  </div>
                  <button className="btn btn-primary w-full" disabled={busy}>
                    Pagar {money(hold.total_cents)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost w-full"
                    onClick={releaseHold}
                    disabled={busy}
                  >
                    Liberar asientos
                  </button>
                </form>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
          </div>

          {/* Sección "Cómo funciona" oculta para presentación */}
        </aside>
      </div>

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur">
          <div className="card max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-emerald-400">Pago aprobado</p>
                <h2 className="mt-1 text-2xl font-bold">Tus boletas están listas</h2>
                <p className="text-xs text-slate-500">Orden {result.order.code}</p>
              </div>
              <button
                className="text-slate-500 hover:text-slate-200"
                onClick={() => setResult(null)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {result.tickets.map((ticket) => (
                <div key={ticket.code} className="rounded-xl border border-slate-700 p-3 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ticket.qr} alt={`QR ${ticket.code}`} className="mx-auto h-40 w-40 rounded" />
                  <p className="mt-2 text-sm font-semibold">
                    {ticket.section} · {ticket.label}
                  </p>
                  <p className="font-mono text-[10px] text-slate-500">{ticket.code}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="btn btn-primary" href="/boletas">
                Ver mis boletas
              </Link>
              <button className="btn btn-ghost" onClick={() => setResult(null)}>
                Seguir comprando
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
