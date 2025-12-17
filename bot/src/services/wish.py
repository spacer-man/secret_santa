from datetime import datetime
from typing import Required
from typing import Sequence
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field

from repos.user.abc import UserRepository
from repos.wish.abc import WishRepository


class WishAuthorNotFoundError(Exception):
    pass


class WishDTO(BaseModel):
    id: UUID
    author_id: UUID
    author_telegram_id: int
    message: str = Field(min_length=8, max_length=4096)
    timestamp: datetime


class NewWishArgs(TypedDict):
    author_telegram_id: Required[int]
    message: Required[str]


class WishService(object):
    def __init__(
            self,
            user_repo: UserRepository,
            wish_repo: WishRepository,
            ) -> None:
        self.user_repo = user_repo
        self.wish_repo = wish_repo

    async def new_wish(self, **kwargs: Unpack[NewWishArgs]) -> UUID:
        author_telegram_id = kwargs["author_telegram_id"]
        author = await self.user_repo.get_one(
            filter_by={"telegram_id": author_telegram_id})

        if not author:
            raise WishAuthorNotFoundError(
                "User with telegram_id=%d not found" % author_telegram_id)

        author_id = author.id
        wish_id = await self.wish_repo.create(
            author_id=author_id,
            message=kwargs["message"])

        return wish_id

    async def my_wishes(self, author_telegram_id: int) -> Sequence[WishDTO]:
        author = await self.user_repo.get_one(
            filter_by={"telegram_id": author_telegram_id})

        if not author:
            raise WishAuthorNotFoundError(
                "User with telegram_id=%d not found" % author_telegram_id)

        author_id = author.id
        wishes = [
            WishDTO.model_validate(obj={
                **wish.model_dump(),
                "author_telegram_id": author_telegram_id,
            })
            for wish in await self.wish_repo.get_many(
                filter_by={"author_id": author_id})
        ]

        return wishes


    async def delete(self, wish_id: UUID) -> None:
        await self.wish_repo.delete(filter_by={"id": wish_id})
