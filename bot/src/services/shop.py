"""
Decoration shop: items are bought for mandarins 🍊 and decorate the tree and the courtyard.

The catalog lives in the DB (``ShopItem``), ``DEFAULT_CATALOG`` only seeds missing rows.
Milestone gifts (``friends_required`` > 0) can't be bought: they are granted
automatically once the user has invited enough friends.
"""

import logging
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from db import new_db_session
from db.models import ShopItem, User, UserItem
from services import mandarins

log = logging.getLogger(__name__)

PADS = 15  # courtyard places, pad index 0..PADS-1

CATEGORIES = ("figure", "lights", "weather")
RARITIES = ("common", "rare", "epic", "legendary")

# One-time mandarin bonus for owning every item of a set
SET_BONUS = {"yard": 100, "lights": 150}

# Festive level points for an owned item (see services/tree.py)
RARITY_POINTS = {"common": 2, "rare": 4, "epic": 6, "legendary": 10}


class ShopError(Exception):
    """Base class of shop errors"""


class UnknownItem(ShopError):
    pass


class NotForSale(ShopError):
    """Milestone gift: can't be bought"""


class AlreadyOwned(ShopError):
    pass


class NotEnoughMandarins(ShopError):
    pass


class NotOwned(ShopError):
    pass


class InvalidPlacement(ShopError):
    pass


def _item(
    key: str,
    category: str,
    rarity: str,
    price: int,
    set_key: str | None = None,
    friends_required: int = 0,
) -> dict:
    return {
        "key": key,
        "category": category,
        "rarity": rarity,
        "price": price,
        "set_key": set_key,
        "friends_required": friends_required,
    }


DEFAULT_CATALOG: list[dict] = [
    _item("candy-cane", "figure", "common", 60, "yard"),
    _item("lantern", "figure", "common", 80),
    _item("snowman-classic", "figure", "common", 100, "yard"),
    _item("snowman", "figure", "rare", 150, "yard"),
    _item("sled", "figure", "rare", 180, "yard"),
    _item("reindeer", "figure", "epic", 300),
    # Milestone gifts for invited friends
    _item("candy-cane-green", "figure", "rare", 0, friends_required=1),
    _item("sled-long", "figure", "rare", 0, friends_required=3),
    _item("gingerbread", "figure", "epic", 0, friends_required=5),
    _item("nutcracker", "figure", "legendary", 0, friends_required=10),
    # Skins of the cabin fringe lights
    _item("lights-multi", "lights", "rare", 200, "lights"),
    _item("lights-warm", "lights", "common", 150, "lights"),
    _item("lights-gold", "lights", "common", 150, "lights"),
    _item("lights-icy", "lights", "common", 150, "lights"),
    _item("lights-candy", "lights", "common", 150, "lights"),
    # Heavy snowfall modes
    _item("snow-snowfall", "weather", "rare", 150),
    _item("snow-blizzard", "weather", "epic", 400),
]


async def seed_catalog() -> None:
    """Insert catalog items that are missing (existing rows are never overwritten)"""
    async with new_db_session() as session:
        existing = set((await session.scalars(select(ShopItem.key))).all())
        for sort, data in enumerate(DEFAULT_CATALOG):
            if data["key"] not in existing:
                session.add(ShopItem(**data, sort=sort))
        await session.commit()


async def friends_count(session: AsyncSession, user_id: UUID) -> int:
    """Number of users invited by the user"""
    return (
        await session.scalar(select(func.count(col(User.id))).where(User.referrer_id == user_id))
        or 0
    )


async def grant_milestones(session: AsyncSession, user_id: UUID) -> int:
    """Give milestone gifts earned by invited friends. Caller commits. Returns friends count."""
    friends = await friends_count(session, user_id)
    if friends:
        owned = set(
            await session.scalars(select(UserItem.item_key).where(UserItem.user_id == user_id))
        )
        gifts = await session.scalars(
            select(ShopItem)
            .where(col(ShopItem.active).is_(True))
            .where(ShopItem.friends_required > 0)
            .where(ShopItem.friends_required <= friends)
        )
        for gift in gifts:
            if gift.key not in owned:
                session.add(UserItem(user_id=user_id, item_key=gift.key))
    return friends


async def ensure_milestones(user_id: UUID) -> int:
    """``grant_milestones`` in its own transaction. Returns friends count."""
    async with new_db_session() as session:
        try:
            friends = await grant_milestones(session, user_id)
            await session.commit()
        except IntegrityError:
            # A concurrent request has granted the same gifts
            await session.rollback()
            friends = await friends_count(session, user_id)
        return friends


async def owned_items(session: AsyncSession, user_id: UUID) -> list[tuple[UserItem, ShopItem]]:
    rows = await session.execute(
        select(UserItem, ShopItem)
        .join(ShopItem, col(ShopItem.key) == col(UserItem.item_key))
        .where(UserItem.user_id == user_id)
        .order_by(col(ShopItem.sort))
    )
    return [(owned, item) for owned, item in rows.all()]


