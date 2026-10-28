"use client";

import { useCallback, useEffect, useState } from "react";

import { useRouter } from 'next/navigation';
import { api, errorMessage, EventItem, formatDate, getUser, money } from "@/lib/api";

type Stats = {
  revenue_cents: number;
  orders: number;
  users: number;
  tickets: number;
  tickets_used: number;
  holds_active: number;
  seats: Record<string, number>;
  recent_orders: {
    code: string;
    buyer: string;
    email: string;
    total_cents: number;
    created_at: string;
    event: string;
  }[];
};

type Validation = {
  ok: boolean;
  ticket: { code: string; label: string; section: string; used_at: string };
  event: { title: string; venue: string; starts_at: string } | null;
};

export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== 'admin') {
      router.replace('/');
      return;
    }
    setAuthorized(true);
  }, [router]);

  if (!authorized) {
    return null;
  }

  const [adminToken, setAdminToken] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [code, setCode] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("tiquart.admin");
    if (stored) setAdminToken(stored);
  }, []);

  const loadStats = useCallback(async () => {
    if (!adminToken) return;
    try {
      setStats(await api<Stats>("/admin/stats", { adminToken }));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    loadStats();
    api<EventItem[]>("/events").then(setEvents).catch(() => undefined);
    const timer = setInterval(loadStats, 5000);
    return () => clearInterval(timer);
  }, [loadStats, adminToken]);

  async function resetDemo() {
    if (!window.confirm("Â¿Reiniciar la demo? Se borran Ã³rdenes y boletas.")) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/admin/reset", { method: "POST", adminToken });
      setMessage("Demo reiniciada con datos nuevos.");
      await loadStats();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sellout(eventId: number) {
    if (!window.confirm("Â¿Marcar todo el evento como agotado? Esta acciÃ³n no se puede deshacer.")) return;
    setBusy(true);
    try {
      const result = await api<{ sold: number }>(`/admin/events/${eventId}/sellout`, {
        method: "POST",
        adminToken,
      });
      setMessage(`Evento agotado: ${result.sold} asientos marcados como vendidos.`);
      await loadStats();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function validate(event: React.FormEvent) {
    event.preventDefault();
    setValidation(null);
    setError("");
    try {
      const result = await api<Validation>("/tickets/validate", {
        method: "POST",
        body: JSON.stringify({ code }),
        adminToken,
      });
      setValidation(result);
      setCode("");
      await loadStats();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Panel de control</h1>
          <p className="mt-1 text-sm text-slate-400">
            ValidaciÃ³n de QR, mÃ©tricas y botones de emergencia para la demo.
          </p>
        </div>
        <label className="text-[11px] uppercase tracking-wide text-slate-500">
          Token admin
          <input
            className="input mt-1 w-52"
            placeholder="Requerido para el panel"
            value={adminToken}
            onChange={(event) => {
              setAdminToken(event.target.value);
              window.localStorage.setItem("tiquart.admin", event.target.value);
            }}
          />
        </label>
      </div>

      {!adminToken && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Ingresa el token de administrador para cargar mÃ©tricas y validar boletas. EstÃ¡ en el
          README y en <code>.env</code>.
        </p>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Ingresos", stats ? money(stats.revenue_cents) : "â€”"],
          ["Ã“rdenes", stats?.orders ?? "â€”"],
          ["Boletas", stats?.tickets ?? "â€”"],
          ["Validadas", stats?.tickets_used ?? "â€”"],
        ].map(([label, value]) => (
          <div key={label} className="card rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-black text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card rounded-xl p-5">
          <h2 className="text-sm font-semibold">Validar boleta</h2>
          <p className="mt-1 text-xs text-slate-500">
            Pega el contenido del QR o el cÃ³digo de la boleta.
          </p>
          <form className="mt-3 flex gap-2" onSubmit={validate}>
            <input
              className="input"
              placeholder="TIQUART:... o A1B2C3D4E5"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <button className="btn btn-primary shrink-0" disabled={busy || !adminToken}>
              Validar
            </button>
          </form>

          {validation && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <p className="font-semibold text-emerald-300">Boleta vÃ¡lida</p>
              <p className="mt-1 text-slate-300">
                {validation.event?.title} Â· {validation.ticket.section} Â·{" "}
                {validation.ticket.label}
              </p>
              <p className="font-mono text-[10px] text-slate-500">
                {validation.ticket.code}
              </p>
            </div>
          )}
        </section>

        <section className="card rounded-xl p-5">
          <h2 className="text-sm font-semibold">Acciones de demo</h2>
          <p className="mt-1 text-xs text-slate-500">
            Ãšsalas antes de la presentaciÃ³n, no durante.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-ghost" onClick={resetDemo} disabled={busy || !adminToken}>
              Reiniciar demo
            </button>
            {events.map((event) => (
              <button
                key={event.id}
                className="btn btn-ghost"
                onClick={() => sellout(event.id)}
                disabled={busy || !adminToken}
              >
                Agotar Â«{event.title.split(":")[0]}Â»
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["Libres", stats?.seats.available ?? 0, "text-sky-300"],
              ["Reservados", stats?.seats.held ?? 0, "text-amber-300"],
              ["Vendidos", stats?.seats.sold ?? 0, "text-emerald-300"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-lg border border-slate-800 p-2">
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card overflow-hidden rounded-xl">
        <div className="border-b border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold">Ãšltimas Ã³rdenes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2">Orden</th>
                <th className="px-4 py-2">Comprador</th>
                <th className="px-4 py-2">Evento</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {stats?.recent_orders.map((order) => (
                <tr key={order.code} className="border-t border-slate-800/70">
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-400">{order.code}</td>
                  <td className="px-4 py-2">
                    {order.buyer}
                    <span className="block text-[10px] text-slate-500">{order.email}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-300">{order.event}</td>
                  <td className="px-4 py-2 font-semibold">{money(order.total_cents)}</td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
              {stats?.recent_orders.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={5}>
                    Sin Ã³rdenes todavÃ­a.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
