import json
from collections.abc import AsyncGenerator, Generator, Iterable
from datetime import datetime
from typing import (
    NotRequired,
    Required,
    TypedDict,
    Unpack,
)
from uuid import UUID

from aiogram.types import MessageEntity
from pydantic import BaseModel, Field
from sqlmodel import update

from db import new_db_session
from db.models import Delivery, MediaType, User, ValidStatus, Wish
from repos.media.abc import MediaRepository
from repos.user.abc import UserRepository
from repos.wish.abc import WishRepository
from services import mandarins


# Exceptions
class WishAuthorNotFoundError(Exception):
    pass


# DTOs
class MediaDTO(BaseModel):
    id: UUID
    data: bytes = Field(max_length=10 * 2**20)
    type: MediaType


class WishDTO(BaseModel):
    id: UUID
    author_id: UUID
    author_telegram_id: int
    text: str = Field(min_length=8, max_length=4096)
    text_entities: list[MessageEntity] | None = Field(default=None)
    effect_id: str | None = Field(default=None)
    timestamp: datetime
    valid_status: ValidStatus = ValidStatus.ON_VALIDATION
    recipients_count: int = 0
    media: Iterable[MediaDTO]


# Args
class WishMediaData(TypedDict):
    data: bytes
    type: MediaType


class NewWishArgs(TypedDict):
    author_telegram_id: Required[int]
    ball_color: NotRequired[str | None]
    ball_pattern: NotRequired[str | None]
    text: Required[str]
    text_entities: NotRequired[list[MessageEntity] | None]
    effect_id: NotRequired[str | None]
    media: NotRequired[Iterable[WishMediaData]]


