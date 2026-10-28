import base64
from io import BytesIO

import jwt
import qrcode

from .config import settings


def ticket_token(code: str) -> str:
    token = jwt.encode({"t": code}, settings.ticket_secret, algorithm="HS256")
    return f"TIQUART:{token}"


def decode_ticket_token(raw: str) -> str:
    if raw.startswith("TIQUART:"):
        raw = raw.split(":", 1)[1]
        payload = jwt.decode(raw, settings.ticket_secret, algorithms=["HS256"])
        return str(payload["t"])
    return raw.strip().upper()


def qr_data_uri(payload: str) -> str:
    image = qrcode.make(payload)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{encoded}"
