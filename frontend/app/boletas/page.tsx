"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, formatDate, getToken, money, Ticket } from "@/lib/api";

type OrderRow = {
  code: string;
  status: string;
  total_cents: number;
  created_at: string;
  event:
    | {
        id: number;
        title: string;
        venue: string;
        city: string;
        starts_at: string;
        accent: string;
      }
    | null;
  tickets: Ticket[];
};

export default function TicketsPage() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    if (!getToken()) {
      setOrders([]);
      return;
    }
    api<OrderRow[]>("/orders/mine")
      .then(setOrders)
      .catch(() => setError("No se pudieron cargar tus boletas."));
  }, []);

  if (!ready) {
    return <p className="text-sm text-slate-500">Cargando boletas…</p>;
  }

  if (!getToken()) {
    return (
      <div className="card mx-auto max-w-md rounded-2xl p-8 text-center">
        <h1 className="text-xl font-bold">Necesitas ingresar</h1>
        <p className="mt-2 text-sm text-slate-400">
          Inicia sesión para ver las boletas que compraste.
        </p>
        <Link className="btn btn-primary mt-5" href="/login?next=/boletas">
          Ingresar
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Mis boletas</h1>
        <p className="mt-1 text-sm text-slate-400">
          Cada QR está firmado. Al validarlo se marca como usado y no puede reutilizarse.
        </p>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {orders?.length === 0 && (
        <div className="card rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-400">Todavía no tienes boletas.</p>
          <Link className="btn btn-primary mt-4" href="/">
            Ver eventos
          </Link>
        </div>
      )}

      <div className="space-y-5">
        {orders?.map((order) => (
          <div key={order.code} className="card rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  Orden {order.code}
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  {order.event?.title ?? "Evento"}
                </h2>
                <p className="text-xs text-slate-400">
                  {order.event?.venue} · {order.event?.city}
                  {order.event ? ` · ${formatDate(order.event.starts_at)}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-emerald-400">
                  {order.status === "paid" ? "Pagada" : order.status}
                </p>
                <p className="text-xs text-slate-500">{money(order.total_cents)}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {order.tickets.map((ticket) => (
                <div
                  key={ticket.code}
                  className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-3 text-center"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ticket.qr}
                    alt={`QR ${ticket.code}`}
                    className="mx-auto h-32 w-32 rounded"
                  />
                  <p className="mt-2 text-xs font-semibold">
                    {ticket.section} · {ticket.label}
                  </p>
                  <p className="font-mono text-[9px] text-slate-500">{ticket.code}</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      ticket.status === "used"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {ticket.status === "used" ? "Usada" : "Válida"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
