from datetime import datetime
from typing import (
    Any,
    Generator,
    NotRequired,
    Optional,
    Protocol,
    Required,
    TypedDict,
    Unpack,
)
from uuid import UUID

from aiogram.types import MessageEntity
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ValidStatus


class WishDTO(BaseModel):
    id: UUID
    author_id: UUID
    text: str = Field(min_length=8, max_length=4096)
    text_entities: list[MessageEntity] | None = Field(default=None)
    effect_id: str | None = Field(default=None)
    timestamp: datetime


class NewWishArgs(TypedDict, total=False):
    text: Required[str]
    text_entities: NotRequired[str | None]
    effect_id: NotRequired[str | None]
    author_id: Required[UUID]


class EditWishArgs(TypedDict):
    id: Required[UUID]
    text: NotRequired[str]
    text_entities: NotRequired[str]
    effect_id: NotRequired[str]
    valid_status: NotRequired[ValidStatus]


class WishRepository(Protocol):
    def __init__(self, session: AsyncSession) -> None: ...
    async def get_one(self, wish_id: UUID) -> WishDTO | None: ...
    async def get_many(
            self,
            filter_by: Optional[dict[str, Any]] = None,
            ) -> Generator[WishDTO]: ...
    async def create(self, **kwargs: Unpack[NewWishArgs]) -> UUID: ...
    async def edit(self, **kwargs: Unpack[EditWishArgs]) -> None: ...
    async def delete(self, filter_by: dict[str, Any]) -> None: ...
