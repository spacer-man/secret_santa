from datetime import datetime
from datetime import timezone
from uuid import UUID
from uuid_extensions.uuid7 import uuid7

from sqlmodel import BigInteger
from sqlmodel import Column
from sqlmodel import Field
from sqlmodel import SQLModel
from sqlmodel import TIMESTAMP
from sqlmodel import Uuid


utc_now = lambda: datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    telegram_id: int = Field(unique=True, sa_type=BigInteger)
    timezone: str = Field(max_length=32)
    registered_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TIMESTAMP(timezone=True)))


class Wish(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    author_id: UUID = Field(foreign_key="user.id")
    message: str = Field(min_length=8, max_length=4096)
    timestamp: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TIMESTAMP(timezone=True)))
