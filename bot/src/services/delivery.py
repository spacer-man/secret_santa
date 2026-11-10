"""
New Year gifts: who received which wish, reactions and anonymous replies.
"""

import random
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import col, select

import timezones
from db import new_db_session
from db.models import Delivery, User, ValidStatus, Wish
from repos.wish.abc import WishRepository
from services import mandarins
from services.wish import WishDTO, WishService

REACTIONS = ("❤️", "😂", "🥹", "🔥", "🎉", "👏")
MAX_REPLY_LENGTH = 1024


class DeliveryError(Exception):
    pass


class DeliveryDTO(BaseModel):
    id: UUID
    year: int
    opened_at: datetime | None
    reaction: str | None
    reply: str | None
    wish: WishDTO | None = None


class FeedbackDTO(BaseModel):
    """What recipients answered to a wish"""

    recipients: int = 0
    reactions: dict[str, int] = {}
    replies: list[str] = []


class Recipient(BaseModel):
    user_id: UUID
    telegram_id: int


class ReactionResult(BaseModel):
    author_telegram_id: int | None
    reaction: str | None
    reply: str | None
    is_new_reaction: bool
    is_new_reply: bool


def season_start(year: int) -> datetime:
    """Wishes written after this moment are sent at the New Year ``year``"""
    return datetime(year - 1, 2, 1, tzinfo=UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def current_season_year(now: datetime | None = None) -> int:
    """Year of the closest New Year (January belongs to the New Year that has just come)"""
    now = now or utc_now()
    return now.year + 1 if now.month > 1 else now.year


class DeliveryService:
    def __init__(
        self,
        wish_service: WishService,
        wish_repo_type: type[WishRepository],
    ) -> None:
        self.wish_service = wish_service
        self.wish_repo_type = wish_repo_type

    # ====== Mailing ====== #
    async def pending_recipients(self, tz: str, year: int) -> list[Recipient]:
        """Users from the timezone who haven't got a gift for the ``year`` yet"""
        async with new_db_session() as session:
            delivered = select(Delivery.recipient_id).where(Delivery.year == year)
            stmt = (
                select(User.id, User.telegram_id)
                .where(User.timezone == tz)
                .where(col(User.id).not_in(delivered))
            )
            rows = (await session.execute(stmt)).all()
        return [Recipient(user_id=r[0], telegram_id=r[1]) for r in rows]

    async def mark_notified(self, user_id: UUID, year: int) -> None:
        async with new_db_session() as session:
            exists = await session.scalar(
                select(Delivery.id)
                .where(Delivery.recipient_id == user_id)
                .where(Delivery.year == year)
            )
            if exists:
                return None
            session.add(Delivery(recipient_id=user_id, year=year, notified_at=utc_now()))
            await session.commit()

    # ====== Recipient side ====== #
    async def _user(self, session, telegram_id: int) -> User | None:
        return await session.scalar(select(User).where(User.telegram_id == telegram_id))

    async def current(self, telegram_id: int) -> DeliveryDTO | None:
        """
        The gift of the current New Year for the user.
        ``None`` if the New Year hasn't come for the user yet.
        """
        async with new_db_session() as session:
            user = await self._user(session, telegram_id)
            if not user:
                return None
            delivery = await self._current_delivery(session, user)
            if not delivery:
                return None
            await session.commit()
            return await self._to_dto(delivery)

    async def _current_delivery(self, session, user: User) -> Delivery | None:
        now = utc_now()
        local = (
            timezones.local_now(user.timezone, now) if timezones.is_valid(user.timezone) else now
        )
        # Gifts can be opened all January
        if local.month != 1:
            return None

        delivery = await session.scalar(
            select(Delivery)
            .where(Delivery.recipient_id == user.id)
            .where(Delivery.year == local.year)
        )
        if not delivery:
            # Registered after midnight: the gift is still here
            delivery = Delivery(recipient_id=user.id, year=local.year, notified_at=now)
            session.add(delivery)
            await session.flush()
        return delivery

    async def open(self, telegram_id: int) -> DeliveryDTO | None:
        """
        Open the gift: assign a wish to it (once).
        ``None`` if the New Year hasn't come for the user yet.
        """
        async with new_db_session() as session:
            user = await self._user(session, telegram_id)
            if not user:
                return None
            delivery = await self._current_delivery(session, user)
            if not delivery:
                return None

            if delivery.wish_id is None:
                wish_repo = self.wish_repo_type(session=session)
                wishes = list(
                    await wish_repo.get_with_min_recipients(
                        recipient=user.id, since=season_start(delivery.year)
                    )
                )
                if wishes:
                    wish = random.choice(wishes)
                    delivery.wish_id = wish.id
                    await wish_repo.increment_recipients(wish.id)
                    # The author's ball lights up
                    await mandarins.award(
                        session, wish.author_id, mandarins.Reason.WISH_DELIVERED, delivery.id
                    )

            if delivery.opened_at is None:
                delivery.opened_at = utc_now()
                await mandarins.award(session, user.id, mandarins.Reason.GIFT_OPENED, delivery.id)

            session.add(delivery)
            await session.commit()
            return await self._to_dto(delivery)

    async def inbox(self, telegram_id: int) -> list[DeliveryDTO]:
        """All opened gifts of the user, newest first"""
        async with new_db_session() as session:
            user = await self._user(session, telegram_id)
            if not user:
                return []
            deliveries = (
                await session.scalars(
                    select(Delivery)
                    .where(Delivery.recipient_id == user.id)
                    .where(col(Delivery.opened_at).is_not(None))
                    .order_by(col(Delivery.year).desc())
                )
            ).all()
        return [await self._to_dto(d) for d in deliveries]

    async def react(
        self,
        telegram_id: int,
        delivery_id: UUID,
        reaction: str | None = None,
        reply: str | None = None,
    ) -> ReactionResult:
        """
        Set a reaction and/or an anonymous reply to the received wish.
        The reaction can be changed, the reply can be sent only once.
        """
        if reaction is not None and reaction not in REACTIONS:
            raise DeliveryError("Unknown reaction")
        if reply is not None:
            reply = reply.strip()[:MAX_REPLY_LENGTH] or None

        async with new_db_session() as session:
            user = await self._user(session, telegram_id)
            delivery = await session.get(Delivery, delivery_id)
            if not (user and delivery and delivery.recipient_id == user.id):
                raise DeliveryError("Gift not found")
            if delivery.wish_id is None:
                raise DeliveryError("Gift is empty")

            is_new_reaction = bool(reaction) and delivery.reaction is None
            is_new_reply = bool(reply) and delivery.reply is None
            if reaction:
                delivery.reaction = reaction
            if is_new_reply:
                delivery.reply = reply

            session.add(delivery)
            author = (
                await session.execute(
                    select(User.id, User.telegram_id)
                    .join(Wish, col(Wish.author_id) == User.id)
                    .where(Wish.id == delivery.wish_id)
                )
            ).first()
            author_tg_id = author[1] if author else None
            if author and is_new_reaction:
                await mandarins.award(session, author[0], mandarins.Reason.REACTION, delivery.id)
            if author and is_new_reply:
                await mandarins.award(session, author[0], mandarins.Reason.REPLY, delivery.id)
            await session.commit()

        return ReactionResult(
            author_telegram_id=author_tg_id,
            reaction=delivery.reaction,
            reply=delivery.reply,
            is_new_reaction=is_new_reaction,
            is_new_reply=is_new_reply,
        )

    async def _to_dto(self, delivery: Delivery) -> DeliveryDTO:
        wish = None
        if delivery.wish_id:
            wish = await self.wish_service.get_one(delivery.wish_id)
        return DeliveryDTO(
            id=delivery.id,
            year=delivery.year,
            opened_at=delivery.opened_at,
            reaction=delivery.reaction,
            reply=delivery.reply,
            wish=wish,
        )

    # ====== Author side ====== #
    async def feedback(self, wish_ids: Iterable[UUID]) -> dict[UUID, FeedbackDTO]:
        wish_ids = list(wish_ids)
        result = {wish_id: FeedbackDTO() for wish_id in wish_ids}
        if not wish_ids:
            return result

        async with new_db_session() as session:
            rows = (
                await session.execute(
                    select(Delivery.wish_id, Delivery.reaction, Delivery.reply)
                    .where(col(Delivery.wish_id).in_(wish_ids))
                    .order_by(col(Delivery.opened_at))
                )
            ).all()

        counters: dict[UUID, Counter] = {}
        for wish_id, reaction, reply in rows:
            feedback = result[wish_id]
            feedback.recipients += 1
            if reaction:
                counters.setdefault(wish_id, Counter())[reaction] += 1
            if reply:
                feedback.replies.append(reply)
        for wish_id, counter in counters.items():
            result[wish_id].reactions = dict(counter.most_common())
        return result

    # ====== Public stats ====== #
    async def stats(self) -> dict:
        year = current_season_year()

        async with new_db_session() as session:
            users = await session.scalar(select(func.count(col(User.id))))
            by_tz = (
                await session.execute(
                    select(User.timezone, func.count(col(User.id))).group_by(User.timezone)
                )
            ).all()
            wishes = await session.scalar(
                select(func.count(col(Wish.id)))
                .where(Wish.valid_status == ValidStatus.APPROVED)
                .where(col(Wish.timestamp) >= season_start(year))
            )
            opened = await session.scalar(
                select(func.count(col(Delivery.id)))
                .where(Delivery.year == year)
                .where(col(Delivery.opened_at).is_not(None))
            )
            reactions = await session.scalar(
                select(func.count(col(Delivery.id)))
                .where(Delivery.year == year)
                .where(col(Delivery.reaction).is_not(None))
            )

        return {
            "year": year,
            "participants": users or 0,
            "wishes": wishes or 0,
            "opened": opened or 0,
            "reactions": reactions or 0,
            "timezones": {tz: count for tz, count in by_tz},
        }

    async def invited_count(self, telegram_id: int) -> int:
        async with new_db_session() as session:
            user = await self._user(session, telegram_id)
            if not user:
                return 0
            return (
                await session.scalar(
                    select(func.count(col(User.id))).where(User.referrer_id == user.id)
                )
                or 0
            )
