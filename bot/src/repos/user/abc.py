from datetime import datetime
from typing import Any
from typing import Protocol
from typing import Required
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field


class UserDTO(BaseModel):
    id: UUID
    telegram_id: int
    timezone: str = Field(max_length=32)
    registered_at: datetime


class NewUserArgs(TypedDict, total=False):
    timezone: Required[str]
    telegram_id: Required[int]


class UserRepository(Protocol):
    async def get_one(self, filter_by: dict[str, Any]) -> UserDTO | None: ...
    async def create(self, **kwargs: Unpack[NewUserArgs]) -> UUID: ...
