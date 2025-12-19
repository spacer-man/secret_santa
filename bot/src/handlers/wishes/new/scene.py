import asyncio
import logging

from aiogram import F
from aiogram.enums import ParseMode
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery
from aiogram.types import Message
from aiogram.utils import markdown
from pydantic import ValidationError

from . import messages
from .types import NewWishData
from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.depends import wish_service


log = logging.getLogger()


class WishingScene(
        CancellableScene,
        state=Scenes.WISHING,
        ):
    """Creating new wish"""
    @on.callback_query.enter()
    async def enter_new_wish_callback(self, call: CallbackQuery) -> None:
        await call.answer()

        if call.message:
            await self.enter_new_wish(message=call.message)

    @on.message.enter()
    async def enter_new_wish(self, message: Message) -> None:
        await message.delete()

        if await self.wizard.get_value("header_message_id") is None:
            header = await message.answer(
                text=messages.ENTER_NEW_WISH,
                reply_markup=common_keyboards.CANCEL)
            await self.wizard.update_data(header_message_id=header.message_id)

    @on.message()
    async def new_wish(self, _: Message) -> None:
        await self.wizard.goto(Scenes.CONFIRM_NEW_WISH)


class ConfirmNewWish(
        CancellableScene,
        state=Scenes.CONFIRM_NEW_WISH,
        ):
    async def check_wish_correct(
            self,
            message: Message,
            wish: NewWishData,
            ) -> None:
        await self.wizard.update_data(new_wish=wish.model_dump(mode="json"))
        await message.answer(
            text=messages.CONFIRM_NEW_WISH % {
                "wish_message": markdown.hblockquote(wish.message),
            },
            parse_mode=ParseMode.HTML,
            reply_markup=common_keyboards.CONFIRM_OR_BACK)

    @on.message.enter()
    async def check_wish(self, message: Message) -> None:
        message_text = message.text
        if not message_text:
            return None

        try:
            new_wish = NewWishData(
                author_telegram_id=message.chat.id,
                message=message_text)

        except ValidationError:
            alert = await message.answer(text=messages.WISH_IS_TOO_SHORT_OR_LONG)
            await self.wizard.back()
            await asyncio.sleep(5)
            await alert.delete()

        except Exception:
            alert = await message.answer(text=messages.UNKNOWN_INTERNAL_ERROR)
            await self.wizard.back()
            await asyncio.sleep(5)
            await alert.delete()

        else:
            # Delete previous message
            await message.delete()

            await self.check_wish_correct(message=message, wish=new_wish)

    @on.callback_query(F.data == buttons.CONFIRM)
    async def confirm_timezone(self, call: CallbackQuery) -> None:
        message = call.message
        if not isinstance(message, Message):
            return None

        wish = NewWishData.model_validate(
            await self.wizard.get_value("new_wish"))

        # Delete previous message
        await message.delete()
        header_message_id = await self.wizard.get_value("header_message_id")
        bot = message.bot
        if bot and header_message_id is not None:
            await bot.delete_message(
                chat_id=message.chat.id,
                message_id=header_message_id)

        if wish:
            await wish_service.new_wish(
                author_telegram_id=wish.author_telegram_id,
                message=wish.message)


        alert = await message.answer(text=messages.THANKS_FOR_WISH)
        await self.wizard.exit()
        await asyncio.sleep(3)
        await alert.delete()
