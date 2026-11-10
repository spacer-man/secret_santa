import asyncio
import logging
import random
from datetime import UTC, datetime

from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import FSInputFile, InlineKeyboardMarkup

import timezones
from configs.labels import LabelsConfig
from handlers import keyboards as common_keyboards
from services.delivery import DeliveryService

from . import messages

log = logging.getLogger(__name__)


# Telegram allows ~30 messages per second for a bot
SEND_INTERVAL = 0.05


class MailerService:
    """
    Sends gifts when the New Year comes in user's timezone.

    Runs every minute: every timezone where it's 1 January now gets gifts for
    users who haven't got one yet. So delays, restarts and users who register
    after midnight are handled too.
    """

    def __init__(self, bot: Bot, delivery_service: DeliveryService) -> None:
        self.bot = bot
        self.delivery_service = delivery_service
        self._lock = asyncio.Lock()

    def gift_keyboard(self) -> InlineKeyboardMarkup:
        rows = [*common_keyboards.OPEN_WISH.inline_keyboard]
        if app_row := common_keyboards.open_app(path="inbox"):
            rows.append(app_row)
        return InlineKeyboardMarkup(inline_keyboard=rows)

    async def send_gift(self, reciever: int) -> None:
        color = random.choice(("white", "red", "blue"))
        await self.bot.send_photo(
            chat_id=reciever,
            photo=FSInputFile(LabelsConfig().gift(color)),
            caption=messages.NEW_WISH_ALERT,
            reply_markup=self.gift_keyboard(),
        )

    async def send_gifts(self, tz: str, year: int) -> None:
        recipients = await self.delivery_service.pending_recipients(tz, year)
        if recipients:
            log.info(f"New Year {year} in {tz}: sending {len(recipients)} gifts")

        for recipient in recipients:
            # Mark first: a user must never get two gifts
            await self.delivery_service.mark_notified(recipient.user_id, year)
            try:
                await self.send_gift(reciever=recipient.telegram_id)
            except TelegramRetryAfter as err:
                await asyncio.sleep(err.retry_after)
                await self.send_gift(reciever=recipient.telegram_id)
            except TelegramForbiddenError:
                log.info(f"Bot is blocked by user {recipient.telegram_id}")
            except Exception:
                log.warning(f"Failed to send gift to user {recipient.telegram_id}", exc_info=True)
            await asyncio.sleep(SEND_INTERVAL)

    async def check_ny_and_send_wishes(self, now: datetime | None = None) -> None:
        if self._lock.locked():
            return None  # Previous run is still sending

        async with self._lock:
            now = now or datetime.now(UTC)
            for tz in timezones.ALL_TIMEZONES:
                if (year := timezones.new_year_year(tz, now)) is not None:
                    await self.send_gifts(tz=tz, year=year)
