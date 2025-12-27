import asyncio
import logging
from typing import Any

from aiogram import F
from aiogram.filters import CommandStart, invert_f
from aiogram.fsm.scene import on
from aiogram.types import CallbackQuery, FSInputFile, Message
from pydantic import ValidationError

from configs.labels import LabelsConfig

from . import keyboards
from . import messages
from . import utils
from .. import utils as wish_utils
from ..types import NewWishData
from db.models import MediaType
from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.common.cancellable import CancellableScene
from handlers.consts import Scenes
from handlers.depends import notify_service, wish_service
from services.wish import WishMediaData


log = logging.getLogger()


HEADER_MESSAGE_DATAKEY = "header_message_id"
NEW_WISH_DATAKEY = "new_wish"
WISH_MESSAGES_DATAKEY = "wish_messages"
WISH_CONFIRM_MESSAGE_DATAKEY = "wish_confirm_message"


class WishingScene(
        CancellableScene,
        state=Scenes.WISHING,
        ):
    """Creating new wish"""
    @on.callback_query.enter()
    async def enter_new_wish_callback(self, call: CallbackQuery) -> None:
        await call.answer()
        message = call.message
        if not isinstance(message, Message):
            return None

        await message.delete()
        header = await message.answer_photo(
            photo=FSInputFile(path=LabelsConfig().wish_new_label),
            caption=messages.ENTER_NEW_WISH,
            reply_markup=common_keyboards.CANCEL)
        await self.wizard.update_data({
            HEADER_MESSAGE_DATAKEY: header.message_id})

    async def save_wish_messages(
            self,
            messages: list[Message],
            confirm_message: Message,
            ) -> None:
        await self.wizard.update_data({
            WISH_MESSAGES_DATAKEY: [
                msg.message_id for msg in messages
            ],
            WISH_CONFIRM_MESSAGE_DATAKEY: confirm_message.message_id,
        })

    async def clear_scene(self, message: Message, full: bool = False) -> None:
        message_ids: list[int] = await self.wizard.get_value(
            key=WISH_MESSAGES_DATAKEY) or []
        confirm_message_id: int | None = await self.wizard.get_value(
            key=WISH_CONFIRM_MESSAGE_DATAKEY)
        header_message_id = await self.wizard.get_value(HEADER_MESSAGE_DATAKEY)
        bot = message.bot
        if not bot:
            return None

        if confirm_message_id is not None:
            message_ids.append(confirm_message_id)
        if full and (header_message_id is not None):
            message_ids.append(header_message_id)

        try:
            await bot.delete_messages(
                chat_id=message.chat.id,
                message_ids=message_ids)
        except Exception:
            return None

    async def check_wish_correct(
            self,
            message: Message,
            wish: NewWishData,
            ) -> None:
        bot = message.bot
        if not bot:
            return None

        await self.wizard.update_data({
            NEW_WISH_DATAKEY: wish.model_dump(mode="json")})

        wish_messages = await wish_utils.send_wish(
            chat_id=message.chat.id,
            bot=bot,
            wish=wish)
        confirm_message = await message.answer(
            text=messages.CONFIRM_NEW_WISH,
            reply_markup=keyboards.confirm_wish(has_media=bool(wish.media)))

        if wish_messages:
            await self.save_wish_messages(
                messages=wish_messages,
                confirm_message=confirm_message)

    async def saved_wish(self) -> NewWishData | None:
        new_wish_data: dict[str, Any] | None = await self.wizard.get_value(
                key=NEW_WISH_DATAKEY)
        if new_wish_data:
            new_wish = NewWishData.model_validate(new_wish_data)
            return new_wish
        return None

    @on.message.enter()
    @on.message(invert_f(CommandStart()))
    async def check_wish(
            self,
            message: Message,
            media_group: list[Message] | None = None,
            ) -> None:
        message_text = message.text or message.caption
        message_effect_id = message.effect_id
        if media_group:
            message_text = media_group[0].caption
            message_effect_id = media_group[0].effect_id
        message_text_entities = message.entities or message.caption_entities
        media = utils.select_media(message=message, media_group=media_group)

        saved_wish = await self.saved_wish()
        saved_text = saved_wish.text if saved_wish else None
        saved_media = saved_wish.media if saved_wish else None
        saved_message_effect_id = saved_wish.effect_id if saved_wish else None
        saved_text_entities = saved_wish.text_entities if saved_wish else None

        if not (message_text or saved_text):
            alert = await message.answer(text=messages.WISH_TEXT_REQUIRED)
            await asyncio.sleep(3)
            await alert.delete()
            return None

        updated_entities = saved_text_entities
        updated_effect_id = saved_message_effect_id
        if message_text:
            updated_entities = message_text_entities
            updated_effect_id = message_effect_id

        updated_media = media[-3:] or saved_media
        if saved_media and media:
            updated_media = (saved_media + media)[-3:]

        try:
            new_wish = NewWishData(
                author_telegram_id=message.chat.id,
                text=str(message_text or saved_text),
                text_entities=updated_entities,
                effect_id=updated_effect_id,
                media=updated_media)

        except ValidationError:
            alert = await message.answer(
                text=messages.WISH_IS_TOO_SHORT_OR_LONG)
            await self.wizard.back()
            await asyncio.sleep(5)
            await alert.delete()

        except Exception:
            alert = await message.answer(text=messages.UNKNOWN_INTERNAL_ERROR)
            await self.wizard.back()
            await asyncio.sleep(5)
            await alert.delete()

        else:
            # Delete previous messages
            if media_group:
                for meida_message in media_group:
                    await meida_message.delete()
            else:
                await message.delete()
            await self.clear_scene(message=message)

            await self.check_wish_correct(
                message=message,
                wish=new_wish)

    @on.callback_query(F.data == buttons.CLEAR_MEDIA)
    async def clear_media(self, call: CallbackQuery) -> None:
        message = call.message
        if not isinstance(message, Message):
            return None

        new_wish_data: dict[str, Any] | None = await self.wizard.get_value(
                key=NEW_WISH_DATAKEY)
        if new_wish_data:
            new_wish = NewWishData.model_validate(new_wish_data)
            new_wish.media = None

            # Delete previous messages
            await message.delete()
            await self.clear_scene(message=message)
            await self.check_wish_correct(message=message, wish=new_wish)
        else:
            await call.answer()

    @on.callback_query(F.data == buttons.CONFIRM)
    async def confirm_wish(self, call: CallbackQuery) -> None:
        message = call.message
        if not isinstance(message, Message):
            return None

        wish = NewWishData.model_validate(
            await self.wizard.get_value(key=NEW_WISH_DATAKEY))

        # Delete previous message
        await message.delete()
        await self.clear_scene(message=message)
        header_message_id = await self.wizard.get_value(HEADER_MESSAGE_DATAKEY)
        bot = message.bot
        if bot and header_message_id is not None:
            await bot.delete_message(
                chat_id=message.chat.id,
                message_id=header_message_id)

        if wish:

            media: list[WishMediaData] = []
            if bot and wish.media:
                media_ids = [media_item.data for media_item in wish.media]
                async for file in utils.download_media(bot, media_ids):
                    media.append(WishMediaData(
                        data=file,
                        type=MediaType.IMAGE))

            wish_id = await wish_service.new_wish(
                author_telegram_id=wish.author_telegram_id,
                text=wish.text,
                text_entities=wish.text_entities,
                effect_id=wish.effect_id,
                media=media)
            saved_wish = await wish_service.get_one(wish_id=wish_id)

            if saved_wish:
                await notify_service.new_wish_to_check(wish=saved_wish)
            else:
                log.warning("Failed to find new saved wish in DB to send on validation")


            alert = await message.answer(text=messages.THANKS_FOR_WISH)
            await self.wizard.exit()
            await asyncio.sleep(3)
            await alert.delete()
            return None

        alert = await message.answer(text=messages.UNKNOWN_INTERNAL_ERROR)
        await self.wizard.exit()
        await asyncio.sleep(3)
        await alert.delete()

    @on.callback_query.leave()
    async def callback_exit_from_scene(self, call: CallbackQuery) -> None:
        if isinstance(call.message, Message):
            await self.clear_scene(message=call.message, full=True)

    @on.message.leave()
    async def exit_from_scene(self, message: Message) -> None:
        await self.clear_scene(message=message, full=True)
