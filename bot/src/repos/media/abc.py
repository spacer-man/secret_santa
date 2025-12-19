from typing import Any
from typing import Protocol
from typing import Required
from typing import Sequence
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from pydantic import BaseModel

from db.models import MediaType


class MediaDTO(BaseModel):
    id: UUID
    wish_id: UUID
    data: bytes
    type: MediaType


class NewMediaArgs(TypedDict, total=False):
    wish_id: Required[UUID]
    data: Required[bytes]
    type: Required[MediaType]


class MediaRepository(Protocol):
    async def get_many(
            self,
            filter_by: dict[str, Any],
            ) -> Sequence[MediaDTO]: ...
    async def create(self, **kwargs: Unpack[NewMediaArgs]) -> UUID: ...
    async def delete(self, filter_by: dict[str, Any]) -> None: ...
