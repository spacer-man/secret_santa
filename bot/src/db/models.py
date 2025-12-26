import enum
from datetime import datetime
from datetime import timezone
from uuid import UUID

from uuid_extensions.uuid7 import uuid7

from sqlmodel import BigInteger
from sqlmodel import Column
from sqlmodel import Enum
from sqlmodel import Field
from sqlmodel import SQLModel
from sqlmodel import TIMESTAMP
from sqlmodel import Uuid


utc_now = lambda: datetime.now(timezone.utc)


class MediaType(enum.StrEnum):
    IMAGE = "image"
    AUDIO = "audio"
    VOICE = "voice"
    VIDEO = "video"
    VIDEO_NOTE = "video_note"


class ValidStatus(enum.StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    ON_VALIDATION = "on_validation"


class User(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    telegram_id: int = Field(unique=True, sa_type=BigInteger)
    timezone: str = Field(max_length=8)
    registered_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TIMESTAMP(timezone=True)))


class Wish(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    author_id: UUID = Field(foreign_key="user.id")
    text: str = Field(min_length=8, max_length=4096)
    text_entities: str | None = Field(default=None, max_length=4096 * 100)
    effect_id: str | None = Field(default=None)
    timestamp: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(TIMESTAMP(timezone=True)))
    valid_status: ValidStatus = Field(
        default=ValidStatus.ON_VALIDATION,
        sa_column=Column(Enum(ValidStatus)))


class Media(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    wish_id: UUID = Field(foreign_key="wish.id")
    type: MediaType = Field(sa_column=Column(Enum(MediaType)))
    data: bytes
