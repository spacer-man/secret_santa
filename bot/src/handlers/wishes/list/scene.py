import asyncio
import logging
from uuid import UUID

from aiogram import F
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery, FSInputFile
from aiogram.types import Message

from configs.labels import LabelsConfig

from . import keyboards
from . import messages
from .. import utils
from .keyboards import OptionPrefix
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.depends import wish_service


HEADER_MESSAGE_DATAKEY = "header_message_id"
SCENE_MESSAGES_DATAKEY = "scene_messages"


type SavedMessages = dict[str, list[int]]   # dict[actions, msg_ids[]]


log = logging.getLogger(__name__)


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
        header = await message.answer_photo(
            photo=FSInputFile(path=LabelsConfig().wish_list_label),
            reply_markup=common_keyboards.BACK)

        saved_messages: SavedMessages = {}
        for wish in user_wishes:
            msgs = await utils.send_wish(
                chat_id=message.chat.id,
                bot=bot,
                wish=wish)
            action_msg = await message.answer(
                text=messages.ACTIONS_MESSAGE,
                reply_markup=keyboards.wish_item_options(wish_id=wish.id),
                reply_to_message_id=msgs[0].message_id)
            saved_messages[str(action_msg.message_id)] = [
                msg.message_id for msg in msgs]

        await self.wizard.update_data({
            SCENE_MESSAGES_DATAKEY: saved_messages,
            HEADER_MESSAGE_DATAKEY: header.message_id})

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
        bot = call.bot
        message = call.message
        callback_data = call.data
        if not (isinstance(message, Message) and callback_data and bot):
            return None

        saved_messages: SavedMessages | None = await self.wizard.get_value(
            key=SCENE_MESSAGES_DATAKEY)
        if not saved_messages:
            return None

        wish_message_ids = saved_messages.get(str(message.message_id))
        if not wish_message_ids:
            return None

        try:
            wish_id = UUID(callback_data[len(OptionPrefix.CONFIRM):])
        except Exception:
            return None

        await wish_service.delete(wish_id=wish_id)
        await message.delete()
        await bot.delete_messages(
            chat_id=message.chat.id,
            message_ids=wish_message_ids)

        remained_wishes = await wish_service.my_wishes(
            author_telegram_id=message.chat.id)
        if len([wish async for wish in remained_wishes]) == 0:
            await self.full_clear_scene(call=call)
            alert = await message.answer(text=messages.ALL_WISHES_WAS_DELETED)
            await self.wizard.back()
            await asyncio.sleep(3)
            await alert.delete()

    @on.callback_query.leave()
    async def full_clear_scene(self, call: CallbackQuery) -> None:
        header_message_id: int | None = await self.wizard.get_value(
            key=HEADER_MESSAGE_DATAKEY)
        saved_messages: SavedMessages | None = await self.wizard.get_value(
            key=SCENE_MESSAGES_DATAKEY)
        if not (call.bot and call.message and saved_messages):
            return None

        all_message_ids: list[int] = []
        for actions_message, message_ids in saved_messages.items():
            all_message_ids.extend(message_ids)
            all_message_ids.append(int(actions_message))
        if header_message_id is not None:
            all_message_ids.append(header_message_id)

        await call.bot.delete_messages(
            chat_id=call.message.chat.id,
            message_ids=all_message_ids)
