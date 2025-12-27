import logging

from aiogram import Bot
from aiogram.enums import ChatAction, ParseMode
from aiogram.types import BufferedInputFile, InputFile, Message
from aiogram.utils.media_group import MediaGroupBuilder

from db.models import MediaType
from handlers.wishes.types import NewWishData
from services.wish import WishDTO


log = logging.getLogger(__name__)


def media_by_data(data: bytes) -> InputFile:
    return BufferedInputFile(
        file=data,
        filename="wish")


async def send_wish(
        chat_id: int,
        bot: Bot,
        wish: WishDTO | NewWishData,
        ) -> list[Message]:
    parse_mode = ParseMode.HTML
    wish_messages = []
    if wish.media and (media := tuple(wish.media)):
        if len(media) > 1:
            media_group_builder = MediaGroupBuilder(
                caption=wish.text,
                caption_entities=wish.text_entities)

            for media_item in media:
                await bot.send_chat_action(
                    chat_id=chat_id,
                    action=ChatAction.UPLOAD_PHOTO)

                if isinstance(media_item.data, bytes):
                    media_data = media_by_data(media_item.data)
                else:
                    media_data = media_item.data

                match media_item.type:
                    case MediaType.IMAGE:
                        media_group_builder.add_photo(
                            media=media_data,
                            parse_mode=parse_mode)

                    case MediaType.VIDEO:
                        media_group_builder.add_video(
                            media=media_data,
                            parse_mode=parse_mode)

            wish_messages = await bot.send_media_group(
                chat_id=chat_id,
                media=media_group_builder.build(),
                message_effect_id=wish.effect_id)
        elif len(media) > 0:
            await bot.send_chat_action(
                chat_id=chat_id,
                action=ChatAction.UPLOAD_PHOTO)

            first_media = media[0]
            if isinstance(first_media.data, bytes):
                media_data = media_by_data(first_media.data)
            else:
                media_data = first_media.data

            match first_media.type:
                case MediaType.IMAGE:
                    wish_messages = [await bot.send_photo(
                        chat_id=chat_id,
                        photo=media_data,
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]

                case MediaType.VIDEO:
                    wish_messages = [await bot.send_video(
                        chat_id=chat_id,
                        video=media_data,
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]
    else:
        await bot.send_chat_action(
            chat_id=chat_id,
            action=ChatAction.TYPING)
        wish_messages = [await bot.send_message(
            chat_id=chat_id,
            text=wish.text,
            parse_mode=parse_mode,
            entities=wish.text_entities,
            message_effect_id=wish.effect_id)]

    return wish_messages
