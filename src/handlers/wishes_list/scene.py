from uuid import UUID

from aiogram import F
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery
from aiogram.types import Message

from . import keyboards
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
        message = call.message
        if not message:
            return None

        if isinstance(message, Message):
            await message.delete()

        await message.answer(
            text="*YOUR WISHES*",
            reply_markup=common_keyboards.BACK)

        messages: list[int] = [
                (await message.answer(
                    text=wish.message,
                    reply_markup=keyboards.wish_item_options(
                        wish_id=wish.id))
                ).message_id
            for wish in await wish_service.my_wishes(
                author_telegram_id=message.chat.id)
        ]

        await self.wizard.update_data({MESSAGES_FSM_KEY: messages})

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
