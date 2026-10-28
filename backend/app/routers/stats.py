from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Event, Hold, Seat

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/live")
async def live_stats(session: AsyncSession = Depends(get_session)) -> dict:
    """Resumen público para el panel en vivo (respaldo de SSE)."""
    statuses = (
        await session.execute(select(Seat.status, func.count()).group_by(Seat.status))
    ).all()
    holds = await session.scalar(
        select(func.count()).select_from(Hold).where(Hold.status == "active")
    )
    events = await session.scalar(select(func.count()).select_from(Event))
    return {
        "type": "stats",
        "seats": {status: count for status, count in statuses},
        "holds": holds or 0,
        "events": events or 0,
    }
