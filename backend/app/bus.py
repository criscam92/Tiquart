import asyncio
import json
import logging
from collections import defaultdict

import aiomqtt

from .config import settings

log = logging.getLogger("tiquart.bus")


class EventBus:
    """Fan-out en memoria para SSE + puente MQTT best-effort."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._mqtt_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)

    def subscribe(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs[channel].add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        self._subs[channel].discard(queue)
        if not self._subs[channel]:
            self._subs.pop(channel, None)

    def publish(self, channel: str, payload: dict) -> None:
        for queue in list(self._subs.get(channel, ())):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass
        try:
            self._mqtt_queue.put_nowait((f"tiquart/{channel}", payload))
        except asyncio.QueueFull:
            pass

    async def mqtt_loop(self) -> None:
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=settings.mqtt_host, port=settings.mqtt_port
                ) as client:
                    log.info("MQTT conectado a %s:%s", settings.mqtt_host, settings.mqtt_port)
                    while True:
                        topic, payload = await self._mqtt_queue.get()
                        await client.publish(topic, json.dumps(payload), qos=1)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("MQTT no disponible (%s); reintento en 3s", exc)
                await asyncio.sleep(3)


bus = EventBus()
