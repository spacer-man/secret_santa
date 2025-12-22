from typing import AsyncGenerator

from aiogram import Bot
from aiogram.enums import ParseMode
from aiogram.types import Message
from aiogram.utils.media_group import MediaGroupBuilder

from .types import MediaData, NewWishData
from db.models import MediaType


async def send_new_wish(
        message: Message,
        wish: NewWishData,
        ) -> list[Message] | None:
    parse_mode = ParseMode.HTML
    wish_messages = None
    if wish.media:
        if len(wish.media) > 1:
            media_group_builder = MediaGroupBuilder(
                caption=wish.text,
                caption_entities=wish.text_entities)

            for media_item in wish.media:
                match media_item.type:
                    case MediaType.IMAGE:
                        media_group_builder.add_photo(
                            media=media_item.file_id,
                            parse_mode=parse_mode)

                    case MediaType.VIDEO:
                        media_group_builder.add_video(
                            media=media_item.file_id,
                            parse_mode=parse_mode)

            wish_messages = await message.answer_media_group(
                media=media_group_builder.build(),
                message_effect_id=wish.effect_id)
        else:
            media = wish.media[0]
            match media.type:
                case MediaType.IMAGE:
                    wish_messages = [await message.answer_photo(
                        photo=media.file_id,
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]

                case MediaType.VIDEO:
                    wish_messages = [await message.answer_video(
                        video=media.file_id,
                        caption=wish.text,
                        parse_mode=parse_mode,
                        caption_entities=wish.text_entities,
                        message_effect_id=wish.effect_id)]
    else:
        wish_messages = [await message.answer(
            text=wish.text,
            parse_mode=parse_mode,
            entities=wish.text_entities,
            message_effect_id=wish.effect_id)]

    return wish_messages


def select_media(
        message: Message,
        media_group: list[Message] | None,
        ) -> list[MediaData]:
    medias: list[MediaData] = []  # images file ids
    if media_group:
        for item_message in media_group:

            if item_message.photo:
                medias.append(MediaData(
                    file_id=item_message.photo[-1].file_id,
                    type=MediaType.IMAGE))

            elif item_message.video:
                medias.append(MediaData(
                    file_id=item_message.video.file_id,
                    type=MediaType.VIDEO))

            elif item_message.video_note:
                medias.append(MediaData(
                    file_id=item_message.video_note.file_id,
                    type=MediaType.VIDEO))

    elif message.photo:
        medias.append(MediaData(
            file_id=message.photo[-1].file_id,
            type=MediaType.IMAGE))

    elif message.video:
        medias.append(MediaData(
            file_id=message.video.file_id,
            type=MediaType.VIDEO))

    elif message.video_note:
        medias.append(MediaData(
            file_id=message.video_note.file_id,
            type=MediaType.VIDEO))

    return medias


async def download_media(
        bot: Bot,
        media_ids: list[str],
        ) -> AsyncGenerator[bytes]:
    for media_id in media_ids:
        file_info = await bot.get_file(file_id=media_id)
        if file_path := file_info.file_path:
            file = await bot.download_file(file_path=file_path)
            if file:
                yield file.read()
