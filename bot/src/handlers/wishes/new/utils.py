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
                medias.append(MediaData(
                    data=item_message.photo[-1].file_id,
                    type=MediaType.IMAGE))

            elif item_message.video:
                medias.append(MediaData(
                    data=item_message.video.file_id,
                    type=MediaType.VIDEO))

            elif item_message.video_note:
                medias.append(MediaData(
                    data=item_message.video_note.file_id,
                    type=MediaType.VIDEO))

    elif message.photo:
        medias.append(MediaData(
            data=message.photo[-1].file_id,
            type=MediaType.IMAGE))

    elif message.video:
        medias.append(MediaData(
            data=message.video.file_id,
            type=MediaType.VIDEO))

    elif message.video_note:
        medias.append(MediaData(
            data=message.video_note.file_id,
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
