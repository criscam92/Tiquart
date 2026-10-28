from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Event, Seat

router = APIRouter(prefix="/events", tags=["events"])


async def event_stats(session: AsyncSession, event_id: int) -> dict:
    rows = (
        await session.execute(
            select(Seat.status, func.count()).where(Seat.event_id == event_id).group_by(Seat.status)
        )
    ).all()
    stats = {"available": 0, "held": 0, "sold": 0}
    for status, count in rows:
        stats[status] = count
    stats["total"] = stats["available"] + stats["held"] + stats["sold"]
    price = await session.scalar(
        select(func.min(Seat.price_cents)).where(Seat.event_id == event_id)
    )
    stats["min_price_cents"] = price or 0
    return stats


def event_public(event: Event, stats: dict) -> dict:
    return {
        "id": event.id,
        "slug": event.slug,
        "title": event.title,
        "category": event.category,
        "venue": event.venue,
        "city": event.city,
        "starts_at": event.starts_at,
        "description": event.description,
        "accent": event.accent,
        "status": event.status,
        "stats": stats,
    }


@router.get("")
async def list_events(session: AsyncSession = Depends(get_session)) -> list[dict]:
    events = (await session.execute(select(Event).order_by(Event.starts_at))).scalars().all()
    return [event_public(event, await event_stats(session, event.id)) for event in events]


@router.get("/{event_id}")
async def get_event(event_id: int, session: AsyncSession = Depends(get_session)) -> dict:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(404, "event_not_found")
    sections = (
        await session.execute(
            select(Seat.section, Seat.price_cents, func.count())
            .where(Seat.event_id == event_id)
            .group_by(Seat.section, Seat.price_cents)
            .order_by(Seat.price_cents.desc())
        )
    ).all()
    payload = event_public(event, await event_stats(session, event_id))
    payload["sections"] = [
        {"name": name, "price_cents": price, "seats": count}
        for name, price, count in sections
    ]
    return payload


@router.get("/{event_id}/seats")
async def list_seats(event_id: int, session: AsyncSession = Depends(get_session)) -> dict:
    seats = (
        await session.execute(
            select(Seat).where(Seat.event_id == event_id).order_by(Seat.id)
        )
    ).scalars().all()
    return {
        "event_id": event_id,
        "seats": [
            {
                "id": seat.id,
                "label": seat.label,
                "row": seat.row_name,
                "section": seat.section,
                "price_cents": seat.price_cents,
                "status": seat.status,
            }
            for seat in seats
        ],
    }
