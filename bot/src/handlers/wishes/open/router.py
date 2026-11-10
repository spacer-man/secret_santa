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


def reactions_keyboard(delivery_id: UUID, selected: str | None = None) -> InlineKeyboardMarkup:
    reactions_row = [
        InlineKeyboardButton(
            text=f"[{emoji}]" if emoji == selected else emoji,
            callback_data=f"{REACT_PREFIX}{delivery_id}:{index}",
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

    delivery = await delivery_service.open(telegram_id=chat_id)
    if not delivery:
        await call.answer(text=messages.NOT_YET, show_alert=True)
        return None

    await call.answer()
    gift_header = await message.edit_caption(caption=messages.OPENED_WISH)

    if not delivery.wish:
        alert = await message.answer(text=messages.HAVE_NO_WISH)
        await asyncio.sleep(3)
        await alert.delete()
        if isinstance(gift_header, Message):
            await gift_header.delete()
        return None

    await wish_utils.send_wish(chat_id=chat_id, bot=bot, wish=delivery.wish)
    await message.answer(
        text=messages.REACT_OFFER, reply_markup=reactions_keyboard(delivery.id, delivery.reaction)
    )


@wish_open_router.callback_query(F.data.startswith(REACT_PREFIX))
async def react(call: CallbackQuery) -> None:
    message = call.message
    bot = call.bot
    if not (isinstance(message, Message) and bot and call.data):
        return None

    try:
        raw_id, raw_index = call.data[len(REACT_PREFIX) :].split(":")
        delivery_id = UUID(raw_id)
        reaction = REACTIONS[int(raw_index)]
        result = await delivery_service.react(
            telegram_id=message.chat.id, delivery_id=delivery_id, reaction=reaction
        )
    except (ValueError, IndexError, DeliveryError):
        await call.answer()
        return None

    await call.answer(text=messages.REACTION_SENT % reaction)
    with contextlib.suppress(Exception):  # Same markup: nothing changed
        await message.edit_reply_markup(reply_markup=reactions_keyboard(delivery_id, reaction))
    await notify_author(bot=bot, result=result)
