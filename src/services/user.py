from typing import Required
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from repos.user.abc import UserRepository


class UserAlreadyRegisteredError(Exception):
    pass


class NewUserArgs(TypedDict, total=False):
    timezone: Required[str]
    telegram_id: Required[int]


class UserService(object):
    def __init__(self, user_repo: UserRepository) -> None:
        self.repo = user_repo

    async def is_registered(self, telegram_id: int) -> bool:
        """
        Return `True` if user was registered.

        :return: :class:`bool`
        """
        return not not await self.repo.get_one(
            filter_by={"telegram_id": telegram_id})

    async def register(self, **kwargs: Unpack[NewUserArgs]) -> UUID:
        """
        Register new user if user was not registered.
        Else raise exception.

        :return: :class:`UUID`
        """
        telegram_id = kwargs["telegram_id"]
        if await self.is_registered(telegram_id=telegram_id):
            raise UserAlreadyRegisteredError(
                "User with telegram_id=%d already registered" % telegram_id)

        user_id = await self.repo.create(**kwargs)
        return user_id
