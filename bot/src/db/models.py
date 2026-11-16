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
    """
    A participant. Ways to sign in (at least one is set): Telegram, e-mail, Google.
    Any of them can be linked later; two accounts of one person can be merged
    (``services/accounts.py``).
    """

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    telegram_id: int | None = Field(default=None, unique=True, sa_type=BigInteger)
    email: str | None = Field(default=None, unique=True, index=True, max_length=254)
    google_id: str | None = Field(default=None, unique=True, index=True, max_length=64)
    # Name to greet a user who signed in without Telegram (Telegram gives it on every request)
    name: str | None = Field(default=None, max_length=64)
    # Channels of notifications, comma separated (telegram,push,email); None: all available
    notify: str | None = Field(default=None, max_length=32)
    # Session tokens made before this moment don't work ("sign out everywhere")
    sessions_after: datetime | None = Field(
        default=None, sa_column=Column(TIMESTAMP(timezone=True), nullable=True)
    )
    # Deleted by the owner: hidden from everything, can be restored for 30 days, then erased
    # (services/accounts.py: delete_account, restore_account, purge_deleted)
    deleted_at: datetime | None = Field(
        default=None, sa_column=Column(TIMESTAMP(timezone=True), nullable=True)
    )
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
    New Year gift box for a user: one per user per year.

    Created when the New Year comes in the user's timezone (``notified_at``),
    letters (:class:`Letter`) are put in when the user opens the box (``opened_at``).
    """

    __table_args__ = (UniqueConstraint("recipient_id", "year"),)

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    recipient_id: UUID = Field(foreign_key="user.id", index=True)
    year: int
    notified_at: datetime | None = Field(default=None, sa_column=Column(TIMESTAMP(timezone=True)))
    opened_at: datetime | None = Field(default=None, sa_column=Column(TIMESTAMP(timezone=True)))
    # Before letters a box held one wish: these columns are only read by the migration
    # to :class:`Letter` (``db/core.py``)
    wish_id: UUID | None = Field(default=None, foreign_key="wish.id", index=True)
    reaction: str | None = Field(default=None, max_length=16)
    reply: str | None = Field(default=None, max_length=1024)
    wish_erased: bool = Field(default=False)


class Letter(SQLModel, table=True):
    """
    One letter in a gift box: a wish of another participant or the letter from the creators
    (``creators``, no wish). Each letter has its own reaction and anonymous reply.
    """

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    delivery_id: UUID = Field(foreign_key="delivery.id", index=True)
    position: int = Field(default=0)
    wish_id: UUID | None = Field(default=None, foreign_key="wish.id", index=True)
    creators: bool = Field(default=False)
    reaction: str | None = Field(default=None, max_length=16)
    reply: str | None = Field(default=None, max_length=1024)
    # The wish was erased with its author's account (``wish_id`` is gone then)
    wish_erased: bool = Field(default=False)


class CreatorsLetter(SQLModel, table=True):
    """
    The New Year letter from the creators, one per season: on top of every gift box.
    Stored in the DB to be edited without a deploy (``services/creators.py`` seeds a draft).
    """

    year: int = Field(primary_key=True)
    text_ru: str = Field(max_length=4096)
    text_en: str = Field(max_length=4096)
    signature_ru: str = Field(max_length=128)
    signature_en: str = Field(max_length=128)


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
    """
    A decoration owned by a user: one row per copy. Figures can be bought several times
    (``services.shop.MAX_COPIES``), everything else is owned once: the shop checks it,
    not the DB.
    """

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    item_key: str = Field(foreign_key="shopitem.key", max_length=32)
    # Courtyard place of a figure (None: owned but not placed)
    pad: int | None = Field(default=None)
    acquired_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )


class EmailCode(SQLModel, table=True):
    """
    One-time code sent to an e-mail to sign in or to link it (``services/accounts.py``), and
    the day's counters of the address: letters sent and wrong codes (no guessing, no spamming)
    """

    email: str = Field(primary_key=True, max_length=254)
    code_hash: str = Field(max_length=64)
    attempts: int = Field(default=0)
    sent_at: datetime = Field(default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True)))
    day_start: datetime | None = Field(
        default=None, sa_column=Column(TIMESTAMP(timezone=True), nullable=True)
    )
    day_sends: int = Field(default=0)
    day_fails: int = Field(default=0)


class UsedProof(SQLModel, table=True):
    """
    A proof of identity already used (Telegram Login Widget data, a Google token): each works
    once, so one that leaked (a log, a shared screen) can't sign in or link again
    """

    digest: str = Field(primary_key=True, max_length=64)
    expires_at: datetime = Field(sa_column=Column(TIMESTAMP(timezone=True)))


class PushSubscription(SQLModel, table=True):
    """Web Push subscription of a browser (``services/push.py``)"""

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    user_id: UUID = Field(foreign_key="user.id", index=True)
    endpoint: str = Field(unique=True, max_length=1024)
    p256dh: str = Field(max_length=256)
    auth: str = Field(max_length=64)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )


class Session(SQLModel, table=True):
    """
    A sign-in on a device (website / PWA): the session token carries its id, ending it here
    ends the token. Tied to the way of signing in (kind + key), not the account: after a merge
    it follows the identity into the kept account. The Mini App signs in by Telegram itself
    and has none. (``services/sessions.py``)
    """

    id: UUID = Field(default_factory=uuid7, primary_key=True, sa_type=Uuid)
    kind: str = Field(max_length=16, index=True)
    key: str = Field(max_length=254, index=True)
    # What the person sees in the list: browser and system, a part of the IP address
    device: str = Field(default="", max_length=64)
    ip: str = Field(default="", max_length=64)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )
    last_seen_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(TIMESTAMP(timezone=True))
    )
