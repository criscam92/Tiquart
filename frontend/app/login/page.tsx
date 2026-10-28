"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, errorMessage, saveSession } from "@/lib/api";

type AuthResponse = {
  token: string;
  user: { id: number; name: string; email: string; role: string };
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/");

  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("next");
    if (target) setNext(target);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password };
      const data = await api<AuthResponse>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      saveSession(data.token, data.user);
      router.push(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card rounded-2xl p-7">
        <h1 className="text-2xl font-bold">
          {mode === "login" ? "Ingresa a comprar" : "Crea tu cuenta"}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Tus boletas quedan asociadas a este correo.
        </p>

        <form className="mt-6 space-y-3" onSubmit={submit}>
          {mode === "register" && (
            <label className="block text-[11px] uppercase tracking-wide text-slate-500">
              Nombre
              <input
                className="input mt-1"
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
          )}
          <label className="block text-[11px] uppercase tracking-wide text-slate-500">
            Correo
            <input
              className="input mt-1"
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </label>
          <label className="block text-[11px] uppercase tracking-wide text-slate-500">
            Contraseña
            <input
              className="input mt-1"
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </label>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <button className="btn btn-primary w-full" disabled={busy}>
            {mode === "login" ? "Entrar" : "Registrarme"}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-xs text-slate-400 hover:text-slate-200"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "¿No tienes cuenta? Regístrate" : "Ya tengo cuenta"}
        </button>

        {/* Cuenta de demo ocultada para presentación */}
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        <Link href="/" className="hover:text-slate-300">
          Volver a la cartelera
        </Link>
      </p>
    </div>
  );
}
