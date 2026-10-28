from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..bus import bus
from ..db import get_session
from ..metrics import refresh_metrics
from ..models import Event, Hold, Order, Seat, Ticket, User
from ..seed import seed_all
from .tickets import admin_guard

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_guard)])


@router.post("/reset")
async def reset(session: AsyncSession = Depends(get_session)) -> dict:
    await seed_all(session, force=True)
    for event_id in (await session.execute(select(Event.id))).scalars().all():
        bus.publish(f"event/{event_id}", {"type": "reset", "event_id": event_id})
    await refresh_metrics(session, force=True)
    return {"ok": True, "reset": True}


@router.get("/stats")
async def stats(session: AsyncSession = Depends(get_session)) -> dict:
    revenue = await session.scalar(
        select(func.coalesce(func.sum(Order.total_cents), 0)).where(Order.status == "paid")
    )
    tickets = await session.scalar(select(func.count()).select_from(Ticket))
    used = await session.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.status == "used")
    )
    holds = await session.scalar(
        select(func.count()).select_from(Hold).where(Hold.status == "active")
    )
    orders = await session.scalar(select(func.count()).select_from(Order))
    users = await session.scalar(select(func.count()).select_from(User))
    seats = (
        await session.execute(
            select(Seat.status, func.count()).group_by(Seat.status)
        )
    ).all()
    by_status = {status: count for status, count in seats}
    recent = (
        await session.execute(select(Order).order_by(Order.created_at.desc()).limit(8))
    ).scalars().all()
    recent_rows = []
    for order in recent:
        event = await session.get(Event, order.event_id)
        recent_rows.append(
            {
                "code": order.code,
                "buyer": order.buyer_name,
                "email": order.buyer_email,
                "total_cents": order.total_cents,
                "created_at": order.created_at,
                "event": event.title if event else "-",
            }
        )
    return {
        "revenue_cents": revenue or 0,
        "orders": orders or 0,
        "users": users or 0,
        "tickets": tickets or 0,
        "tickets_used": used or 0,
        "holds_active": holds or 0,
        "seats": by_status,
        "recent_orders": recent_rows,
    }


@router.post("/events/{event_id}/sellout")
async def sellout(event_id: int, session: AsyncSession = Depends(get_session)) -> dict:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "event_not_found")
    result = await session.execute(
        update(Seat)
        .where(Seat.event_id == event_id, Seat.status == "available")
        .values(status="sold", version=Seat.version + 1)
    )
    await session.commit()
    bus.publish(f"event/{event_id}", {"type": "reset", "event_id": event_id})
    await refresh_metrics(session, force=True)
    return {"ok": True, "sold": result.rowcount, "at": datetime.now(timezone.utc)}
