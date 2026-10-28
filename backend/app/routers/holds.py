import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..bus import bus
from ..config import settings
from ..db import get_session
from ..limits import rate_limit
from ..metrics import refresh_metrics
from ..models import Event, Hold, Seat, User
from ..schemas import HoldIn
from ..security import current_user

router = APIRouter(prefix="/holds", tags=["holds"])


def hold_public(hold: Hold, seats: list[Seat]) -> dict:
    return {
        "code": hold.code,
        "event_id": hold.event_id,
        "status": hold.status,
        "total_cents": hold.total_cents,
        "expires_at": hold.expires_at,
        "seats": [
            {
                "id": seat.id,
                "label": seat.label,
                "row": seat.row_name,
                "section": seat.section,
                "price_cents": seat.price_cents,
            }
            for seat in seats
        ],
    }


async def _seats_of_hold(session: AsyncSession, hold_id: int) -> list[Seat]:
    return (
        await session.execute(select(Seat).where(Seat.hold_id == hold_id).order_by(Seat.id))
    ).scalars().all()


@router.post("", dependencies=[Depends(rate_limit)])
async def create_hold(
    body: HoldIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    event = await session.get(Event, body.event_id)
    if event is None:
        raise HTTPException(404, "event_not_found")
    if event.status != "onsale":
        raise HTTPException(409, "event_not_on_sale")

    seat_ids = sorted(set(body.seat_ids))
    if not 1 <= len(seat_ids) <= 4:
        raise HTTPException(422, "between_1_and_4_seats")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.hold_ttl_seconds)
    released: list[int] = []

    # Una sola reserva activa por usuario y evento: la anterior se libera.
    previous = (
        await session.execute(
            select(Hold).where(
                Hold.user_id == user.id,
                Hold.event_id == body.event_id,
                Hold.status == "active",
            )
        )
    ).scalars().all()
    for old in previous:
        old_seats = await _seats_of_hold(session, old.id)
        released.extend(seat.id for seat in old_seats)
        await session.execute(
            update(Seat)
            .where(Seat.hold_id == old.id, Seat.status == "held")
            .values(status="available", hold_id=None, expires_at=None, version=Seat.version + 1)
        )
        old.status = "cancelled"

    hold = Hold(
        code=secrets.token_urlsafe(12),
        user_id=user.id,
        event_id=body.event_id,
        status="active",
        expires_at=expires_at,
    )
    session.add(hold)
    await session.flush()

    result = await session.execute(
        update(Seat)
        .where(
            Seat.id.in_(seat_ids),
            Seat.event_id == body.event_id,
            Seat.status == "available",
        )
        .values(
            status="held",
            hold_id=hold.id,
            expires_at=expires_at,
            version=Seat.version + 1,
        )
        .returning(Seat.id, Seat.label, Seat.price_cents)
    )
    rows = result.all()
    if len(rows) != len(seat_ids):
        taken = sorted(set(seat_ids) - {row.id for row in rows})
        await session.rollback()
        raise HTTPException(409, detail={"code": "seats_unavailable", "seats": taken})

    hold.total_cents = sum(row.price_cents for row in rows)
    await session.commit()

    seats = await _seats_of_hold(session, hold.id)

    changes = [{"id": row.id, "status": "held"} for row in rows]
    changes.extend({"id": seat_id, "status": "available"} for seat_id in released)
    if changes:
        bus.publish(
            f"event/{body.event_id}",
            {"type": "seats", "event_id": body.event_id, "seats": changes},
        )
    await refresh_metrics(session)
    return hold_public(hold, seats)


@router.get("/{code}")
async def get_hold(
    code: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    hold = await session.scalar(
        select(Hold).where(Hold.code == code, Hold.user_id == user.id)
    )
    if hold is None:
        raise HTTPException(404, "hold_not_found")
    return hold_public(hold, await _seats_of_hold(session, hold.id))


@router.delete("/{code}")
async def cancel_hold(
    code: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    hold = await session.scalar(
        select(Hold).where(Hold.code == code, Hold.user_id == user.id, Hold.status == "active")
    )
    if hold is None:
        raise HTTPException(404, "hold_not_found")
    seats = await _seats_of_hold(session, hold.id)
    await session.execute(
        update(Seat)
        .where(Seat.hold_id == hold.id, Seat.status == "held")
        .values(status="available", hold_id=None, expires_at=None, version=Seat.version + 1)
    )
    hold.status = "cancelled"
    await session.commit()
    bus.publish(
        f"event/{hold.event_id}",
        {
            "type": "seats",
            "event_id": hold.event_id,
            "seats": [{"id": seat.id, "status": "available"} for seat in seats],
        },
    )
    await refresh_metrics(session)
    return {"code": hold.code, "status": hold.status}
