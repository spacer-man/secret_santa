import asyncio
from datetime import datetime

from aiogram import F
from aiogram.fsm.scene import on
from aiogram.fsm.scene import Scene
from aiogram.types import CallbackQuery
from aiogram.types import Message

from configs.support import SupportConfig

from . import messages
from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.depends import user_service
from handlers.utils.timezone import ALL_TIMEZONES
from handlers.utils.timezone import clock_emoji
from handlers.utils.timezone import tz_from_timeshift


class RegistrationScene(
        Scene,
        state=Scenes.REGISTRATION,
        ):
    """Registration new user into bot scene"""
    @on.message.enter()
    async def greeting(self, message: Message) -> None:
        name = None
        if message.from_user:
            name = (
                message.from_user.full_name
                or message.from_user.username
                or name
            )

        greeting = await message.answer(
            text=messages.FIRST_GREETING % {"name": f", *{name}*"})
        await self.choose_timezone_menu(message=message)
        
        await asyncio.sleep(5)
        await greeting.delete()

    @on.callback_query.enter()
    async def back_to_choose(self, call: CallbackQuery) -> None:
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
            reply_markup=common_keyboards.TIMEZONE_MENU)

    @on.callback_query(F.data.in_(ALL_TIMEZONES))
    async def choose_timezone(self, _: CallbackQuery) -> None:
        await self.wizard.goto(Scenes.CONFIRM_TIMEZONE)


class ConfirmTimezoneScene(
        CancellableScene,
        state=Scenes.CONFIRM_TIMEZONE,
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
            await user_service.register(
                telegram_id=message.chat.id,
                timezone=timezone)

        # Messages
        alerts = (
            messages.SUCCESSFULL_SELECT_TIMEZONE,
            messages.SUCCESSFULL_REGISTATION,
        )
        to_delete = []
        for msg in alerts:
            to_delete.append(await message.answer(text=msg))
            await asyncio.sleep(.5)

        await message.answer(
            text=messages.SHARE_REQUEST,
            reply_markup=common_keyboards.HIDE)
        await asyncio.sleep(.5)

        await message.answer(
            text=messages.SUPPORT_REQUEST % {
                "support_link": SupportConfig().author_support_link},
            reply_markup=common_keyboards.SUPPORT_OR_HIDE,
            disable_web_page_preview=True)
        await asyncio.sleep(.5)

        to_delete.append(await message.answer(text=messages.WISH_OFFER))
        await asyncio.sleep(.5)

        await self.wizard.exit()

        await asyncio.sleep(3)
        for msg in to_delete:
            await asyncio.sleep(2)
            await msg.delete()
