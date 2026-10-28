import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import select, update

from .bus import bus
from .db import Base, SessionLocal, engine
from .metrics import refresh_metrics
from .models import Hold, Seat
from .routers import admin, auth, events, holds, orders, sse, stats, tickets
from .seed import seed_all

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("tiquart")


async def expiry_loop() -> None:
    while True:
        await asyncio.sleep(5)
        try:
            async with SessionLocal() as session:
                now = datetime.now(timezone.utc)
                expired = (
                    await session.execute(
                        select(Hold).where(Hold.status == "active", Hold.expires_at < now)
                    )
                ).scalars().all()
                if expired:
                    ids = [hold.id for hold in expired]
                    await session.execute(
                        update(Seat)
                        .where(Seat.hold_id.in_(ids), Seat.status == "held")
                        .values(
                            status="available",
                            hold_id=None,
                            expires_at=None,
                            version=Seat.version + 1,
                        )
                    )
                    for hold in expired:
                        hold.status = "expired"
                    await session.commit()
                    for event_id in {hold.event_id for hold in expired}:
                        bus.publish(
                            f"event/{event_id}",
                            {"type": "expired", "event_id": event_id},
                        )
                    log.info("holds expirados: %s", len(ids))
                    await refresh_metrics(session)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("expiry_loop: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as session:
        created = await seed_all(session)
        if created:
            log.info("datos de demo sembrados")
        await refresh_metrics(session, force=True)

    tasks = [asyncio.create_task(bus.mqtt_loop()), asyncio.create_task(expiry_loop())]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await engine.dispose()


app = FastAPI(title="Tiquart API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

app.include_router(auth.router)
app.include_router(events.router)
app.include_router(holds.router)
app.include_router(orders.router)
app.include_router(tickets.router)
app.include_router(admin.router)
app.include_router(sse.router)
app.include_router(stats.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "tiquart-api"}