# Service
class WishService:
    """
    Serfice for manipulating with wish.
    """

    def __init__(
        self,
        user_repo_type: type[UserRepository],
        wish_repo_type: type[WishRepository],
        media_repo_type: type[MediaRepository],
    ) -> None:
        self.user_repo_type = user_repo_type
        self.wish_repo_type = wish_repo_type
        self.media_repo_type = media_repo_type

    async def new_wish(self, **kwargs: Unpack[NewWishArgs]) -> UUID:
        """
        Create new wish.
        Raise exception if specified user is uncorrect.

        :returns: :class:`UUID`     # Created wish id
        """
        async with new_db_session() as db_session:
            user_repo = self.user_repo_type(session=db_session)
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)

            author_telegram_id = kwargs["author_telegram_id"]
            author = await user_repo.get_one(filter_by={"telegram_id": author_telegram_id})
            if not author:
                raise WishAuthorNotFoundError(
                    f"User with telegram_id={author_telegram_id} not found"
                )

            author_id = author.id
            text_entities = kwargs.get("text_entities")
            if text_entities is not None:
                text_entities = json.dumps(
                    [entity.model_dump(mode="json") for entity in text_entities]
                )
            wish_id = await wish_repo.create(
                author_id=author_id,
                text_entities=text_entities,
                effect_id=kwargs.get("effect_id"),
                text=kwargs["text"],
                ball_color=kwargs.get("ball_color"),
                ball_pattern=kwargs.get("ball_pattern"),
            )
            await db_session.commit()

            if media := kwargs.get("media"):
                for media_item in media:
                    await media_repo.create(
                        wish_id=wish_id, data=media_item["data"], type=media_item["type"]
                    )
            await db_session.commit()

        return wish_id

    async def _wish_medias(
        self,
        wish_id: UUID,
        media_repo: MediaRepository,
    ) -> Generator[MediaDTO]:
        """
        Create wish medias generator.
        """
        return (
            MediaDTO.model_validate(media, from_attributes=True)
            for media in await media_repo.get_many(filter_by={"wish_id": wish_id})
        )

    async def _wishes_generator(
        self,
        author_id: UUID,
        author_telegram_id: int,
        wish_repo: WishRepository,
        media_repo: MediaRepository,
    ) -> AsyncGenerator[WishDTO]:
        """
        Create wishes async generator.
        """
        for wish in await wish_repo.get_many(filter_by={"author_id": author_id}):
            yield WishDTO.model_validate(
                obj={
                    **wish.model_dump(),
                    "author_telegram_id": author_telegram_id,
                    "media": await self._wish_medias(wish_id=wish.id, media_repo=media_repo),
                }
            )

    async def my_wishes(
        self,
        author_telegram_id: int,
    ) -> AsyncGenerator[WishDTO]:
        """
        Get wishes :class:`Generator`.

        :args:
            :param author_telegram_id: Author Telegram ID;
            :type wish_id: `int`
        :returns: :class:`Generator[WishDTO]`
        """
        async with new_db_session() as db_session:
            user_repo = self.user_repo_type(session=db_session)
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)
            author = await user_repo.get_one(filter_by={"telegram_id": author_telegram_id})

            if not author:
                raise WishAuthorNotFoundError(
                    f"User with telegram_id={author_telegram_id} not found"
                )

            wishes = self._wishes_generator(
                author_id=author.id,
                author_telegram_id=author_telegram_id,
                wish_repo=wish_repo,
                media_repo=media_repo,
            )

        return wishes

    async def get_one(self, wish_id: UUID) -> WishDTO | None:
        """
        Get a wish :class:`WishDTO`.

        :args:
            :param wish_id: Wish DB id;
            :type wish_id: `UUID`
        :returns: :class:`WishDTO`
        """
        async with new_db_session() as db_session:
            user_repo = self.user_repo_type(session=db_session)
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)

            if wish := await wish_repo.get_one(wish_id=wish_id):
                author = await user_repo.get_one(filter_by={"id": wish.author_id})
                if author:
                    return WishDTO.model_validate(
                        obj={
                            **wish.model_dump(),
                            "author_telegram_id": author.telegram_id,
                            "media": await self._wish_medias(
                                wish_id=wish.id, media_repo=media_repo
                            ),
                        }
                    )

        return None

    async def delete(self, wish_id: UUID) -> None:
        """
        Remove wish by id.
        If hasn't wish with specified id than pass.

        :args:
            :param wish_id: Wish DB id;
            :type wish_id: `UUID`
        :returns: :class:`None`
        """
        async with new_db_session() as db_session:
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)

            # Gifts that already contain the wish become empty
            await db_session.execute(
                update(Delivery)
                .where(Delivery.wish_id == wish_id)  # type: ignore
                .values(wish_id=None)
            )
            await media_repo.delete(filter_by={"wish_id": wish_id})
            await wish_repo.delete(filter_by={"id": wish_id})

            await db_session.commit()

    async def update_wish_status(
        self,
        wish_id: UUID,
        valid_status: ValidStatus,
    ) -> None:
        """
        Update valid wish status.
        If wish with current id is not exist, than do nothing.

        :args:
            :param wish_id: Wish DB id;
            :type wish_id: `UUID`
            :param valid_status: New wish valid status;
            :type valid_status: `ValidStatus` (enum.StrEnum)

        :return: :class:`None`
        """
        async with new_db_session() as db_session:
            wish_repo = self.wish_repo_type(session=db_session)

            await wish_repo.edit(id=wish_id, valid_status=valid_status)

            if valid_status == ValidStatus.APPROVED:
                await self._reward_approved(db_session, wish_id)

            await db_session.commit()

    async def _reward_approved(self, db_session, wish_id: UUID) -> None:
        """Author gets mandarins; the friend who invited them too (once)"""
        wish = await db_session.get(Wish, wish_id)
        if not wish:
            return None
        await mandarins.award(db_session, wish.author_id, mandarins.Reason.WISH_APPROVED, wish_id)
        author = await db_session.get(User, wish.author_id)
        if author and author.referrer_id:
            await mandarins.award(
                db_session, author.referrer_id, mandarins.Reason.FRIEND_WISH, author.id
            )
