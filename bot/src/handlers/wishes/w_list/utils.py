import logging

from aiogram import Bot
from aiogram.enums import ChatAction, ParseMode
from aiogram.types import BufferedInputFile, InputFile, Message
from aiogram.utils.media_group import MediaGroupBuilder

from db.models import MediaType
from services.wish import WishDTO


log = logging.getLogger(__name__)


def media_by_data(data: bytes) -> InputFile:
    return BufferedInputFile(
        file=data,
        filename="wish")


async def send_wish(
        message: Message,
        bot: Bot,
        wish: WishDTO,
        ) -> list[Message]:
    parse_mode = ParseMode.HTML
    wish_messages = []
    if media := tuple(wish.media):
        if len(media) > 1:
            media_group_builder = MediaGroupBuilder(
                caption=wish.text,
                caption_entities=wish.text_entities)

            for media_item in media:
                await bot.send_chat_action(
                    chat_id=message.chat.id,
                    action=ChatAction.UPLOAD_PHOTO)

                match media_item.type:
                    case MediaType.IMAGE:
                        media_group_builder.add_photo(
                            media=media_by_data(media_item.data),
                            parse_mode=parse_mode)

                    case MediaType.VIDEO:
                        media_group_builder.add_video(
                            media=media_by_data(media_item.data),
                            parse_mode=parse_mode)

            wish_messages = await message.answer_media_group(
                media=media_group_builder.build(),
                message_effect_id=wish.effect_id)
        elif len(media) > 0:
            await bot.send_chat_action(
                chat_id=message.chat.id,
                action=ChatAction.UPLOAD_PHOTO)

            a_media = media[0]
            match a_media.type:
                case MediaType.IMAGE:
                    wish_messages = [await message.answer_photo(
                        photo=media_by_data(a_media.data),
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]

                case MediaType.VIDEO:
                    wish_messages = [await message.answer_video(
                        video=media_by_data(a_media.data),
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]
    else:
        await bot.send_chat_action(
            chat_id=message.chat.id,
            action=ChatAction.TYPING)
        wish_messages = [await message.answer(
            text=wish.text,
            parse_mode=parse_mode,
            entities=wish.text_entities,
            message_effect_id=wish.effect_id)]

    return wish_messages
