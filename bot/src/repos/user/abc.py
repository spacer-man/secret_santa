from datetime import datetime
from typing import (
    Any,
    Optional,
    Protocol,
    Required,
    TypedDict,
    Unpack,
)
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession


class UserDTO(BaseModel):
    id: UUID
    telegram_id: int
    timezone: str = Field(max_length=32)
    registered_at: datetime


class NewUserArgs(TypedDict, total=False):
    timezone: Required[str]
    telegram_id: Required[int]


class EditUserArgs(TypedDict, total=False):
    id: Required[UUID]
    timezone: Required[str]


class UserRepository(Protocol):
    def __init__(self, session: AsyncSession) -> None: ...
    async def get_one(
            self,
            filter_by: Optional[dict[str, Any]] = None,
            ) -> UserDTO | None: ...
    async def create(self, **kwargs: Unpack[NewUserArgs]) -> UUID: ...
    async def edit(self, **kwargs: Unpack[EditUserArgs]) -> None: ...
