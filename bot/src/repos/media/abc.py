from typing import (
    Any,
    Generator,
    Optional,
    Protocol,
    Required,
    TypedDict,
    Unpack,
)
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import MediaType


class MediaDTO(BaseModel):
    id: UUID
    wish_id: UUID
    data: bytes = Field(max_length=10 * 2 ** 20)
    type: MediaType


class NewMediaArgs(TypedDict, total=False):
    wish_id: Required[UUID]
    data: Required[bytes]
    type: Required[MediaType]


class MediaRepository(Protocol):
    def __init__(self, session: AsyncSession) -> None: ...
    async def get_many(
            self,
            filter_by: Optional[dict[str, Any]] = None,
            ) -> Generator[MediaDTO]: ...
    async def create(self, **kwargs: Unpack[NewMediaArgs]) -> UUID: ...
    async def delete(self, filter_by: dict[str, Any]) -> None: ...
