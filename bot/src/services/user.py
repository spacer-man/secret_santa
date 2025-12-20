from typing import Required
from typing import TypedDict
from typing import Unpack
from uuid import UUID

from db import new_db_session
from repos.user.abc import UserRepository


class UserAlreadyRegisteredError(Exception):
    pass


class NewUserArgs(TypedDict, total=False):
    timezone: Required[str]
    telegram_id: Required[int]


class UserService(object):
    def __init__(self, user_repo_type: type[UserRepository]) -> None:
        self.repo_type = user_repo_type

    async def _is_user_registered(
            self,
            telegram_id: int,
            repo: UserRepository,
            ) -> bool:
        return not not await repo.get_one(
            filter_by={"telegram_id": telegram_id})

    async def is_registered(self, telegram_id: int) -> bool:
        """
        Return `True` if user was registered.

        :return: :class:`bool`
        """
        async with new_db_session() as db_session:
            repo = self.repo_type(session=db_session)
            return await self._is_user_registered(
                telegram_id=telegram_id,
                repo=repo)

    async def register(self, **kwargs: Unpack[NewUserArgs]) -> UUID:
        """
        Register new user if user was not registered.
        Else raise exception.

        :return: :class:`UUID`
        """
        async with new_db_session() as db_session:
            repo = self.repo_type(session=db_session)

            telegram_id = kwargs["telegram_id"]
            if await self._is_user_registered(
                    telegram_id=telegram_id,
                    repo=repo):
                raise UserAlreadyRegisteredError(
                    "User with telegram_id=%d already registered" % telegram_id)

            user_id = await repo.create(**kwargs)

            await db_session.commit()
        return user_id
