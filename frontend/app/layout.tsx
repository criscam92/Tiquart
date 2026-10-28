import type { Metadata } from "next";

import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiquart · Boletas para eventos",
  description: "Demo de venta de boletas con asientos en tiempo real y sin sobreventa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-slate-500">
          Tiquart · demo académica de sistemas distribuidos · pagos simulados
        </footer>
      </body>
    </html>
  );
}
