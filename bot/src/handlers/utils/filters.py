from aiogram.filters import BaseFilter
from aiogram.types import Message

from services.user import UserService


class IsRegistered(BaseFilter):
    def __init__(self, user_service: UserService) -> None:
        self.user_service = user_service

    # BaseFilter declares __call__ as a broader attribute for type checkers
    async def __call__(self, message: Message) -> bool:  # ty: ignore[incompatible-mutable-override]
        """
        Return `True` if user was registered.

        :return: :class:`bool`
        """
        return await self.user_service.is_registered(telegram_id=message.chat.id)
