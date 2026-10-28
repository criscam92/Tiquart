import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ..bus import bus
from ..db import SessionLocal
from ..models import Event, Hold, Seat

router = APIRouter(prefix="/sse", tags=["sse"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# Algunos proxies (Cloudflare quick tunnel) retienen el cuerpo hasta llenar su
# buffer. Un comentario inicial grande fuerza el primer flush sin afectar al navegador.
PADDING = ": " + (" " * 4096) + "\n\n"


@router.get("/events/{event_id}")
async def event_stream(event_id: int, request: Request) -> StreamingResponse:
    queue = bus.subscribe(f"event/{event_id}")

    async def generator():
        try:
            yield PADDING
            yield "event: ready\ndata: {}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            bus.unsubscribe(f"event/{event_id}", queue)

    return StreamingResponse(generator(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/live")
async def live_stream(request: Request) -> StreamingResponse:
    async def generator():
        yield PADDING
        yield "event: ready\ndata: {}\n\n"
        while True:
            if await request.is_disconnected():
                break
            async with SessionLocal() as session:
                statuses = (
                    await session.execute(
                        select(Seat.status, func.count()).group_by(Seat.status)
                    )
                ).all()
                holds = await session.scalar(
                    select(func.count()).select_from(Hold).where(Hold.status == "active")
                )
                events = await session.scalar(select(func.count()).select_from(Event))
            payload = {
                "type": "stats",
                "seats": {status: count for status, count in statuses},
                "holds": holds or 0,
                "events": events or 0,
            }
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(generator(), media_type="text/event-stream", headers=SSE_HEADERS)
