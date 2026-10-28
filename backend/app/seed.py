import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models import Event, Hold, Order, OrderItem, Seat, Ticket, User
from .security import hash_password

PRE_SOLD_INDEXES = (3, 17, 29, 44, 58, 73, 88, 102)

SECTIONS = {
    "VIP": {"rows": ("A", "B", "C"), "price": 4500},
    "Preferencia": {"rows": ("D", "E", "F", "G"), "price": 3000},
    "General": {"rows": ("H", "I", "J"), "price": 1800},
}

EVENTS = [
    {
        "slug": "rock-sinfonico",
        "title": "Noche de Rock Sinfónico",
        "category": "Sinfónica",
        "venue": "Teatro Nacional",
        "city": "Quito",
        "offset_days": 12,
        "hour": 20,
        "accent": "#f97316",
        "description": "La Orquesta Sinfónica Nacional revisita los clásicos del rock con arreglos para 60 músicos.",
    },
    {
        "slug": "stand-up-risas",
        "title": "Stand-Up: Risas en Vivo",
        "category": "Stand-up",
        "venue": "Auditorio Central",
        "city": "Quito",
        "offset_days": 19,
        "hour": 21,
        "accent": "#a855f7",
        "description": "Cuatro comediantes, un micrófono y dos horas de material sin filtro.",
    },
    {
        "slug": "raices-folkloricas",
        "title": "Ballet Folklórico: Raíces",
        "category": "Danzas",
        "venue": "Teatro Mayor",
        "city": "Guayaquil",
        "offset_days": 26,
        "hour": 19,
        "accent": "#22d3ee",
        "description": "Un recorrido por la danza tradicional andina y costeña en tres actos.",
    },
]


def _event_start(offset_days: int, hour: int) -> datetime:
    base = datetime.now(timezone.utc) + timedelta(days=offset_days)
    return base.replace(hour=hour, minute=0, second=0, microsecond=0)


def _new_code(prefix: str = "") -> str:
    return f"{prefix}{secrets.token_hex(5).upper()}"


async def seed_all(session: AsyncSession, force: bool = False) -> bool:
    existing = await session.scalar(select(func.count()).select_from(Event))
    if existing and not force:
        return False

    if force:
        await session.execute(
            text(
                "TRUNCATE users, events, seats, holds, orders, order_items, tickets "
                "RESTART IDENTITY CASCADE"
            )
        )
        await session.commit()

    buyer = User(
        email="demo@tiquart.com",
        name="Demo Tiquart",
        password_hash=hash_password("demo1234"),
        role="buyer",
    )
    admin = User(
        email="admin@tiquart.com",
        name="Admin Tiquart",
        password_hash=hash_password("admin1234"),
        role="admin",
    )
    # Las boletas pre-vendidas no deben consumir el límite de 4 por evento de
    # la cuenta demo; las asignamos a un comprador histórico interno.
    preventa = User(
        email="preventa@tiquart.com",
        name="Preventa Tiquart",
        password_hash=hash_password(secrets.token_urlsafe(24)),
        role="buyer",
    )
    session.add_all([buyer, admin, preventa])
    await session.flush()

    for spec in EVENTS:
        event = Event(
            slug=spec["slug"],
            title=spec["title"],
            category=spec["category"],
            venue=spec["venue"],
            city=spec["city"],
            starts_at=_event_start(spec["offset_days"], spec["hour"]),
            description=spec["description"],
            accent=spec["accent"],
            status="onsale",
        )
        session.add(event)
        await session.flush()

        seats: list[Seat] = []
        for section, config in SECTIONS.items():
            for row in config["rows"]:
                for number in range(1, 13):
                    seat = Seat(
                        event_id=event.id,
                        label=f"{row}{number}",
                        row_name=row,
                        section=section,
                        price_cents=config["price"],
                        status="available",
                    )
                    seats.append(seat)
        session.add_all(seats)
        await session.flush()

        pre_sold = [seats[i] for i in PRE_SOLD_INDEXES if i < len(seats)]
        order = Order(
            code=_new_code("ORD-"),
            user_id=preventa.id,
            event_id=event.id,
            status="paid",
            buyer_name=preventa.name,
            buyer_email=preventa.email,
            paid_at=datetime.now(timezone.utc),
        )
        session.add(order)
        await session.flush()

        total = 0
        for seat in pre_sold:
            seat.status = "sold"
            total += seat.price_cents
            session.add(
                OrderItem(
                    order_id=order.id,
                    seat_id=seat.id,
                    label=seat.label,
                    price_cents=seat.price_cents,
                )
            )
            session.add(
                Ticket(
                    code=_new_code(),
                    order_id=order.id,
                    event_id=event.id,
                    seat_id=seat.id,
                    label=seat.label,
                    section=seat.section,
                )
            )
        order.total_cents = total

    await session.commit()
    return True


async def main() -> None:
    async with SessionLocal() as session:
        created = await seed_all(session, force=True)
    print("seed creado" if created else "seed omitido")


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
