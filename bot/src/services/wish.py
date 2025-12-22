import json
from datetime import datetime
from typing import (
    AsyncGenerator,
    Generator,
    Iterable,
    NotRequired,
    Required,
    TypedDict,
    Unpack,
)
from uuid import UUID

from aiogram.types import MessageEntity
from pydantic import BaseModel, Field

from db import new_db_session
from db.models import MediaType
from repos.user.abc import UserRepository
from repos.wish.abc import WishRepository
from repos.media.abc import MediaRepository


# Exceptions
class WishAuthorNotFoundError(Exception):
    pass


# DTOs
class MediaDTO(BaseModel):
    id: UUID
    data: bytes
    type: MediaType

class WishDTO(BaseModel):
    id: UUID
    author_id: UUID
    author_telegram_id: int
    text: str = Field(min_length=8, max_length=4096)
    text_entities: list[MessageEntity] | None = Field(default=None)
    effect_id: str | None = Field(default=None)
    timestamp: datetime
    media: Generator[MediaDTO]


# Args
class WishMediaData(TypedDict):
    data: bytes
    type: MediaType

class NewWishArgs(TypedDict):
    author_telegram_id: Required[int]
    text: Required[str]
    text_entities: NotRequired[list[MessageEntity] | None]
    effect_id: NotRequired[str | None]
    media: NotRequired[Iterable[WishMediaData]]


# Service
class WishService(object):
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
            author = await user_repo.get_one(
                filter_by={"telegram_id": author_telegram_id})
            if not author:
                raise WishAuthorNotFoundError(
                    "User with telegram_id=%d not found" % author_telegram_id)

            author_id = author.id
            text_entities = kwargs.get("text_entities")
            if text_entities is not None:
                text_entities = json.dumps([
                    entity.model_dump(mode="json")
                    for entity in text_entities
                ])
            wish_id = await wish_repo.create(
                author_id=author_id,
                text_entities=text_entities,
                effect_id=kwargs.get("effect_id"),
                text=kwargs["text"])
            await db_session.commit()

            if media := kwargs.get("media"):
                for media_item in media:
                    await media_repo.create(
                        wish_id=wish_id,
                        data=media_item["data"],
                        type=media_item["type"])
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
            for media in await media_repo.get_many(
                filter_by={"wish_id": wish_id})
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
        for wish in await wish_repo.get_many(
                filter_by={"author_id": author_id}):
            yield WishDTO.model_validate(obj={
                **wish.model_dump(),
                "author_telegram_id": author_telegram_id,
                "media": await self._wish_medias(
                    wish_id=wish.id, media_repo=media_repo),
            })

    async def my_wishes(self, author_telegram_id: int) -> AsyncGenerator[WishDTO]:
        """
        Get wishes :class:`Generator`.

        :returns: :class:`Generator[WishDTO]`
        """
        async with new_db_session() as db_session:
            user_repo = self.user_repo_type(session=db_session)
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)
            author = await user_repo.get_one(
                filter_by={"telegram_id": author_telegram_id})

            if not author:
                raise WishAuthorNotFoundError(
                    "User with telegram_id=%d not found" % author_telegram_id)

            wishes = self._wishes_generator(
                author_id=author.id,
                author_telegram_id=author_telegram_id,
                wish_repo=wish_repo,
                media_repo=media_repo)

        return wishes


    async def delete(self, wish_id: UUID) -> None:
        """
        Remove wish by id.
        If hasn't wish with specified id than pass.

        :returns: :class:`None`
        """
        async with new_db_session() as db_session:
            wish_repo = self.wish_repo_type(session=db_session)
            media_repo = self.media_repo_type(session=db_session)

            await media_repo.delete(filter_by={"wish_id": wish_id})
            await wish_repo.delete(filter_by={"id": wish_id})

            await db_session.commit()
