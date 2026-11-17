"""
New Year gifts: who received which wish, reactions and anonymous replies.
"""

import math
import random
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, update
from sqlmodel import col, select

import timezones
from db import new_db_session
from db.models import Delivery, Letter, User, ValidStatus, Wish
from repos.wish.abc import WishRepository
from services import creators, mandarins, shop
from services.creators import CreatorsText
from services.notifier import lang_of
from services.wish import WishDTO, WishService

REACTIONS = ("❤️", "😂", "🥹", "🔥", "🎉", "👏")
MAX_REPLY_LENGTH = 1024
# Letters from participants in one box (the creators' letter is on top of them)
MAX_LETTERS = 5


class DeliveryError(Exception):
    pass


class LetterDTO(BaseModel):
    id: UUID
    # The letter from the creators (``creators_text``) instead of a wish
    creators: bool = False
    creators_text: CreatorsText | None = None
    wish: WishDTO | None = None
    reaction: str | None = None
    reply: str | None = None
    # The wish was erased with its author's account
    erased: bool = False


class DeliveryDTO(BaseModel):
    id: UUID
    year: int
    opened_at: datetime | None
    letters: list[LetterDTO] = []


class FeedbackDTO(BaseModel):
    """What recipients answered to a wish"""

    recipients: int = 0
    reactions: dict[str, int] = {}
    replies: list[str] = []


class Recipient(BaseModel):
    user_id: UUID
    telegram_id: int | None = None
    email: str | None = None
    language: str | None = None
    notify: str | None = None


