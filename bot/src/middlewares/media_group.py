import asyncio
import logging
from collections import defaultdict
from typing import Callable, Dict, Any, Awaitable

from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject


log = logging.getLogger(__name__)


MEIDA_GROUP_ARG_KEY = "media_group"


class MediaGroupMiddleware(BaseMiddleware):
    def __init__(self, timeout: float = 0.1) -> None:
        """
        Middleware for easy media group processing.

        Args:
            timeout: `float`    # The timeout of waiting next media group items
        """
        self.timeout = timeout
        self.data = defaultdict[str, list[Message]](list)

    def new_media(self, message: Message) -> None:
        if message.media_group_id:
            self.data[message.media_group_id].append(message)

    def media_count(self, media_group_id: str) -> int:
        return len(self.data.get(media_group_id, []))

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        # Skip not media group events
        if not isinstance(event, Message):
            return await handler(event, data)
        message = event
        if not (media_group_id := message.media_group_id):
            return await handler(event, data)

        # Process media group message
        self.new_media(message=message)
        media_count = self.media_count(media_group_id=media_group_id)

        # Wait possible next media group message
        await asyncio.sleep(self.timeout)

        # Process media group if this event was the last
        if media_count == self.media_count(media_group_id=media_group_id):
            data[MEIDA_GROUP_ARG_KEY] = self.data.pop(media_group_id)
            return await handler(message, data)
        return None
