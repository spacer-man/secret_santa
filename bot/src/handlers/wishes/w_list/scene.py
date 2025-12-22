import asyncio
from uuid import UUID

from aiogram import F
from aiogram.enums import ChatAction
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery
from aiogram.types import Message

from . import keyboards
from . import messages
from . import utils
from .keyboards import OptionPrefix
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.consts import MESSAGES_FSM_KEY
from handlers.depends import wish_service


class WishesListScene(
        CancellableScene,
        state=Scenes.WISHES_LIST,
        ):
    @on.callback_query.enter()
    async def show_wishes_list(self, call: CallbackQuery) -> None:
        await call.answer()
        bot = call.bot
        message = call.message
        if not (isinstance(message, Message) and bot):
            return None

        user_wishes = [wish async for wish in await wish_service.my_wishes(
                author_telegram_id=message.chat.id)]

        if not user_wishes:
            alert = await message.answer(text=messages.YOU_HAVE_NO_WISHES)
            await self.wizard.back()
            await asyncio.sleep(3)
            await alert.delete()
            return None

        await message.delete()
        await message.answer(
            text="*YOUR WISHES*",
            reply_markup=common_keyboards.BACK)

        saved_messages: list[int] = []
        for wish in user_wishes:
            msgs = await utils.send_wish(message=message, bot=bot, wish=wish)
            saved_messages.extend(msg.message_id for msg in msgs)

        await self.wizard.update_data({MESSAGES_FSM_KEY: saved_messages})

    @on.callback_query(F.data.startswith(OptionPrefix.DELETE))
    async def delete_wish(self, call: CallbackQuery) -> None:
        message = call.message
        callback_data = call.data
        if not isinstance(message, Message) or not callback_data:
            return None

        wish_id = callback_data[len(OptionPrefix.DELETE):]

        await message.edit_reply_markup(
            reply_markup=keyboards.confirm_delete_wish(wish_id=wish_id))

    @on.callback_query(F.data.startswith(OptionPrefix.CANCEL))
    async def cancel_delete_wish(self, call: CallbackQuery) -> None:
        message = call.message
        callback_data = call.data
        if not isinstance(message, Message) or not callback_data:
            return None

        wish_id = callback_data[len(OptionPrefix.CANCEL):]

        await message.edit_reply_markup(
            reply_markup=keyboards.wish_item_options(wish_id=wish_id))

    @on.callback_query(F.data.startswith(OptionPrefix.CONFIRM))
    async def confirm_delete_wish(self, call: CallbackQuery) -> None:
        message = call.message
        callback_data = call.data
        if not isinstance(message, Message) or not callback_data:
            return None

        wish_id = UUID(callback_data[len(OptionPrefix.CONFIRM):])

        await wish_service.delete(wish_id=wish_id)
        await message.delete()
        wish_messages: list[int] | None = await self.wizard.get_value(
            key=MESSAGES_FSM_KEY)
        if wish_messages:
            await self.wizard.update_data({MESSAGES_FSM_KEY: [
                msg for msg in wish_messages if msg != message.message_id]})

    @on.callback_query.leave()
    async def clear_scene(self, call: CallbackQuery) -> None:
        message_ids: list[int] | None = await self.wizard.get_value(
            key=MESSAGES_FSM_KEY)
        if call.bot and call.message and message_ids:
            await call.bot.delete_messages(
                chat_id=call.message.chat.id,
                message_ids=message_ids)
