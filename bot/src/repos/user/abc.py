from collections.abc import Generator
from datetime import datetime
from typing import (
    Any,
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
    language: str | None = None
    referrer_id: UUID | None = None
    registered_at: datetime


class NewUserArgs(TypedDict, total=False):
    timezone: Required[str]
    telegram_id: Required[int]
    language: str | None
    referrer_id: UUID | None


class EditUserArgs(TypedDict, total=False):
    id: Required[UUID]
    timezone: Required[str]


class UserRepository(Protocol):
    def __init__(self, session: AsyncSession) -> None: ...
    async def get_one(
        self,
        filter_by: dict[str, Any] | None = None,
    ) -> UserDTO | None: ...
    async def get_many(
        self,
        filter_by: dict[str, Any] | None = None,
    ) -> Generator[UserDTO]: ...
    async def create(self, **kwargs: Unpack[NewUserArgs]) -> UUID: ...
    async def edit(self, **kwargs: Unpack[EditUserArgs]) -> None: ...
