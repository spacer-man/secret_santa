from typing import AsyncGenerator

from aiogram import Bot
from aiogram.types import Message

from ..types import MediaData
from db.models import MediaType


def select_media(
        message: Message,
        media_group: list[Message] | None,
        ) -> list[MediaData]:
    medias: list[MediaData] = []  # images file ids
    if media_group:
        for item_message in media_group:

            if item_message.photo:
                media_item = item_message.photo[-1]
                medias.append(MediaData(
                    data=media_item.file_id,
                    file_size=media_item.file_size,
                    type=MediaType.IMAGE))

            elif item_message.video:
                media_item = item_message.video
                medias.append(MediaData(
                    data=media_item.file_id,
                    file_size=media_item.file_size,
                    type=MediaType.VIDEO))

            elif item_message.video_note:
                media_item = item_message.video_note
                medias.append(MediaData(
                    data=media_item.file_id,
                    file_size=media_item.file_size,
                    type=MediaType.VIDEO_NOTE))

    elif message.photo:
        media_item = message.photo[-1]
        medias.append(MediaData(
            data=media_item.file_id,
            file_size=media_item.file_size,
            type=MediaType.IMAGE))

    elif message.video:
        media_item = message.video
        medias.append(MediaData(
            data=media_item.file_id,
            file_size=media_item.file_size,
            type=MediaType.VIDEO))

    elif message.video_note:
        media_item = message.video_note
        medias.append(MediaData(
            data=media_item.file_id,
            file_size=media_item.file_size,
            type=MediaType.VIDEO_NOTE))

    return medias


async def download_media(
        bot: Bot,
        media: list[MediaData],
        ) -> AsyncGenerator[MediaData]:
    for media_item in media:
        if isinstance(media_item.data, str):
            file_info = await bot.get_file(file_id=media_item.data)
            if file_path := file_info.file_path:
                file = await bot.download_file(file_path=file_path)
                if file:
                    data = file.read()
                    yield MediaData(
                        data=data,
                        file_size=len(data),
                        type=media_item.type)
