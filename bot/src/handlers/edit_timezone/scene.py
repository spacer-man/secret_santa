import asyncio
from datetime import datetime

from aiogram import F
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery
from aiogram.types import Message

from . import messages
from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.depends import user_service
from handlers.utils.timezone import ALL_TIMEZONES
from handlers.utils.timezone import clock_emoji
from handlers.utils.timezone import tz_from_timeshift


class EditTimezoneScene(
        CancellableScene,
        state=Scenes.EDIT_TIMEZONE,
        ):
    """Edit timezone scene"""
    @on.callback_query.enter()
    async def choose_timezone(self, call: CallbackQuery) -> None:
        message = call.message
        if not isinstance(message, Message):
            return None

        # Delete previous message
        await message.delete()

        # Show timezone menu
        await self.choose_timezone_menu(message=message)

    async def choose_timezone_menu(
            self,
            message: Message,
            ) -> None:
        await message.answer(
            text=messages.CHOOSE_TIMEZONE,
            reply_markup=common_keyboards.TIMEZONE_MENU_OR_CANCEL)

    @on.callback_query(F.data.in_(ALL_TIMEZONES))
    async def set_timezone(self, _: CallbackQuery) -> None:
        await self.wizard.goto(Scenes.CONFIRM_EDIT_TIMEZONE)


class ConfirmEditTimezoneScene(
        CancellableScene,
        state=Scenes.CONFIRM_EDIT_TIMEZONE,
        ):
    async def check_timezone_correct(
            self,
            message: Message,
            timezone: str,
            ) -> None:
        await self.wizard.update_data(selected_timezone=timezone)
        time_now = datetime.now(tz_from_timeshift(timezone))
        await message.answer(
            text=messages.CONFIRM_TIMEZONE % {
                "timezone": timezone,
                "clock_emoji": clock_emoji(hour=time_now.hour),
                "time_now": time_now.strftime("%H:%M"),
            },
            reply_markup=common_keyboards.CONFIRM_OR_BACK)

    @on.callback_query.enter()
    async def check_timezone(self, call: CallbackQuery) -> None:
        timezone = call.data
        message = call.message
        if not timezone:
            return None
        if not isinstance(message, Message):
            return None

        # Delete previous message
        await message.delete()

        await self.check_timezone_correct(message=message, timezone=timezone)

    @on.callback_query(F.data == buttons.CONFIRM)
    async def confirm_timezone(self, call: CallbackQuery) -> None:
        message = call.message
        if not isinstance(message, Message):
            return None

        timezone = await self.wizard.get_value("selected_timezone")

        # Delete previous message
        await message.delete()

        if timezone:
            await user_service.edit_user(
                telegram_id=message.chat.id,
                timezone=timezone)

        # Messages
        alert = await message.answer(text=messages.SUCCESSFULL_SELECT_TIMEZONE)
        await self.wizard.exit()
        await asyncio.sleep(5)
        await alert.delete()
