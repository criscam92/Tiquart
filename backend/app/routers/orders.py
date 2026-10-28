import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..bus import bus
from ..db import get_session
from ..limits import rate_limit
from ..metrics import refresh_metrics
from ..models import Event, Hold, Order, OrderItem, Seat, Ticket, User
from ..qr import qr_data_uri, ticket_token
from ..schemas import CheckoutIn
from ..security import current_user

router = APIRouter(prefix="/orders", tags=["orders"])

MAX_TICKETS_PER_USER = 4


def ticket_public(ticket: Ticket) -> dict:
    token = ticket_token(ticket.code)
    return {
        "code": ticket.code,
        "label": ticket.label,
        "section": ticket.section,
        "status": ticket.status,
        "token": token,
        "qr": qr_data_uri(token),
    }


def event_public(event: Event) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "venue": event.venue,
        "city": event.city,
        "starts_at": event.starts_at,
        "accent": event.accent,
    }


@router.post("/checkout", dependencies=[Depends(rate_limit)])
async def checkout(
    body: CheckoutIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    now = datetime.now(timezone.utc)
    sold_seats: list[int] = []

    hold = (
        await session.execute(
            select(Hold)
            .where(Hold.code == body.hold_code, Hold.user_id == user.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if hold is None:
        raise HTTPException(404, "hold_not_found")
    if hold.status != "active":
        raise HTTPException(409, "hold_not_active")
    if hold.expires_at <= now:
        await session.execute(
            update(Seat)
            .where(Seat.hold_id == hold.id, Seat.status == "held")
            .values(status="available", hold_id=None, expires_at=None, version=Seat.version + 1)
        )
        hold.status = "expired"
        await session.commit()
        raise HTTPException(409, "hold_expired")

    if body.simulate_failure:
        raise HTTPException(402, "payment_declined")

    seats = (
        await session.execute(
            select(Seat).where(Seat.hold_id == hold.id, Seat.status == "held").with_for_update()
        )
    ).scalars().all()
    if not seats:
        raise HTTPException(409, "hold_empty")

    bought = await session.scalar(
        select(func.count())
        .select_from(Ticket)
        .join(Order, Ticket.order_id == Order.id)
        .where(Order.user_id == user.id, Order.event_id == hold.event_id)
    )
    if (bought or 0) + len(seats) > MAX_TICKETS_PER_USER:
        raise HTTPException(
            409,
            detail={"code": "purchase_limit", "max": MAX_TICKETS_PER_USER, "already": bought or 0},
        )

    order = Order(
        code=f"ORD-{secrets.token_hex(5).upper()}",
        user_id=user.id,
        event_id=hold.event_id,
        hold_id=hold.id,
        status="paid",
        total_cents=hold.total_cents,
        buyer_name=body.buyer_name.strip(),
        buyer_email=body.buyer_email.lower(),
        paid_at=now,
    )
    session.add(order)
    await session.flush()

    tickets: list[Ticket] = []
    for seat in seats:
        seat.status = "sold"
        seat.hold_id = None
        seat.expires_at = None
        seat.version += 1
        sold_seats.append(seat.id)
        session.add(
            OrderItem(
                order_id=order.id,
                seat_id=seat.id,
                label=seat.label,
                price_cents=seat.price_cents,
            )
        )
        ticket = Ticket(
            code=secrets.token_hex(5).upper(),
            order_id=order.id,
            event_id=hold.event_id,
            seat_id=seat.id,
            label=seat.label,
            section=seat.section,
        )
        session.add(ticket)
        tickets.append(ticket)

    hold.status = "paid"
    await session.commit()

    event = await session.get(Event, order.event_id)
    bus.publish(
        f"event/{order.event_id}",
        {
            "type": "seats",
            "event_id": order.event_id,
            "seats": [{"id": seat_id, "status": "sold"} for seat_id in sold_seats],
        },
    )
    await refresh_metrics(session)

    return {
        "order": {
            "code": order.code,
            "status": order.status,
            "total_cents": order.total_cents,
            "created_at": order.created_at or now,
            "buyer_name": order.buyer_name,
            "buyer_email": order.buyer_email,
        },
        "event": event_public(event) if event else None,
        "tickets": [ticket_public(ticket) for ticket in tickets],
    }


@router.get("/mine")
async def my_orders(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    orders = (
        await session.execute(
            select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
        )
    ).scalars().all()
    result = []
    for order in orders:
        event = await session.get(Event, order.event_id)
        tickets = (
            await session.execute(select(Ticket).where(Ticket.order_id == order.id))
        ).scalars().all()
        result.append(
            {
                "code": order.code,
                "status": order.status,
                "total_cents": order.total_cents,
                "created_at": order.created_at,
                "event": event_public(event) if event else None,
                "tickets": [ticket_public(ticket) for ticket in tickets],
            }
        )
    return result
