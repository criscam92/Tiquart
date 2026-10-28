from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..schemas import LoginIn, RegisterIn
from ..security import create_access_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _public(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@router.post("/register")
async def register(body: RegisterIn, session: AsyncSession = Depends(get_session)) -> dict:
    email = body.email.lower()
    exists = await session.scalar(select(User).where(User.email == email))
    if exists:
        raise HTTPException(409, "email_already_registered")
    user = User(
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role="buyer",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return {"token": create_access_token(user.id), "user": _public(user)}


@router.post("/login")
async def login(body: LoginIn, session: AsyncSession = Depends(get_session)) -> dict:
    user = await session.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "invalid_credentials")
    return {"token": create_access_token(user.id), "user": _public(user)}


@router.get("/me")
async def me(user: User = Depends(current_user)) -> dict:
    return _public(user)