class ReactionResult(BaseModel):
    author_id: UUID | None = None
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
            stmt = select(User).where(User.timezone == tz).where(col(User.id).not_in(delivered))
            users = (await session.scalars(stmt)).all()
        return [
            Recipient(
                user_id=u.id,
                telegram_id=u.telegram_id,
                email=u.email,
                language=u.language,
                notify=u.notify,
            )
            for u in users
        ]

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
    async def _user(self, session, who: int | UUID) -> User | None:
        """``who``: Telegram id (the bot) or account id (the app)"""
        if isinstance(who, UUID):
            return await session.get(User, who)
        return await session.scalar(select(User).where(User.telegram_id == who))

    async def current(self, who: int | UUID) -> DeliveryDTO | None:
        """
        The gift of the current New Year for the user.
        ``None`` if the New Year hasn't come for the user yet.
        """
        async with new_db_session() as session:
            user = await self._user(session, who)
            if not user:
                return None
            delivery = await self._current_delivery(session, user)
            if not delivery:
                return None
            await session.commit()
            return await self._to_dto(session, delivery, user.language)

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

    async def open(self, who: int | UUID) -> DeliveryDTO | None:
        """
        Open the gift: put the letters in the box (once).
        ``None`` if the New Year hasn't come for the user yet.
        """
        async with new_db_session() as session:
            user = await self._user(session, who)
            if not user:
                return None
            delivery = await self._current_delivery(session, user)
            if not delivery:
                return None

            # Two taps at once (the bot and the app): only one fills the box
            await session.refresh(delivery, with_for_update=True)
            if delivery.opened_at is None:
                await self._fill(session, user, delivery)
                delivery.opened_at = utc_now()
                await mandarins.award(session, user.id, mandarins.Reason.GIFT_OPENED, delivery.id)

            session.add(delivery)
            await session.commit()
            return await self._to_dto(session, delivery, user.language)

    async def _fill(self, session, user: User, delivery: Delivery) -> None:
        """
        Letters for the box. Every wish of the season should reach someone, so the box gets
        a share of the undelivered ones: undelivered / participants who haven't opened yet
        (at least one, at most :data:`MAX_LETTERS`; the user's own ones count too), or more
        when an author's wishes have few people left to go to. Wishes written later go to those who
        open later. Fewer wishes than people: a wish goes to several of them. Never the
        user's own wish, never one wish twice in a box; least delivered ones first.
        """
        if await creators.exists(session, delivery.year):
            session.add(Letter(delivery_id=delivery.id, position=0, creators=True))

        wishes = (
            await session.execute(
                select(Wish.id, Wish.author_id, Wish.recipients_count)
                .join(User, col(User.id) == Wish.author_id)
                # Authors who deleted their account: their wishes wait (and go with it)
                .where(col(User.deleted_at).is_(None))
                .where(Wish.valid_status == ValidStatus.APPROVED)
                .where(col(Wish.timestamp) >= season_start(delivery.year))
            )
        ).all()
        # The user's own wishes count in the share (others will take them), but never come
        undelivered = sum(1 for w in wishes if w.recipients_count == 0)
        wishes = [w for w in wishes if w.author_id != user.id]
        if not wishes:
            return None

        opened = select(Delivery.recipient_id).where(
            Delivery.year == delivery.year, col(Delivery.opened_at).is_not(None)
        )
        waiting = await session.scalar(
            select(func.count(col(User.id)))
            .where(col(User.deleted_at).is_(None))
            .where(col(User.id).not_in(opened))
        )
        waiting = max(waiting or 0, 1)
        share = math.ceil(undelivered / waiting)

        # An author's undelivered wishes can go to everyone waiting but the author: when few
        # such people are left, each of them takes more (otherwise the last ones get stuck)
        pending = Counter(w.author_id for w in wishes if w.recipients_count == 0)
        authors_waiting = set(
            (
                await session.scalars(
                    select(User.id)
                    .where(col(User.id).in_(list(pending)))
                    .where(col(User.id).not_in(opened))
                )
            ).all()
        )
        pressure = {
            author: count / max(waiting - (author in authors_waiting), 1)
            for author, count in pending.items()
        }
        share = max(share, *(math.ceil(p) for p in pressure.values()), 0)
        count = min(MAX_LETTERS, max(1, share))

        # Least delivered first; among them the hardest to place; random among equals
        chosen = sorted(
            wishes,
            key=lambda w: (w.recipients_count, -pressure.get(w.author_id, 0), random.random()),
        )[:count]
        for position, wish in enumerate(chosen, start=1):
            session.add(Letter(delivery_id=delivery.id, position=position, wish_id=wish.id))
            await session.execute(
                update(Wish)
                .where(col(Wish.id) == wish.id)
                .values(recipients_count=col(Wish.recipients_count) + 1)
            )
            # The author's ball lights up (rewarded once per wish)
            await mandarins.award(session, wish.author_id, mandarins.Reason.WISH_DELIVERED, wish.id)
        await session.flush()

    async def inbox(self, who: int | UUID) -> list[DeliveryDTO]:
        """All opened gifts of the user, newest first"""
        async with new_db_session() as session:
            user = await self._user(session, who)
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
            return [await self._to_dto(session, d, user.language) for d in deliveries]

    async def react(
        self,
        who: int | UUID,
        letter_id: UUID,
        reaction: str | None = None,
        reply: str | None = None,
    ) -> ReactionResult:
        """
        Set a reaction and/or an anonymous reply to a letter of the user's gift.
        The reaction can be changed, the reply can be sent only once.
        The creators' letter can be answered too: no author to notify, no mandarins.
        """
        if reaction is not None and reaction not in REACTIONS:
            raise DeliveryError("Unknown reaction")
        if reply is not None:
            reply = reply.strip()[:MAX_REPLY_LENGTH] or None

        async with new_db_session() as session:
            user = await self._user(session, who)
            letter = await session.get(Letter, letter_id)
            delivery = await session.get(Delivery, letter.delivery_id) if letter else None
            if not (user and letter and delivery and delivery.recipient_id == user.id):
                raise DeliveryError("Gift not found")
            if letter.wish_id is None and not letter.creators:
                raise DeliveryError("Gift is empty")

            is_new_reaction = bool(reaction) and letter.reaction is None
            is_new_reply = bool(reply) and letter.reply is None
            if reaction:
                letter.reaction = reaction
            if is_new_reply:
                letter.reply = reply

            session.add(letter)
            author = None
            if letter.wish_id:
                author = (
                    await session.execute(
                        select(User.id, User.telegram_id)
                        .join(Wish, col(Wish.author_id) == User.id)
                        .where(Wish.id == letter.wish_id)
                    )
                ).first()
            if author and is_new_reaction:
                await mandarins.award(session, author[0], mandarins.Reason.REACTION, letter.id)
            if author and is_new_reply:
                await mandarins.award(session, author[0], mandarins.Reason.REPLY, letter.id)
            await session.commit()

        return ReactionResult(
            author_id=author[0] if author else None,
            author_telegram_id=author[1] if author else None,
            reaction=letter.reaction,
            reply=letter.reply,
            is_new_reaction=is_new_reaction and author is not None,
            is_new_reply=is_new_reply and author is not None,
        )

    async def _to_dto(self, session, delivery: Delivery, language: str | None) -> DeliveryDTO:
        letters = (
            await session.scalars(
                select(Letter)
                .where(Letter.delivery_id == delivery.id)
                .order_by(col(Letter.position))
            )
        ).all()
        result = []
        for letter in letters:
            dto = LetterDTO(
                id=letter.id,
                creators=letter.creators,
                reaction=letter.reaction,
                reply=letter.reply,
                erased=letter.wish_erased,
            )
            if letter.creators:
                dto.creators_text = await creators.text(delivery.year, lang_of(language))
            elif letter.wish_id:
                dto.wish = await self.wish_service.get_one(letter.wish_id)
            result.append(dto)
        return DeliveryDTO(
            id=delivery.id, year=delivery.year, opened_at=delivery.opened_at, letters=result
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
                    select(Letter.wish_id, Letter.reaction, Letter.reply)
                    .where(col(Letter.wish_id).in_(wish_ids))
                    .order_by(col(Letter.id))
                )
            ).all()

        counters: dict[UUID, Counter] = {}
        for wish_id, reaction, reply in rows:
            if wish_id is None:
                continue
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
            alive = col(User.deleted_at).is_(None)
            users = await session.scalar(select(func.count(col(User.id))).where(alive))
            by_tz = (
                await session.execute(
                    select(User.timezone, func.count(col(User.id)))
                    .where(alive)
                    .group_by(User.timezone)
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
                select(func.count(col(Letter.id)))
                .join(Delivery, col(Delivery.id) == Letter.delivery_id)
                .where(Delivery.year == year)
                .where(col(Letter.wish_id).is_not(None))
                .where(col(Letter.reaction).is_not(None))
            )

        return {
            "year": year,
            "participants": users or 0,
            "wishes": wishes or 0,
            "opened": opened or 0,
            "reactions": reactions or 0,
            "timezones": {tz: count for tz, count in by_tz},
        }

    async def invited_count(self, who: int | UUID) -> int:
        async with new_db_session() as session:
            user = await self._user(session, who)
            if not user:
                return 0
            return await shop.friends_count(session, user.id)
