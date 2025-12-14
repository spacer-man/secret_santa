import logging
from typing import Callable, Dict, Any, Awaitable

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject

from db import new_db_session


log = logging.getLogger(__name__)


class DBSessionMiddleware(BaseMiddleware):
    async def __call__(
            self,
            handler: Callable[
                [TelegramObject, Dict[str, Any]], Awaitable[Any]
            ],
            event: TelegramObject,
            data: Dict[str, Any],
            ) -> Any:
        async with new_db_session() as session:
            data["db"] = session
            try:
                result = await handler(event, data)
            except Exception as err:
                log.error("Database session middleware error: %r", err,
                    exc_info=True)
            else:
                return result
