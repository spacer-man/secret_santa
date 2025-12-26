from typing import Protocol

from services.wish import WishDTO


class NotifyService(Protocol):
    async def new_wish_to_check(self, wish: WishDTO) -> None: ...
