import logging
from typing import Any, Protocol, Sequence

from aiogram import Bot
from aiogram.enums import ChatAction
from aiogram.types import BufferedInputFile, InputFile, Message, MessageEntity
from aiogram.utils.media_group import MediaGroupBuilder

from db.models import MediaType


log = logging.getLogger(__name__)


MAX_CAPTION_LENGTH = 1024
VISUAL_TYPES = (MediaType.IMAGE, MediaType.VIDEO)
AUDIO_TYPES = (MediaType.AUDIO, MediaType.VOICE)


class _Media(Protocol):
    data: Any   # bytes or Telegram file id
    type: MediaType


class _Wish(Protocol):
    text: str
    text_entities: list[MessageEntity] | None
    effect_id: str | None
    media: Any


def media_by_data(data: bytes | str, filename: str = "wish") -> InputFile | str:
    if isinstance(data, bytes):
        return BufferedInputFile(file=data, filename=filename)
    return data     # Telegram file id


async def send_wish(chat_id: int, bot: Bot, wish: _Wish) -> list[Message]:
    """
    Send a wish to the chat.

    Photos and videos go first (as an album if there are several) with the text
    as a caption when it fits; video notes and audio go separately.
    """
    media: Sequence[_Media] = list(wish.media or [])
    visual = [m for m in media if m.type in VISUAL_TYPES]
    notes = [m for m in media if m.type == MediaType.VIDEO_NOTE]
    audios = [m for m in media if m.type in AUDIO_TYPES]

    text = wish.text
    entities = wish.text_entities
    caption_fits = len(text) <= MAX_CAPTION_LENGTH
    # Message effects can be attached only to one message
    effect_id = wish.effect_id
    sent: list[Message] = []

    def take_effect() -> str | None:
        nonlocal effect_id
        effect, effect_id = effect_id, None
        return effect

    caption = text if caption_fits else None
    caption_entities = entities if caption_fits else None

    if len(visual) > 1:
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_PHOTO)
        builder = MediaGroupBuilder(
            caption=caption, caption_entities=caption_entities)
        for item in visual[:10]:
            file = media_by_data(item.data)
            if item.type == MediaType.IMAGE:
                builder.add_photo(media=file, parse_mode=None)
            else:
                builder.add_video(media=file, parse_mode=None)
        sent += await bot.send_media_group(
            chat_id=chat_id,
            media=builder.build(),
            message_effect_id=take_effect())

    elif len(visual) == 1:
        item = visual[0]
        file = media_by_data(item.data)
        if item.type == MediaType.IMAGE:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_PHOTO)
            sent.append(await bot.send_photo(
                chat_id=chat_id, photo=file,
                caption=caption, caption_entities=caption_entities,
                parse_mode=None, message_effect_id=take_effect()))
        else:
            await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_VIDEO)
            sent.append(await bot.send_video(
                chat_id=chat_id, video=file,
                caption=caption, caption_entities=caption_entities,
                parse_mode=None, message_effect_id=take_effect()))

    text_sent = bool(visual) and caption_fits

    for item in notes:
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_VIDEO_NOTE)
        sent.append(await bot.send_video_note(
            chat_id=chat_id,
            video_note=media_by_data(item.data),
            message_effect_id=take_effect()))

    for item in audios:
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.UPLOAD_VOICE)
        if item.type == MediaType.VOICE:
            sent.append(await bot.send_voice(
                chat_id=chat_id,
                voice=media_by_data(item.data, "voice.ogg"),
                message_effect_id=take_effect()))
        else:
            sent.append(await bot.send_audio(
                chat_id=chat_id,
                audio=media_by_data(item.data, "wish.mp3"),
                message_effect_id=take_effect()))

    if not text_sent:
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
        message = await bot.send_message(
            chat_id=chat_id,
            text=text,
            entities=entities,
            parse_mode=None,
            message_effect_id=take_effect())
        # Keep the text first: replies (e.g. moderation) point to it
        sent = [message, *sent] if not visual else [*sent, message]

    return sent
