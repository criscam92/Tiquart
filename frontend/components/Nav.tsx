"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { clearSession, getUser } from "@/lib/api";

export function Nav() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    window.addEventListener("tiquart:session", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("tiquart:session", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const isAdmin = user?.role === "admin";

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 text-sm font-black text-slate-950">
            T
          </span>
          <span className="text-lg font-bold tracking-tight">Tiquart</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link className="rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-slate-800/70" href="/">
            Eventos
          </Link>
          <Link
            className="rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-slate-800/70"
            href="/boletas"
          >
            Mis boletas
          </Link>
          {isAdmin && (
            <Link className="rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-slate-800/70" href="/live">
              En vivo
            </Link>
          )}
          {isAdmin && (
            <Link className="rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-slate-800/70" href="/admin">
              Admin
            </Link>
          )}
          {user ? (
            <div className="ml-2 flex items-center gap-2">
              <span className="hidden text-slate-400 sm:inline">{user.name}</span>
              <button
                className="btn btn-ghost px-2.5 py-1.5"
                onClick={() => {
                  clearSession();
                  window.location.href = "/";
                }}
              >
                Salir
              </button>
            </div>
          ) : (
            <Link className="btn btn-primary ml-2 px-3 py-1.5" href="/login">
              Ingresar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