def decor_points(owned: list[tuple[UserItem, ShopItem]]) -> int:
    """Festive points: figures count when placed, other decorations when owned"""
    return sum(
        RARITY_POINTS.get(item.rarity, 0)
        for user_item, item in owned
        if item.category != "figure" or user_item.pad is not None
    )


async def buy(user_id: UUID, item_key: str) -> int:
    """
    Buy an item. Returns the set bonus awarded by this purchase (0 if none).
    Raises ``ShopError`` subclasses.
    """
    async with new_db_session() as session:
        # Serialize concurrent purchases of one user (a no-op on SQLite)
        await session.execute(select(User.id).where(User.id == user_id).with_for_update())

        item = await session.get(ShopItem, item_key)
        if not item or not item.active:
            raise UnknownItem(item_key)
        if item.friends_required > 0:
            raise NotForSale(item_key)
        if await _user_item_id(session, user_id, item_key):
            raise AlreadyOwned(item_key)
        if await mandarins.balance(session, user_id) < item.price:
            raise NotEnoughMandarins(item_key)

        try:
            await mandarins.award(
                session, user_id, mandarins.Reason.PURCHASE, item_key, amount=-item.price
            )
            session.add(UserItem(user_id=user_id, item_key=item_key))
            await session.flush()
            bonus = await _award_set_bonus(session, user_id, item.set_key)
            await session.commit()
        except IntegrityError as err:
            await session.rollback()
            raise AlreadyOwned(item_key) from err
        return bonus


async def _user_item_id(session: AsyncSession, user_id: UUID, item_key: str) -> UUID | None:
    return await session.scalar(
        select(UserItem.id).where(UserItem.user_id == user_id).where(UserItem.item_key == item_key)
    )


async def _award_set_bonus(session: AsyncSession, user_id: UUID, set_key: str | None) -> int:
    """Award the bonus if the set is complete (once). Returns the awarded amount."""
    if not set_key or set_key not in SET_BONUS:
        return 0
    members = set(
        await session.scalars(
            select(ShopItem.key)
            .where(ShopItem.set_key == set_key)
            .where(col(ShopItem.active).is_(True))
        )
    )
    owned = set(await session.scalars(select(UserItem.item_key).where(UserItem.user_id == user_id)))
    if not members <= owned:
        return 0
    return await mandarins.award(
        session, user_id, mandarins.Reason.SET_BONUS, set_key, amount=SET_BONUS[set_key]
    )


async def place(user_id: UUID, item_key: str, pad: int | None) -> None:
    """
    Put an owned figure on a courtyard place (or take it off with ``pad=None``).
    A figure that stood on the place is taken off.
    """
    if pad is not None and not 0 <= pad < PADS:
        raise InvalidPlacement(f"pad must be in 0..{PADS - 1}")

    async with new_db_session() as session:
        await session.execute(select(User.id).where(User.id == user_id).with_for_update())

        item = await session.get(ShopItem, item_key)
        user_item = await session.scalar(
            select(UserItem).where(UserItem.user_id == user_id).where(UserItem.item_key == item_key)
        )
        if not item or not user_item:
            raise NotOwned(item_key)
        if item.category != "figure":
            raise InvalidPlacement("Only figures can be placed")

        if pad is not None:
            others = await session.scalars(
                select(UserItem)
                .where(UserItem.user_id == user_id)
                .where(UserItem.pad == pad)
                .where(UserItem.item_key != item_key)
            )
            for other in others:
                other.pad = None
                session.add(other)
        user_item.pad = pad
        session.add(user_item)
        await session.commit()


class ShopItemOut(BaseModel):
    key: str
    category: str
    rarity: str
    price: int
    set: str | None
    friends: int
    owned: bool
    pad: int | None


class ShopSetOut(BaseModel):
    key: str
    bonus: int
    items: list[str]
    done: bool


class ShopOut(BaseModel):
    balance: int
    friends: int
    items: list[ShopItemOut]
    sets: list[ShopSetOut]


async def shop_payload(user_id: UUID) -> ShopOut:
    """Catalog with the user's ownership, balance and sets progress"""
    friends = await ensure_milestones(user_id)
    async with new_db_session() as session:
        balance = await mandarins.balance(session, user_id)
        items = (
            await session.scalars(
                select(ShopItem).where(col(ShopItem.active).is_(True)).order_by(col(ShopItem.sort))
            )
        ).all()
        pads = {u.item_key: u.pad for u, _ in await owned_items(session, user_id)}

    sets: dict[str, list[str]] = {}
    for item in items:
        if item.set_key:
            sets.setdefault(item.set_key, []).append(item.key)

    return ShopOut(
        balance=balance,
        friends=friends,
        items=[
            ShopItemOut(
                key=item.key,
                category=item.category,
                rarity=item.rarity,
                price=item.price,
                set=item.set_key,
                friends=item.friends_required,
                owned=item.key in pads,
                pad=pads.get(item.key),
            )
            for item in items
        ],
        sets=[
            ShopSetOut(
                key=key,
                bonus=SET_BONUS.get(key, 0),
                items=keys,
                done=all(k in pads for k in keys),
            )
            for key, keys in sets.items()
        ],
    )
