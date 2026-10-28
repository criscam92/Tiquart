"use client";

import { useRouter } from 'next/navigation';
import { useEffect, useState } from "react";

import { api, API, getUser } from "@/lib/api";

type LiveStats = {
  type: string;
  seats: Record<string, number>;
  holds: number;
  events: number;
};

export default function LivePage() {
  const router = useRouter();
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [connected, setConnected] = useState(false);
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

  const [stats, setStats] = useState<LiveStats | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    const apply = (data: LiveStats) => {
      if (active && data.type === "stats") setStats(data);
    };

    // Polling como respaldo: proxies como Cloudflare pueden retener SSE.
    const poll = async () => {
      try {
        apply(await api<LiveStats>("/stats/live"));
        if (active) setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    };
    poll();
    const timer = setInterval(poll, 2000);

    const source = new EventSource(`${API}/sse/live`);
    source.onmessage = (message) => {
      try {
        apply(JSON.parse(message.data) as LiveStats);
      } catch {
        /* ping */
      }
    };

    return () => {
      active = false;
      clearInterval(timer);
      source.close();
    };
  }, []);

  const available = stats?.seats.available ?? 0;
  const held = stats?.seats.held ?? 0;
  const sold = stats?.seats.sold ?? 0;
  const total = available + held + sold;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Sala de monitoreo</h1>
          <p className="mt-1 text-sm text-slate-400">
            Datos en vivo vÃ­a SSE desde la API. ProyÃ©ctala durante la compra masiva.
          </p>
        </div>
        <span
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
            connected
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-rose-400"}`}
          />
          {connected ? "Conectado" : "Reconectandoâ€¦"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Vendidas", sold, "text-emerald-300", "from-emerald-500/20"],
          ["Reservadas", held, "text-amber-300", "from-amber-500/20"],
          ["Disponibles", available, "text-sky-300", "from-sky-500/20"],
          ["Reservas activas", stats?.holds ?? 0, "text-orange-300", "from-orange-500/20"],
        ].map(([label, value, color, gradient]) => (
          <div
            key={String(label)}
            className={`card rounded-2xl bg-gradient-to-br ${gradient} to-transparent p-6`}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
            <p className={`mt-2 text-5xl font-black tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="card rounded-2xl p-6">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>OcupaciÃ³n total del inventario</span>
          <span>{total} asientos</span>
        </div>
        <div className="mt-3 flex h-8 overflow-hidden rounded-full bg-slate-900">
          <div
            className="bg-emerald-500/80 transition-all duration-500"
            style={{ width: `${(sold / Math.max(total, 1)) * 100}%` }}
          />
          <div
            className="bg-amber-400/80 transition-all duration-500"
            style={{ width: `${(held / Math.max(total, 1)) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> vendidas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> reservadas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-700" /> libres
          </span>
        </div>
      </div>

      {/* Secciones informativas ocultadas para presentaciÃ³n */}
    </div>
  );
}
