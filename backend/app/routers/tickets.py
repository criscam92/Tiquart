from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..models import Event, Order, Ticket, User
from ..qr import decode_ticket_token, qr_data_uri, ticket_token
from ..schemas import ValidateIn
from ..security import current_user

router = APIRouter(prefix="/tickets", tags=["tickets"])


async def admin_guard(x_admin_token: str = Header(default="")) -> None:
    if x_admin_token != settings.admin_token:
        raise HTTPException(401, "invalid_admin_token")


def event_public(event: Event) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "venue": event.venue,
        "city": event.city,
        "starts_at": event.starts_at,
        "accent": event.accent,
    }


@router.get("/mine")
async def my_tickets(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (
        await session.execute(
            select(Ticket, Event)
            .join(Order, Ticket.order_id == Order.id)
            .join(Event, Ticket.event_id == Event.id)
            .where(Order.user_id == user.id)
            .order_by(Ticket.created_at.desc())
        )
    ).all()
    return [
        {
            "code": ticket.code,
            "label": ticket.label,
            "section": ticket.section,
            "status": ticket.status,
            "used_at": ticket.used_at,
            "event": event_public(event),
            "qr": qr_data_uri(ticket_token(ticket.code)),
        }
        for ticket, event in rows
    ]


@router.post("/validate", dependencies=[Depends(admin_guard)])
async def validate_ticket(
    body: ValidateIn,
    session: AsyncSession = Depends(get_session),
) -> dict:
    try:
        code = decode_ticket_token(body.code)
    except Exception:
        raise HTTPException(400, "invalid_qr")

    ticket = await session.scalar(select(Ticket).where(Ticket.code == code).with_for_update())
    if ticket is None:
        raise HTTPException(404, "ticket_not_found")
    if ticket.status == "used":
        raise HTTPException(
            409,
            detail={
                "code": "already_used",
                "used_at": ticket.used_at.isoformat() if ticket.used_at else None,
            },
        )

    ticket.status = "used"
    ticket.used_at = datetime.now(timezone.utc)
    await session.commit()
    event = await session.get(Event, ticket.event_id)
    return {
        "ok": True,
        "ticket": {
            "code": ticket.code,
            "label": ticket.label,
            "section": ticket.section,
            "used_at": ticket.used_at,
        },
        "event": event_public(event) if event else None,
    }
