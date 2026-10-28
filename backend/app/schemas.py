from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class HoldIn(BaseModel):
    event_id: int
    seat_ids: list[int] = Field(min_length=1, max_length=4)


class CheckoutIn(BaseModel):
    hold_code: str
    buyer_name: str = Field(min_length=2, max_length=120)
    buyer_email: EmailStr
    simulate_failure: bool = False


class ValidateIn(BaseModel):
    code: str
