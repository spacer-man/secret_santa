from collections.abc import Generator
from datetime import datetime
from typing import (
    Any,
    NotRequired,
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
    valid_status: ValidStatus = ValidStatus.ON_VALIDATION
    recipients_count: int = 0


class NewWishArgs(TypedDict, total=False):
    text: Required[str]
    text_entities: NotRequired[str | None]
    effect_id: NotRequired[str | None]
    author_id: Required[UUID]
    ball_color: NotRequired[str | None]
    ball_pattern: NotRequired[str | None]


class EditWishArgs(TypedDict):
    id: Required[UUID]
    text: NotRequired[str]
    text_entities: NotRequired[str]
    effect_id: NotRequired[str]
    valid_status: NotRequired[ValidStatus]


class WishRepository(Protocol):
    def __init__(self, session: AsyncSession) -> None: ...

    async def get_with_min_recipients(
        self,
        recipient: UUID | None,
        since: datetime | None = None,
    ) -> Generator[WishDTO]:
        """
        Get approved wishes with minimal recipients count.
        Wishes written by the recipient are excluded.

        :args:
            :param recipient: User recipient ID in DB.
            :type recipient: `Optional[UUID]`
            :param since: Take only wishes written after this moment.
            :type since: `Optional[datetime]`
        :returns: :class:`Generator[WishDTO]`
        """
        ...

    async def increment_recipients(self, wish_id: UUID) -> None: ...
    async def get_one(self, wish_id: UUID) -> WishDTO | None: ...
    async def get_many(
        self,
        filter_by: dict[str, Any] | None = None,
    ) -> Generator[WishDTO]: ...
    async def create(self, **kwargs: Unpack[NewWishArgs]) -> UUID: ...
    async def edit(self, **kwargs: Unpack[EditWishArgs]) -> None: ...
    async def delete(self, filter_by: dict[str, Any]) -> None: ...
