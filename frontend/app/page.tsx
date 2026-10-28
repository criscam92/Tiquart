"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, EventItem, formatDate, money } from "@/lib/api";

export default function HomePage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<EventItem[]>("/events")
      .then(setEvents)
      .catch(() => setError("No se pudo cargar la cartelera. ¿La API está arriba?"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-10">
      <section className="card overflow-hidden rounded-2xl p-8">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Compra tus boletas
            <br />
            <span className="bg-gradient-to-r from-orange-400 to-amber-200 bg-clip-text text-transparent">
              rápido y seguro
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            Selecciona tu evento, elige tus asientos y recibe tu boleta con código QR al instante.
          </p>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-bold">Cartelera</h2>
          <span className="text-xs text-slate-500">{events.length} eventos en venta</span>
        </div>

        {loading && <p className="text-sm text-slate-500">Cargando eventos…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const pct = Math.round((event.stats.sold / Math.max(event.stats.total, 1)) * 100);
            return (
              <Link
                key={event.id}
                href={`/eventos/${event.id}`}
                className="card group flex flex-col overflow-hidden rounded-xl transition hover:-translate-y-0.5 hover:border-slate-600"
              >
                <div
                  className="h-24 w-full opacity-90"
                  style={{
                    background: `linear-gradient(135deg, ${event.accent}, rgba(2,6,23,0.2))`,
                  }}
                />
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <span className="w-fit rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {event.category}
                  </span>
                  <h3 className="text-lg font-bold leading-snug group-hover:text-orange-300">
                    {event.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {event.venue} · {event.city}
                    <br />
                    {formatDate(event.starts_at)}
                  </p>
                  <div className="mt-auto space-y-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">
                        {event.stats.available} de {event.stats.total} disponibles
                      </span>
                      <span className="font-semibold text-orange-300">
                        desde {money(event.stats.min_price_cents)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
