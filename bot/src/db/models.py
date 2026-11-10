import enum
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import TIMESTAMP, BigInteger, Column, Enum, Field, SQLModel, UniqueConstraint, Uuid
from uuid_extensions.uuid7 import uuid7


def utc_now() -> datetime:
    return datetime.now(UTC)


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
    timezone: str = Field(max_length=16)
    language: str | None = Field(default=None, max_length=8)
    referrer_id: UUID | None = Field(default=None, foreign_key="user.id", sa_type=Uuid)
    registered_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )


class Wish(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    author_id: UUID = Field(foreign_key="user.id")
    text: str = Field(min_length=8, max_length=4096)
    text_entities: str | None = Field(default=None, max_length=4096 * 100)
    effect_id: str | None = Field(default=None)
    timestamp: datetime = Field(default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True)))
    valid_status: ValidStatus = Field(
        default=ValidStatus.ON_VALIDATION, sa_column=Column(Enum(ValidStatus))
    )
    recipients_count: int = Field(default=0)
    # Look of the wish's ball on the tree (see services/tree.py)
    ball_color: str | None = Field(default=None, max_length=16)
    ball_pattern: str | None = Field(default=None, max_length=16)


class Media(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    wish_id: UUID = Field(foreign_key="wish.id")
    type: MediaType = Field(sa_column=Column(Enum(MediaType)))
    data: bytes = Field(max_length=10 * 2**20)


class Delivery(SQLModel, table=True):
    """
    New Year gift for a user: one per user per year.

    Created when the New Year comes in the user's timezone (``notified_at``),
    a wish is assigned when the user opens the gift (``opened_at``).
    """

    __table_args__ = (UniqueConstraint("recipient_id", "year"),)

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    recipient_id: UUID = Field(foreign_key="user.id", index=True)
    year: int
    wish_id: UUID | None = Field(default=None, foreign_key="wish.id", index=True)
    notified_at: datetime | None = Field(default=None, sa_column=Column(TIMESTAMP(timezone=True)))
    opened_at: datetime | None = Field(default=None, sa_column=Column(TIMESTAMP(timezone=True)))
    reaction: str | None = Field(default=None, max_length=16)
    reply: str | None = Field(default=None, max_length=1024)


class MandarinTx(SQLModel, table=True):
    """
    Mandarins 🍊 (in-app currency) ledger.
    One reward per (user, reason, ref): repeated awards are ignored.
    """

    __table_args__ = (UniqueConstraint("user_id", "reason", "ref"),)

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    amount: int
    reason: str = Field(max_length=32)
    ref: str = Field(default="", max_length=64)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )


class ShopItem(SQLModel, table=True):
    """
    Decoration in the shop (catalog lives in the DB, seeded from services/shop.py).

    ``friends_required`` > 0 marks a milestone gift: it can't be bought and is
    granted automatically once the user has invited that many friends.
    """

    key: str = Field(primary_key=True, max_length=32)
    category: str = Field(max_length=16)  # figure | lights | weather
    rarity: str = Field(max_length=16)  # common | rare | epic | legendary
    price: int
    set_key: str | None = Field(default=None, max_length=32)
    friends_required: int = Field(default=0)
    sort: int = Field(default=0)
    active: bool = Field(default=True)


class UserItem(SQLModel, table=True):
    """A decoration owned by a user (one copy of each)"""

    __table_args__ = (UniqueConstraint("user_id", "item_key"),)

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    item_key: str = Field(foreign_key="shopitem.key", max_length=32)
    # Courtyard place of a figure (None: owned but not placed)
    pad: int | None = Field(default=None)
    acquired_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )
