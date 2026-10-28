export const API = process.env.NEXT_PUBLIC_API_BASE || "/api";

export type EventStats = {
  available: number;
  held: number;
  sold: number;
  total: number;
  min_price_cents: number;
};

export type EventItem = {
  id: number;
  slug: string;
  title: string;
  category: string;
  venue: string;
  city: string;
  starts_at: string;
  description: string;
  accent: string;
  status: string;
  stats: EventStats;
  sections?: { name: string; price_cents: number; seats: number }[];
};

export type Seat = {
  id: number;
  label: string;
  row: string;
  section: string;
  price_cents: number;
  status: "available" | "held" | "sold";
};

export type Hold = {
  code: string;
  event_id: number;
  status: string;
  total_cents: number;
  expires_at: string;
  seats: { id: number; label: string; row: string; section: string; price_cents: number }[];
};

export type Ticket = {
  code: string;
  label: string;
  section: string;
  status: string;
  token: string;
  qr: string;
};

export type CheckoutResult = {
  order: {
    code: string;
    status: string;
    total_cents: number;
    created_at: string;
    buyer_name: string;
    buyer_email: string;
  };
  event: EventItem | null;
  tickets: Ticket[];
};

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("tiquart.token");
}

export function getUser(): { id: number; name: string; email: string; role: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("tiquart.user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: { id: number; name: string; email: string; role: string }) {
  window.localStorage.setItem("tiquart.token", token);
  window.localStorage.setItem("tiquart.user", JSON.stringify(user));
  window.dispatchEvent(new Event("tiquart:session"));
}

export function clearSession() {
  window.localStorage.removeItem("tiquart.token");
  window.localStorage.removeItem("tiquart.user");
  window.dispatchEvent(new Event("tiquart:session"));
}

export async function api<T>(
  path: string,
  options: RequestInit & { adminToken?: string } = {},
): Promise<T> {
  const { adminToken, ...init } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (adminToken) headers["x-admin-token"] = adminToken;

  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = (data as { detail?: unknown })?.detail ?? data;
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail;
    if (typeof detail === "string") {
      const map: Record<string, string> = {
        seats_unavailable: "Alguien tomó esos asientos primero. Elige otros.",
        hold_expired: "La reserva expiró. Vuelve a seleccionar asientos.",
        hold_not_active: "La reserva ya no está activa.",
        purchase_limit: "Llegaste al máximo de 4 boletas por evento.",
        payment_declined: "Pago rechazado (simulación).",
        invalid_credentials: "Correo o contraseña incorrectos.",
        email_already_registered: "Ese correo ya está registrado.",
        rate_limited: "Demasiadas peticiones. Espera unos segundos.",
        already_used: "Esa boleta ya fue validada.",
        invalid_admin_token: "Token de administrador incorrecto.",
        ticket_not_found: "Boleta no encontrada.",
        invalid_qr: "QR inválido.",
      };
      return map[detail] || detail;
    }
    if (detail && typeof detail === "object" && "code" in detail) {
      const code = String((detail as { code: string }).code);
      if (code === "seats_unavailable") {
        const seats = (detail as { seats?: number[] }).seats?.join(", ") ?? "";
        return `Asientos ocupados: ${seats}. Elige otros.`;
      }
      if (code === "purchase_limit") {
        return "Llegaste al máximo de 4 boletas por evento.";
      }
      if (code === "already_used") return "Esa boleta ya fue validada.";
      return code;
    }
  }
  return "Algo salió mal. Intenta de nuevo.";
}
