import logging
import time

import redis.asyncio as redis
from fastapi import Depends, HTTPException, Request

from .config import settings
from .models import User
from .security import current_user

log = logging.getLogger("tiquart.limits")

_client: redis.Redis | None = None

# 60 peticiones cada 10 s por usuario; suficiente para la demo y frena scripts.
LIMIT = 60
WINDOW_SECONDS = 10


def client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


async def rate_limit(request: Request, user: User = Depends(current_user)) -> None:
    bucket = int(time.time() // WINDOW_SECONDS)
    key = f"rl:{user.id}:{bucket}"
    try:
        pipe = client().pipeline()
        pipe.incr(key)
        pipe.expire(key, WINDOW_SECONDS * 2)
        count, _ = await pipe.execute()
        if int(count) > LIMIT:
            raise HTTPException(429, "rate_limited")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.debug("rate limit sin redis: %s", exc)
