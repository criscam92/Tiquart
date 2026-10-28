import time

from prometheus_client import Gauge
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Hold, Seat

seats_sold = Gauge("tiquart_seats_sold", "Boletas vendidas")
seats_held = Gauge("tiquart_seats_held", "Asientos reservados")
seats_available = Gauge("tiquart_seats_available", "Asientos disponibles")
holds_active = Gauge("tiquart_holds_active", "Reservas activas")

_last_refresh = 0.0
_MIN_INTERVAL = 2.0


async def refresh_metrics(session: AsyncSession, force: bool = False) -> None:
    """Actualiza gauges como máximo cada 2 s para no castigar la base en ráfaga."""
    global _last_refresh
    now = time.monotonic()
    if not force and now - _last_refresh < _MIN_INTERVAL:
        return
    _last_refresh = now
    try:
        sold = await session.scalar(select(func.count()).select_from(Seat).where(Seat.status == "sold"))
        held = await session.scalar(select(func.count()).select_from(Seat).where(Seat.status == "held"))
        available = await session.scalar(
            select(func.count()).select_from(Seat).where(Seat.status == "available")
        )
        active = await session.scalar(
            select(func.count()).select_from(Hold).where(Hold.status == "active")
        )
        seats_sold.set(sold or 0)
        seats_held.set(held or 0)
        seats_available.set(available or 0)
        holds_active.set(active or 0)
    except Exception:  # noqa: BLE001
        pass
