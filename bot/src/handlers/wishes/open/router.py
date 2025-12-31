import asyncio

from aiogram import F, Router
from aiogram.types import CallbackQuery, Message

from . import messages
from .. import utils as wish_utils
from handlers import buttons
from handlers.depends import wish_service


wish_open_router = Router(name="wish.open")


@wish_open_router.callback_query(F.data == buttons.OPEN_WISH)
async def hide_message(call: CallbackQuery) -> None:
    message = call.message
    bot = call.bot
    if not (isinstance(message, Message) and bot):
        return None
    chat_id = message.chat.id

    gift_header = await message.edit_caption(caption=messages.OPENED_WISH)
    wish = await wish_service.wish_to_send(reciever=message.chat.id)

    if not wish:
        alert = await message.answer(text=messages.HAVE_NO_WISH)
        await asyncio.sleep(3)
        await alert.delete()
        if isinstance(gift_header, Message):
            await gift_header.delete()
        return None

    await wish_utils.send_wish(
        chat_id=chat_id,
        bot=bot,
        wish=wish)
