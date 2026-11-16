import asyncio
import contextlib
import logging
from uuid import UUID

from aiogram import F, Router
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from handlers import buttons
from handlers import keyboards as common_keyboards
from handlers.depends import delivery_service
from services.delivery import REACTIONS, DeliveryError
from services.feedback import notify_author

from .. import utils as wish_utils
from . import messages

log = logging.getLogger(__name__)

wish_open_router = Router(name="wish.open")

REACT_PREFIX = "w.react_"


def reactions_keyboard(letter_id: UUID, selected: str | None = None) -> InlineKeyboardMarkup:
    reactions_row = [
        InlineKeyboardButton(
            text=f"[{emoji}]" if emoji == selected else emoji,
            callback_data=f"{REACT_PREFIX}{letter_id}:{index}",
        )
        for index, emoji in enumerate(REACTIONS)
    ]
    rows = [reactions_row]
    if reply_row := common_keyboards.open_app(path="inbox", text=buttons.REPLY_IN_APP):
        rows.append(reply_row)
    return InlineKeyboardMarkup(inline_keyboard=rows)


@wish_open_router.callback_query(F.data == buttons.OPEN_WISH)
async def open_wish(call: CallbackQuery) -> None:
    message = call.message
    bot = call.bot
    if not (isinstance(message, Message) and bot):
        return None
    chat_id = message.chat.id

    delivery = await delivery_service.open(chat_id)
    if not delivery:
        await call.answer(text=messages.NOT_YET, show_alert=True)
        return None

    await call.answer()
    wishes = [letter for letter in delivery.letters if letter.wish]
    header = messages.OPENED_WISHES % len(wishes) if len(wishes) > 1 else messages.OPENED_WISH
    gift_header = await message.edit_caption(caption=header)

    if not delivery.letters:
        alert = await message.answer(text=messages.HAVE_NO_WISH)
        await asyncio.sleep(3)
        await alert.delete()
        if isinstance(gift_header, Message):
            await gift_header.delete()
        return None

    for letter in delivery.letters:
        if letter.creators_text:
            await message.answer(
                text=f"{letter.creators_text.text}\n\n— {letter.creators_text.signature}",
                parse_mode=None,
            )
            offer = messages.REACT_OFFER_CREATORS
        elif letter.wish:
            await wish_utils.send_wish(chat_id=chat_id, bot=bot, wish=letter.wish)
            offer = messages.REACT_OFFER
        else:
            continue
        await message.answer(
            text=offer, reply_markup=reactions_keyboard(letter.id, letter.reaction)
        )
    if not wishes:
        await message.answer(text=messages.HAVE_NO_WISH)


@wish_open_router.callback_query(F.data.startswith(REACT_PREFIX))
async def react(call: CallbackQuery) -> None:
    message = call.message
    bot = call.bot
    if not (isinstance(message, Message) and bot and call.data):
        return None

    try:
        raw_id, raw_index = call.data[len(REACT_PREFIX) :].split(":")
        letter_id = UUID(raw_id)
        reaction = REACTIONS[int(raw_index)]
        result = await delivery_service.react(
            message.chat.id, letter_id=letter_id, reaction=reaction
        )
    except (ValueError, IndexError, DeliveryError):
        await call.answer()
        return None

    sent = messages.REACTION_SENT if result.author_id else messages.REACTION_SENT_CREATORS
    await call.answer(text=sent % reaction)
    with contextlib.suppress(Exception):  # Same markup: nothing changed
        await message.edit_reply_markup(reply_markup=reactions_keyboard(letter_id, reaction))
    await notify_author(bot=bot, result=result)
