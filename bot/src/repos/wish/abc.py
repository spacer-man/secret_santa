from datetime import datetime
from typing import Any
from typing import Protocol
from typing import Required
from typing import Sequence
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class WishDTO(BaseModel):
    id: UUID
    author_id: UUID
    message: str = Field(min_length=8, max_length=4096)
    timestamp: datetime


class NewWishArgs(TypedDict, total=False):
    message: Required[str]
    author_id: Required[UUID]


class WishRepository(Protocol):
    async def get_many(
            self,
            filter_by: dict[str, Any],
            ) -> Sequence[WishDTO]: ...
    async def create(self, **kwargs: Unpack[NewWishArgs]) -> UUID: ...
    async def delete(self, filter_by: dict[str, Any]) -> None: ...
